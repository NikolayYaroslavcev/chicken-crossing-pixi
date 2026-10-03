/// <reference lib="dom" />

import { expect, test, type Page } from '@playwright/test';

// The preview build is seeded (see playwright.config.ts): on easy the first two rounds never
// crash, on hardcore the first round crashes on the opening step. Every test starts from the
// default settings: easy, a $1 bet and $1000.

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function game(page: Page) {
  const panel = page.getByRole('region', { name: 'Game controls' });
  const result = page.locator('.result');
  return {
    play: panel.getByRole('button', { name: 'Play' }),
    go: panel.getByRole('button', { name: 'Go' }),
    cashOut: panel.getByRole('button', { name: 'Cash out' }),
    bet: page.getByRole('textbox', { name: 'Bet' }),
    difficulty: page.getByRole('group', { name: 'Difficulty' }),
    balance: page.getByRole('status', { name: 'Balance' }),
    resultLabel: result.locator('.result__label'),
    resultValue: result.locator('.result__value'),
    resultDetail: result.locator('.result__detail'),
  };
}

async function open(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  // The canvas appears once both the renderer and the sprite atlas are ready.
  await expect(page.getByTestId('game-canvas').locator('canvas')).toHaveCount(1, {
    timeout: 15_000,
  });
  return errors;
}

const multiplierOf = (text: string) => Number(text.replace('x', ''));

type LockedControls = Record<'play' | 'go' | 'cashOut' | 'bet' | 'difficulty', boolean>;
type LockRecord = Window & { lockedControls?: LockedControls | null };

/**
 * Runs `action` and returns which controls were disabled once it locked the panel. The lock
 * lasts only while the engine answers and the chicken hops, which polling can miss on a busy
 * machine, so the page records the controls the moment `aria-busy` turns on.
 */
async function lockDuring(page: Page, action: () => Promise<void>): Promise<LockedControls> {
  await page.evaluate(() => {
    const panel = document.querySelector('[aria-label="Game controls"]');
    if (!panel) throw new Error('The game controls are missing');
    const record = window as LockRecord;
    const disabled = (selector: string) => {
      const controls = [...panel.querySelectorAll(selector)];
      return controls.length > 0 && controls.every((control) => control.matches(':disabled'));
    };
    record.lockedControls = null;
    const observer = new MutationObserver(() => {
      if (panel.getAttribute('aria-busy') !== 'true') return;
      observer.disconnect();
      record.lockedControls = {
        play: disabled('.button--play'),
        go: disabled('.button--go'),
        cashOut: disabled('.button--cash'),
        bet: disabled('.bet__input'),
        difficulty: disabled('input[type="radio"]'),
      };
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['aria-busy'] });
  });
  await action();
  const locked = await page.waitForFunction(() => (window as LockRecord).lockedControls);
  return (await locked.jsonValue()) as LockedControls;
}

const LOCKED: LockedControls = { play: true, go: true, cashOut: true, bet: true, difficulty: true };

test('plays a round to cash out and starts another', async ({ page }) => {
  const errors = await open(page);
  const ui = game(page);

  await expect(ui.balance).toHaveText('$1,000.00');
  await expect(ui.resultValue).toHaveText('Ready');
  await expect(ui.go).toBeDisabled();
  await expect(ui.cashOut).toBeDisabled();

  // Locked while the engine answers and the chicken hops to the first lane.
  expect(await lockDuring(page, () => ui.play.click())).toEqual(LOCKED);

  await expect(ui.go).toBeEnabled();
  await expect(ui.cashOut).toBeEnabled();
  await expect(ui.play).toBeDisabled();
  await expect(ui.balance).toHaveText('$999.00');
  await expect(ui.resultLabel).toHaveText('Multiplier');
  const first = multiplierOf((await ui.resultValue.textContent()) ?? '');
  expect(first).toBeGreaterThan(1);

  expect(await lockDuring(page, () => ui.go.click())).toEqual(LOCKED);
  await expect(ui.go).toBeEnabled();
  const second = multiplierOf((await ui.resultValue.textContent()) ?? '');
  expect(second).toBeGreaterThan(first);

  await ui.cashOut.click();
  await expect(ui.resultLabel).toHaveText('Cashed out');
  // A $1 bet pays exactly the multiplier.
  await expect(ui.resultValue).toHaveText(`+${money.format(second)}`);
  await expect(ui.balance).toHaveText(money.format(999 + second));
  await expect(ui.play).toBeEnabled();
  await expect(ui.go).toBeDisabled();
  await expect(ui.cashOut).toBeDisabled();
  await expect(ui.bet).toBeEnabled();

  await ui.play.click();
  await expect(ui.go).toBeEnabled();
  await expect(ui.resultLabel).toHaveText('Multiplier');
  await expect(ui.resultValue).toHaveText(`x${first.toFixed(2)}`);
  await expect(ui.balance).toHaveText(money.format(998 + second));

  expect(errors).toEqual([]);
});

