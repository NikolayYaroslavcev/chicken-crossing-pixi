/// <reference lib="dom" />

import { expect, test, type Locator } from '@playwright/test';

/**
 * Samples the rendered canvas at fractions of its size and returns [r, g, b] per point. The
 * pixels are read in the page: a screenshot of the animating WebGL canvas takes over a second,
 * so a few of them per check could eat a test's whole time budget on a busy machine.
 */
async function sampleCanvas(canvas: Locator, points: [number, number][]) {
  return canvas.evaluate(
    (element, points) =>
      new Promise<number[][]>((resolve, reject) => {
        // Pixi draws in an animation frame callback it queued during the last frame. One queued
        // now runs right after it, while the drawing buffer still holds the new frame.
        requestAnimationFrame(() => {
          try {
            const source = element as HTMLCanvasElement;
            const surface = document.createElement('canvas');
            surface.width = source.width;
            surface.height = source.height;
            const context = surface.getContext('2d');
            if (!context) throw new Error('2D canvas is unavailable');
            context.drawImage(source, 0, 0);
            resolve(
              points.map(([fx, fy]) => {
                const x = Math.floor(fx * (surface.width - 1));
                const y = Math.floor(fy * (surface.height - 1));
                const [r = 0, g = 0, b = 0] = context.getImageData(x, y, 1, 1).data;
                return [r, g, b];
              }),
            );
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      }),
    points,
  );
}

// Startup (renderer plus sprite atlas) and frames are slow while the traffic animates in several
// browsers at once.
const CANVAS_POLL = { timeout: 15_000 };

/** Heights inside the road band clear of the multiplier badges. */
const ROAD_ROWS = [0.3, 0.45, 0.8, 0.93];

const brightness = ([r, g, b]: number[]) => ((r ?? 0) + (g ?? 0) + (b ?? 0)) / 3;

test('app starts and draws the crossing and chicken without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');

  await expect(page).toHaveTitle('Chicken Crossing');
  await expect(page.getByRole('heading', { level: 1, name: 'Chicken Crossing' })).toBeVisible();
  const canvas = page.getByTestId('game-canvas').locator('canvas');
  await expect(canvas).toHaveCount(1, CANVAS_POLL);

  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    // The canvas fills the game frame, which follows the viewport.
    await expect
      .poll(() =>
        canvas.evaluate((element) => {
          const frame = element.closest('.stage');
          return frame !== null && element.clientWidth === frame.clientWidth;
        }),
      )
      .toBe(true);

    // Sky at the top, dark asphalt in the road band to the right of the start sidewalk. The
    // road points are spread down the lane so a passing car cannot cover all of them.
    await expect
      .poll(async () => {
        const [sky = [], ...road] = await sampleCanvas(canvas, [
          [0.9, 0.05],
          ...ROAD_ROWS.map((y): [number, number] => [0.9, y]),
        ]);
        return (sky[2] ?? 0) > 180 && road.filter((pixel) => brightness(pixel) < 110).length >= 2;
      }, CANVAS_POLL)
      .toBe(true);

    // White chicken body standing on the start sidewalk (world point 94, 389 of a 640-high world).
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas has no layout box');
    const chickenX = (94 * (box.height / 640)) / box.width;
    await expect
      .poll(async () => {
        const [chicken = []] = await sampleCanvas(canvas, [[chickenX, 389 / 640]]);
        return chicken.every((channel) => channel > 225);
      }, CANVAS_POLL)
      .toBe(true);
  }

  expect(errors).toEqual([]);
});

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  // Phones turned on their side.
  { width: 844, height: 390 },
  { width: 667, height: 375 },
];

