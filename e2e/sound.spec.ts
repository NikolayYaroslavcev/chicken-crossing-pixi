/// <reference lib="dom" />

import { expect, test, type Page } from '@playwright/test';

// The preview build is seeded (see playwright.config.ts): on easy the first round never
// crashes, on hardcore the first round crashes on the opening step. The canvas carries the
// sound last played (`data-sound`) and a running count (`data-sound-count`); nothing here
// listens to the speakers.

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
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
  // Records each sound and result change in the order the page shows them.
  await page.evaluate(() => {
    const log: string[] = [];
    const target = document.querySelector('canvas') as HTMLCanvasElement;
    new MutationObserver(() => {
      if (target.dataset.sound) log.push(`sound:${target.dataset.sound}`);
    }).observe(target, { attributes: true, attributeFilter: ['data-sound-count'] });
    let label = '';
    new MutationObserver(() => {
      const next = document.querySelector('.result__label')?.textContent ?? '';
      if (next !== label) log.push(`result:${(label = next)}`);
    }).observe(document.querySelector('.result') as Element, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    (window as unknown as { soundLog: string[] }).soundLog = log;
  });
  const panel = page.getByRole('region', { name: 'Game controls' });
  return {
    errors,
    canvas,
    toggle: page.getByRole('banner').getByRole('button', { name: 'Sound' }),
    play: panel.getByRole('button', { name: 'Play' }),
    go: panel.getByRole('button', { name: 'Go' }),
    cashOut: panel.getByRole('button', { name: 'Cash out' }),
    resultLabel: page.locator('.result__label'),
    log: () => page.evaluate(() => (window as unknown as { soundLog: string[] }).soundLog),
  };
}

const sounds = (log: string[]) => log.filter((entry) => entry.startsWith('sound:'));