test('loses the bet when the opening step crashes', async ({ page }) => {
  const errors = await open(page);
  const ui = game(page);

  await page.locator('.difficulty__option[data-level="hardcore"]').click();
  await ui.play.click();

  await expect(ui.resultLabel).toHaveText('Crashed');
  await expect(ui.resultValue).toHaveText('-$1.00');
  await expect(ui.balance).toHaveText('$999.00');
  await expect(ui.play).toBeEnabled();
  await expect(ui.go).toBeDisabled();
  await expect(ui.cashOut).toBeDisabled();
  await expect(ui.difficulty.getByRole('radio').first()).toBeEnabled();

  await ui.play.click();
  await expect(ui.balance).toHaveText('$998.00');

  expect(errors).toEqual([]);
});

test('crosses every lane with the keyboard and collects the top payout', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await open(page);
  const ui = game(page);

  await page.keyboard.press('Space');
  await expect(ui.go).toBeEnabled();

  while ((await ui.resultLabel.textContent()) !== 'Finished') {
    expect(await lockDuring(page, () => page.keyboard.press('Space'))).toEqual(LOCKED);
    await expect
      .poll(async () => (await ui.go.isEnabled()) || (await ui.play.isEnabled()))
      .toBe(true);
  }

  // Easy pays x24.50 on the last lane.
  await expect(ui.resultValue).toHaveText('+$24.50');
  await expect(ui.balance).toHaveText('$1,023.50');
  await expect(ui.play).toBeEnabled();
  await expect(ui.go).toBeDisabled();
  await expect(ui.cashOut).toBeDisabled();

  await page.keyboard.press('Space');
  await expect(ui.go).toBeEnabled();
  await expect(ui.balance).toHaveText('$1,022.50');

  expect(errors).toEqual([]);
});

test('keeps a crash result tied to its bet and plays the next round with the new one', async ({
  page,
}) => {
  const errors = await open(page);
  const ui = game(page);

  await page.locator('.difficulty__option[data-level="hardcore"]').click();
  await ui.play.click();
  await expect(ui.resultLabel).toHaveText('Crashed');
  await expect(ui.resultValue).toHaveText('-$1.00');

  await ui.bet.fill('50');
  await ui.bet.press('Enter');
  await expect(ui.bet).toHaveValue('50.00');
  await expect(ui.resultLabel).toHaveText('Crashed');
  await expect(ui.resultValue).toHaveText('-$1.00');
  await expect(ui.balance).toHaveText('$999.00');

  await ui.play.click();
  await expect(ui.balance).toHaveText('$949.00');

  expect(errors).toEqual([]);
});

test('clears a cash out result when the difficulty changes', async ({ page }) => {
  const errors = await open(page);
  const ui = game(page);

  await ui.play.click();
  await expect(ui.cashOut).toBeEnabled();
  await ui.cashOut.click();
  await expect(ui.resultLabel).toHaveText('Cashed out');
  const balance = (await ui.balance.textContent()) ?? '';

  await page.locator('.difficulty__option[data-level="hardcore"]').click();
  await expect(ui.resultLabel).toHaveCount(0);
  await expect(ui.resultValue).toHaveText('Ready');
  await expect(ui.resultDetail).toHaveText('Choose your bet and start');
  await expect(ui.balance).toHaveText(balance);
  await expect(ui.play).toBeEnabled();
  await expect(ui.go).toBeDisabled();

  expect(errors).toEqual([]);
});
