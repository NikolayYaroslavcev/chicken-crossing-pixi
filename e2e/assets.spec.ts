/// <reference lib="dom" />

import { expect, test, type Locator, type Page } from '@playwright/test';

// The preview build is seeded (see playwright.config.ts): on easy the first round never
// crashes, on hardcore the first round crashes on the opening step.

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

const WORLD_HEIGHT = 640;
/** The line the chicken stands on, in world units (see layout.ts). */
const PATH_Y = 413;
const POLL = { timeout: 15_000 };

interface ChickenStats {
  /** Pixels of the chicken's warm brown outline; nothing else in the scene uses that colour. */
  outline: number;
  /** How far the middle of the outline is above the path, in world units. */
  lift: number;
}

/**
 * Finds the chicken by its outline colour in the band around the path it walks along. The frame
 * is read in the page: a screenshot of the animating WebGL canvas takes over a second, too slow
 * to catch the chicken in the air.
 */
async function chickenStats(canvas: Locator): Promise<ChickenStats> {
  return canvas.evaluate(
    async (element, { pathY, worldHeight }) => {
      // Pixi draws in an animation frame callback it queued during the last frame. One queued
      // now runs right after it, while the drawing buffer still holds the new frame.
      const grab = () =>
        new Promise<ImageData>((resolve, reject) => {
          requestAnimationFrame(() => {
            try {
              const source = element as HTMLCanvasElement;
              const surface = document.createElement('canvas');
              surface.width = source.width;
              surface.height = source.height;
              const context = surface.getContext('2d');
              if (!context) throw new Error('2D canvas is unavailable');
              context.drawImage(source, 0, 0);
              resolve(context.getImageData(0, 0, surface.width, surface.height));
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          });
        });
      const { data, width, height } = await grab();
      const scale = height / worldHeight;
      const top = Math.floor((pathY - 100) * scale);
      const bottom = Math.min(height, Math.ceil((pathY + 15) * scale));
      const xs: number[] = [];
      const ys: number[] = [];
      // Every other pixel: the outline is at least two pixels wide at every scale.
      for (let y = top; y < bottom; y += 2) {
        for (let x = 0; x < width; x += 2) {
          const i = (y * width + x) * 4;
          const r = data[i] ?? 0;
          const g = data[i + 1] ?? 0;
          const b = data[i + 2] ?? 0;
          if (r >= 55 && r <= 100 && g >= 45 && g <= 85 && b >= 30 && b <= 70 && r - b > 14) {
            xs.push(x);
            ys.push(y);
          }
        }
      }
      // Only the cluster around the median column, so a stray matching pixel elsewhere in the
      // band does not stretch the measurement.
      const centre = [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
      const near = ys
        .filter((_, k) => Math.abs((xs[k] ?? 0) - centre) < 60 * scale)
        .sort((a, b) => a - b);
      const at = (fraction: number) => near[Math.floor(fraction * (near.length - 1))] ?? 0;
      const outline = near.length;
      return {
        outline,
        lift: outline ? pathY - at(0.5) / scale : 0,
      };
    },
    { pathY: PATH_Y, worldHeight: WORLD_HEIGHT },
  );
}

function controls(page: Page) {
  const panel = page.getByRole('region', { name: 'Game controls' });
  return {
    play: panel.getByRole('button', { name: 'Play' }),
    go: panel.getByRole('button', { name: 'Go' }),
    cashOut: panel.getByRole('button', { name: 'Cash out' }),
    result: page.locator('.result .result__label'),
  };
}

for (const viewport of VIEWPORTS) {
  test(`loads the atlas and draws the chicken through a round at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    const failedAssets: string[] = [];
    const loaded = new Set<string>();
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (!/\/assets\//.test(url.pathname)) return;
      if (response.ok()) loaded.add(url.pathname.split('/').pop() ?? '');
      else failedAssets.push(`${response.status()} ${url.pathname}`);
    });

    await page.setViewportSize(viewport);
    await page.goto('/');
    const canvas = page.getByTestId('game-canvas').locator('canvas');
    await expect(canvas).toHaveCount(1, POLL);

    // One atlas description, one atlas image and the multiplier font, each fetched once.
    await expect
      .poll(() => [...loaded].filter((name) => /^game\.(json|png)$/.test(name)).length)
      .toBe(2);
    await expect.poll(() => [...loaded].some((name) => name.endsWith('.woff2'))).toBe(true);
    expect(await page.evaluate(() => document.fonts.check('700 19px Fredoka'))).toBe(true);

    // Standing at the start, body well above its feet.
    await expect
      .poll(async () => {
        const { outline, lift } = await chickenStats(canvas);
        return outline > 10 && lift > 30;
      }, POLL)
      .toBe(true);

    const ui = controls(page);
    await ui.play.click();
    await expect(ui.go).toBeEnabled();
    await ui.go.click();
    await expect(ui.go).toBeEnabled();
    await expect
      .poll(async () => {
        const { outline, lift } = await chickenStats(canvas);
        return outline > 10 && lift > 30;
      }, POLL)
      .toBe(true);

    await ui.cashOut.click();
    await expect(ui.result).toHaveText('Cashed out');

    // Lost on hardcore's opening step: the chicken ends lying on its back on that lane.
    await page.locator('.difficulty__option[data-level="hardcore"]').click();
    await ui.play.click();
    await expect(ui.result).toHaveText('Crashed');
    await expect
      .poll(async () => {
        const { outline, lift } = await chickenStats(canvas);
        return outline > 10 && lift < 22;
      }, POLL)
      .toBe(true);

    // A new round puts it back on its feet.
    await page.locator('.difficulty__option[data-level="easy"]').click();
    await ui.play.click();
    await expect(ui.go).toBeEnabled();
    await expect.poll(async () => (await chickenStats(canvas)).lift > 30, POLL).toBe(true);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    expect(failedAssets).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('stops with a visible error instead of a broken scene when the atlas is missing', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/assets/atlas/game.json', (route) => route.fulfill({ status: 404 }));

  await page.goto('/');

  await expect(page.getByRole('alert')).toHaveText(/could not start/);
  await expect(page.getByTestId('game-canvas').locator('canvas')).toHaveCount(0);
  // Reported once, and caught at the loading boundary rather than thrown at the page.
  expect(consoleErrors.some((error) => error.includes('Failed to start the game'))).toBe(true);
  expect(pageErrors).toEqual([]);
});