for (const viewport of VIEWPORTS) {
  test(`layout fits ${viewport.width}x${viewport.height} with the controls visible`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByTestId('game-canvas').locator('canvas')).toHaveCount(1, CANVAS_POLL);

    const overflow = await page.evaluate(() => ({
      horizontal: document.documentElement.scrollWidth - window.innerWidth,
      vertical: document.documentElement.scrollHeight - window.innerHeight,
    }));
    expect(overflow).toEqual({ horizontal: 0, vertical: 0 });

    const panel = page.getByRole('region', { name: 'Game controls' });
    await expect(page.getByRole('banner')).toBeInViewport({ ratio: 1 });
    await expect(page.getByText('Balance', { exact: true })).toBeVisible();
    await expect(panel).toBeInViewport({ ratio: 1 });
    for (const control of [
      page.getByRole('textbox', { name: 'Bet' }),
      page.getByRole('group', { name: 'Difficulty' }),
      panel.getByRole('button', { name: 'Play' }),
      panel.getByRole('button', { name: 'Go' }),
      panel.getByRole('button', { name: 'Cash out' }),
    ]) {
      await expect(control).toBeInViewport({ ratio: 1 });
    }

    // Every control pressed during a round is at least a 44px touch target. Sub-pixel layout
    // can report a 44px box as 43.99998px.
    const difficulty = page.getByRole('group', { name: 'Difficulty' });
    for (const control of [
      panel.getByRole('button', { name: 'Play' }),
      panel.getByRole('button', { name: 'Go' }),
      panel.getByRole('button', { name: 'Cash out' }),
      page.getByRole('button', { name: 'Decrease bet' }),
      page.getByRole('button', { name: 'Increase bet' }),
      ...(await difficulty.getByRole('radio').all()).map((radio) => radio.locator('xpath=..')),
    ]) {
      const box = await control.boundingBox();
      expect(Math.min(box?.width ?? 0, box?.height ?? 0)).toBeGreaterThanOrEqual(44 - 0.01);
    }

    // The game keeps a usable share of the screen.
    const frame = await page.getByRole('main', { name: 'Game' }).boundingBox();
    expect(frame?.height ?? 0).toBeGreaterThan(viewport.height * 0.45);

    expect(errors).toEqual([]);
  });
}

for (const viewport of VIEWPORTS) {
  test(`camera frames the start of the crossing at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.setViewportSize(viewport);
    await page.goto('/');
    const canvas = page.getByTestId('game-canvas').locator('canvas');
    await expect(canvas).toHaveCount(1, CANVAS_POLL);

    // Start sidewalk at the left edge, road running off the right edge: the world fills the
    // view with no empty space on either side.
    const framed = async () => {
      const box = await canvas.boundingBox();
      if (!box) throw new Error('Canvas has no layout box');
      const chickenX = (94 * (box.height / 640)) / box.width;
      const [sidewalk = [], sky = [], chicken = [], ...road] = await sampleCanvas(canvas, [
        [0.01, 0.3],
        [0.99, 0.05],
        [chickenX, 389 / 640],
        // Spread across and down the lane, so neither a lane marking nor a passing car under
        // some of them matters.
        ...ROAD_ROWS.flatMap((y): [number, number][] => [
          [0.97, y],
          [0.99, y],
        ]),
      ]);
      const [r = 0, g = 0, b = 0] = sidewalk;
      return (
        brightness(sidewalk) > 170 &&
        Math.abs(r - b) < 40 &&
        Math.abs(r - g) < 40 &&
        road.filter((pixel) => brightness(pixel) < 110).length >= 3 &&
        (sky[2] ?? 0) > 180 &&
        chicken.every((channel) => channel > 225)
      );
    };
    await expect.poll(framed, CANVAS_POLL).toBe(true);

    // Through a resize to the other extreme and back the view stays inside the world.
    const other =
      viewport.width < 1000 ? { width: 1440, height: 900 } : { width: 390, height: 844 };
    for (const size of [other, viewport]) {
      await page.setViewportSize(size);
      await expect.poll(framed, CANVAS_POLL).toBe(true);
    }

    // A rebuilt crossing starts framed the same way.
    for (const level of ['hardcore', 'easy']) {
      await page.locator(`.difficulty__option[data-level="${level}"]`).click();
      await expect(page.getByRole('radio', { checked: true })).toHaveValue(level);
      await expect.poll(framed, CANVAS_POLL).toBe(true);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBe(0);
    expect(errors).toEqual([]);
  });
}

test('shows a focus ring on keyboard focus, also on the hidden difficulty radios', async ({
  page,
}) => {
  await page.goto('/');
  const play = page.getByRole('region', { name: 'Game controls' }).getByRole('button', {
    name: 'Play',
  });
  await expect(play).toBeEnabled(CANVAS_POLL);
  const ring = (target: Locator) =>
    target.evaluate((element) => {
      const style = getComputedStyle(element);
      return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
    });

  // A key press first, so the browser treats the following focus as keyboard focus.
  await page.keyboard.press('Tab');
  await play.focus();
  await expect(play).toBeFocused();
  expect(await ring(play)).toBe(true);

  // The radio itself is invisible, so its label has to show where the focus is.
  const easy = page.getByRole('radio', { name: /^Easy/ });
  await easy.focus();
  await expect(easy).toBeFocused();
  expect(await ring(easy.locator('xpath=..'))).toBe(true);
});