for (const viewport of VIEWPORTS) {
  test(`sound toggle fits the header at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const ui = await open(page);

    await expect(ui.toggle).toBeEnabled();
    await expect(ui.toggle).toHaveAttribute('aria-pressed', 'true');
    const toggle = await ui.toggle.boundingBox();
    const balance = await page.locator('.balance').boundingBox();
    if (!toggle || !balance) throw new Error('Header controls are not laid out');
    // Sub-pixel layout can report a 44px box as 43.99998px.
    expect(toggle.width).toBeGreaterThanOrEqual(44 - 0.01);
    expect(toggle.height).toBeGreaterThanOrEqual(44 - 0.01);
    const apart =
      toggle.x >= balance.x + balance.width ||
      balance.x >= toggle.x + toggle.width ||
      toggle.y >= balance.y + balance.height ||
      balance.y >= toggle.y + toggle.height;
    expect(apart).toBe(true);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBe(0);
    expect(ui.errors).toEqual([]);
  });
}

test('mutes and unmutes with a click or the keyboard and remembers it after a reload', async ({
  page,
}) => {
  const ui = await open(page);

  await ui.toggle.click();
  await expect(ui.toggle).toHaveAttribute('aria-pressed', 'false');
  await ui.toggle.press('Enter');
  await expect(ui.toggle).toHaveAttribute('aria-pressed', 'true');
  await ui.toggle.press('Space');
  await expect(ui.toggle).toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await expect(ui.canvas).toHaveCount(1, { timeout: 15_000 });
  await expect(ui.toggle).toHaveAttribute('aria-pressed', 'false');

  await ui.toggle.click();
  await page.reload();
  await expect(ui.canvas).toHaveCount(1, { timeout: 15_000 });
  await expect(ui.toggle).toHaveAttribute('aria-pressed', 'true');
  expect(ui.errors).toEqual([]);
});

test('clicks on Play and Go and plays one step sound per landing', async ({ page }) => {
  const ui = await open(page);

  await ui.play.click();
  await expect(ui.go).toBeEnabled();
  await ui.go.click();
  await expect(ui.go).toBeEnabled();

  expect(sounds(await ui.log())).toEqual([
    'sound:click',
    'sound:step',
    'sound:click',
    'sound:step',
  ]);
  await expect(ui.canvas).toHaveAttribute('data-sound-count', '4');
  expect(ui.errors).toEqual([]);
});

test('plays the crash sound before the crash result', async ({ page }) => {
  const ui = await open(page);

  await page.locator('.difficulty__option[data-level="hardcore"]').click();
  await ui.play.click();
  await expect(ui.resultLabel).toHaveText('Crashed');

  const log = await ui.log();
  expect(sounds(log)).toEqual(['sound:click', 'sound:crash']);
  expect(log.indexOf('sound:crash')).toBeLessThan(log.indexOf('result:Crashed'));
  expect(ui.errors).toEqual([]);
});

test('plays the cash-out sound once the cash out is settled', async ({ page }) => {
  const ui = await open(page);

  await ui.play.click();
  await expect(ui.cashOut).toBeEnabled();
  await ui.cashOut.click();
  await expect(ui.resultLabel).toHaveText('Cashed out');

  const log = await ui.log();
  expect(sounds(log)).toEqual(['sound:click', 'sound:step', 'sound:click', 'sound:cashOut']);
  expect(log.indexOf('sound:cashOut')).toBeLessThan(log.indexOf('result:Cashed out'));
  expect(ui.errors).toEqual([]);
});

test('plays the finish sound instead of a step sound on the last lane', async ({ page }) => {
  test.setTimeout(90_000);
  const ui = await open(page);

  await ui.play.click();
  await expect(ui.go).toBeEnabled();
  let presses = 1;
  while ((await ui.resultLabel.textContent()) !== 'Finished') {
    await ui.go.click();
    presses++;
    await expect
      .poll(async () => (await ui.go.isEnabled()) || (await ui.play.isEnabled()))
      .toBe(true);
  }

  const log = await ui.log();
  const played = sounds(log);
  expect(played.filter((entry) => entry === 'sound:click')).toHaveLength(presses);
  expect(played.filter((entry) => entry === 'sound:step')).toHaveLength(presses - 1);
  expect(played.filter((entry) => entry === 'sound:finish')).toHaveLength(1);
  expect(played.at(-1)).toBe('sound:finish');
  expect(log.indexOf('sound:finish')).toBeLessThan(log.indexOf('result:Finished'));
  expect(ui.errors).toEqual([]);
});

test('plays a whole round silently while muted', async ({ page }) => {
  const ui = await open(page);
  await ui.toggle.click();

  await ui.play.click();
  await expect(ui.go).toBeEnabled();
  await ui.go.click();
  await expect(ui.cashOut).toBeEnabled();
  await ui.cashOut.click();
  await expect(ui.resultLabel).toHaveText('Cashed out');
  await expect(ui.canvas).toHaveAttribute('data-effect', 'cashout');

  await expect(ui.canvas).not.toHaveAttribute('data-sound');
  expect(sounds(await ui.log())).toEqual([]);

  // Back on, the next action is heard at once.
  await ui.toggle.click();
  await ui.play.click();
  await expect(ui.go).toBeEnabled();
  expect(sounds(await ui.log())).toEqual(['sound:click', 'sound:step']);
  expect(ui.errors).toEqual([]);
});

test('keeps the game playable when the audio files are missing', async ({ page }) => {
  await page.route('**/assets/audio/**', (route) => route.fulfill({ status: 404, body: '' }));
  const pageErrors: string[] = [];
  const warnings: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.goto('/');
  const canvas = page.getByTestId('game-canvas').locator('canvas');
  await expect(canvas).toHaveCount(1, { timeout: 15_000 });
  const panel = page.getByRole('region', { name: 'Game controls' });

  await panel.getByRole('button', { name: 'Play' }).click();
  await expect(panel.getByRole('button', { name: 'Cash out' })).toBeEnabled();
  await panel.getByRole('button', { name: 'Cash out' }).click();

  await expect(page.locator('.result__label')).toHaveText('Cashed out');
  await expect(canvas).not.toHaveAttribute('data-sound');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(warnings.some((text) => text.includes('Could not load sound'))).toBe(true);
  expect(pageErrors).toEqual([]);
});
