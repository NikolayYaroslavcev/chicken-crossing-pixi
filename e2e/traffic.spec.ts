/// <reference lib="dom" />

import { expect, test, type Locator, type Page } from '@playwright/test';

// The preview build is seeded (see playwright.config.ts): on easy the first round never crashes.

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

const WORLD_HEIGHT = 640;
const ROAD_TOP = 136;
const START_WIDTH = 168;
// Each sample waits for two frames, which are slow while other tests render.
const POLL = { timeout: 15_000 };

interface RoadStats {
  /** Share of road pixels painted in a strong colour, which only cars have there. */
  painted: number;
  /** Share of road pixels that changed between the two shots. */
  changed: number;
  /** Mean brightness of a column at the left edge of the road band. */
  leftEdge: number;
  /** Darkest channel where the chicken stands at the start (world point 94, 389). */
  chicken: number;
}

/**
 * Compares two frames of the canvas, `delay` ms apart, over the road band to the right of the
 * start sidewalk. The frames are read in the page: a screenshot of the animating WebGL canvas
 * takes over a second, which would stretch the gap between them and the test with it.
 */
async function roadStats(canvas: Locator, delay = 250): Promise<RoadStats> {
  return canvas.evaluate(
    async (element, { delay, roadTop, startWidth, worldHeight }) => {
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
      const a = await grab();
      await new Promise((resolve) => setTimeout(resolve, delay));
      const b = await grab();
      const scale = a.height / worldHeight;
      const top = Math.ceil((roadTop + 8) * scale);
      const left = Math.ceil((startWidth + 8) * scale);
      let total = 0;
      let painted = 0;
      let changed = 0;
      for (let y = top; y < a.height; y += 2) {
        for (let x = left; x < a.width; x += 2) {
          const i = (y * a.width + x) * 4;
          const [r = 0, g = 0, bl = 0] = [a.data[i], a.data[i + 1], a.data[i + 2]];
          total++;
          if (Math.max(r, g, bl) - Math.min(r, g, bl) > 90) painted++;
          const diff =
            Math.abs(r - (b.data[i] ?? 0)) +
            Math.abs(g - (b.data[i + 1] ?? 0)) +
            Math.abs(bl - (b.data[i + 2] ?? 0));
          if (diff > 60) changed++;
        }
      }
      let edge = 0;
      let edgeCount = 0;
      for (let y = top; y < a.height; y += 2) {
        const i = (y * a.width + 1) * 4;
        edge += ((a.data[i] ?? 0) + (a.data[i + 1] ?? 0) + (a.data[i + 2] ?? 0)) / 3;
        edgeCount++;
      }
      const c = (Math.floor(389 * scale) * a.width + Math.floor(94 * scale)) * 4;
      return {
        painted: painted / total,
        changed: changed / total,
        leftEdge: edge / edgeCount,
        chicken: Math.min(a.data[c] ?? 0, a.data[c + 1] ?? 0, a.data[c + 2] ?? 0),
      };
    },
    { delay, roadTop: ROAD_TOP, startWidth: START_WIDTH, worldHeight: WORLD_HEIGHT },
  );
}

async function open(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const canvas = page.getByTestId('game-canvas').locator('canvas');
  await expect(canvas).toHaveCount(1, POLL);
  return { errors, canvas };
}

for (const viewport of VIEWPORTS) {
  test(`cars drive along the road at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { errors, canvas } = await open(page);

    // Cars on the road before the first round, and they keep moving.
    await expect.poll(async () => (await roadStats(canvas)).painted, POLL).toBeGreaterThan(0.03);
    await expect.poll(async () => (await roadStats(canvas)).changed, POLL).toBeGreaterThan(0.01);

    // White chicken still standing on the start sidewalk, drawn over everything else.
    await expect.poll(async () => (await roadStats(canvas, 0)).chicken, POLL).toBeGreaterThan(225);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBe(0);
    expect(errors).toEqual([]);
  });
}

test('traffic keeps moving with the camera through a round', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors, canvas } = await open(page);
  const panel = page.getByRole('region', { name: 'Game controls' });
  const go = panel.getByRole('button', { name: 'Go' });

  // The start sidewalk fills the left edge before the round.
  await expect.poll(async () => (await roadStats(canvas, 50)).leftEdge, POLL).toBeGreaterThan(170);

  await panel.getByRole('button', { name: 'Play' }).click();
  for (let step = 0; step < 3; step++) {
    await expect(go).toBeEnabled();
    await go.click();
  }
  await expect(go).toBeEnabled();

  // The camera has followed the chicken off the sidewalk, and the road it shows is still busy.
  const stats = await roadStats(canvas);
  expect(stats.leftEdge).toBeLessThan(170);
  await expect.poll(async () => (await roadStats(canvas)).painted, POLL).toBeGreaterThan(0.03);
  await expect.poll(async () => (await roadStats(canvas)).changed, POLL).toBeGreaterThan(0.01);

  await panel.getByRole('button', { name: 'Cash out' }).click();
  await expect(page.locator('.result__label')).toHaveText('Cashed out');
  await expect.poll(async () => (await roadStats(canvas)).changed, POLL).toBeGreaterThan(0.01);
  expect(errors).toEqual([]);
});
