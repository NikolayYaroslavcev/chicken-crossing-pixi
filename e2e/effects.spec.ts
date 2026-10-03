/// <reference lib="dom" />

import { expect, test, type Page } from '@playwright/test';

// The preview build is seeded (see playwright.config.ts): on easy the first two rounds never
// crash, on hardcore the first round crashes on the opening step. The scene marks its canvas
// with the effect it started last (`data-effect`) and the ones still playing (`data-effects`).

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
];

async function open(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const canvas = page.getByTestId('game-canvas').locator('canvas');
  await expect(canvas).toHaveCount(1, { timeout: 15_000 });
  // Records effect starts and result changes in the order the page shows them.
  await page.evaluate(() => {
    const log: string[] = [];
    const target = document.querySelector('canvas') as HTMLCanvasElement;
    new MutationObserver(() => {
      if (target.dataset.effect) log.push(`effect:${target.dataset.effect}`);
    }).observe(target, { attributes: true, attributeFilter: ['data-effect'] });
    let label = '';
    new MutationObserver(() => {
      const next = document.querySelector('.result__label')?.textContent ?? '';
      if (next !== label) log.push(`result:${(label = next)}`);
    }).observe(document.querySelector('.result') as Element, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    (window as unknown as { effectLog: string[] }).effectLog = log;
  });
  const panel = page.getByRole('region', { name: 'Game controls' });
  return {
    errors,
    canvas,
    play: panel.getByRole('button', { name: 'Play' }),
    go: panel.getByRole('button', { name: 'Go' }),
    cashOut: panel.getByRole('button', { name: 'Cash out' }),
    resultLabel: page.locator('.result__label'),
    log: () => page.evaluate(() => (window as unknown as { effectLog: string[] }).effectLog),
  };
}

const settled = { timeout: 5_000 };

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBe(0);
}

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('lands each safe step with feedback that clears before the next', async ({ page }) => {
      const ui = await open(page);

      await ui.play.click();
      await expect(ui.canvas).toHaveAttribute('data-effect', 'land');
      await expect(ui.go).toBeEnabled();
      await expect(ui.canvas).toHaveAttribute('data-effects', '', settled);

      await ui.go.click();
      await expect(ui.go).toBeEnabled();
      await expect(ui.canvas).toHaveAttribute('data-effects', '', settled);

      const log = await ui.log();
      expect(log.filter((entry) => entry === 'effect:land')).toHaveLength(2);
      expect(log).not.toContain('effect:crash');
      await expectNoOverflow(page);
      expect(ui.errors).toEqual([]);
    });

    test('shows the impact before the crash result', async ({ page }) => {
      const ui = await open(page);

      await page.locator('.difficulty__option[data-level="hardcore"]').click();
      await ui.play.click();
      await expect(ui.resultLabel).toHaveText('Crashed');
      await expect(ui.canvas).toHaveAttribute('data-effect', 'crash');
      await expect(ui.canvas).toHaveAttribute('data-effects', '', settled);

      const log = await ui.log();
      expect(log).not.toContain('effect:land');
      expect(log.indexOf('effect:crash')).toBeGreaterThanOrEqual(0);
      expect(log.indexOf('effect:crash')).toBeLessThan(log.indexOf('result:Crashed'));
      await expectNoOverflow(page);
      expect(ui.errors).toEqual([]);
    });

    test('sparkles on cash out alongside the result', async ({ page }) => {
      const ui = await open(page);

      await ui.play.click();
      await expect(ui.go).toBeEnabled();
      await ui.go.click();
      await expect(ui.cashOut).toBeEnabled();
      await ui.cashOut.click();

      await expect(ui.resultLabel).toHaveText('Cashed out');
      await expect(ui.canvas).toHaveAttribute('data-effect', 'cashout');
      await expect(ui.canvas).toHaveAttribute('data-effects', '', settled);
      await expectNoOverflow(page);
      expect(ui.errors).toEqual([]);
    });
  });
}

test('celebrates the finish before showing the win', async ({ page }) => {
  test.setTimeout(90_000);
  const ui = await open(page);

  await ui.play.click();
  await expect(ui.go).toBeEnabled();
  while ((await ui.resultLabel.textContent()) !== 'Finished') {
    await ui.go.click();
    await expect
      .poll(async () => (await ui.go.isEnabled()) || (await ui.play.isEnabled()))
      .toBe(true);
  }

  await expect(ui.canvas).toHaveAttribute('data-effect', 'finish');
  await expect(ui.canvas).toHaveAttribute('data-effects', '', settled);
  const log = await ui.log();
  expect(log.indexOf('effect:finish')).toBeGreaterThanOrEqual(0);
  expect(log.indexOf('effect:finish')).toBeLessThan(log.indexOf('result:Finished'));
  expect(log).not.toContain('effect:crash');
  await expectNoOverflow(page);
  expect(ui.errors).toEqual([]);
});
