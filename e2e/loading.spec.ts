import { expect, test, type Page, type Route } from '@playwright/test';

// The preview build is seeded (see playwright.config.ts): on easy the first two rounds never
// crash. Failures are injected at the network, so the build under test is the real one.

const ATLAS = '**/assets/atlas/game.json';
const STARTUP = { timeout: 15_000 };
/** What the browser and the app log for a failure a test injects on purpose. */
const EXPECTED_ERRORS = ['Failed to start the game', 'Failed to load resource'];

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

function game(page: Page) {
  const host = page.getByTestId('game-canvas');
  const panel = page.getByRole('region', { name: 'Game controls' });
  return {
    host,
    canvas: host.locator('canvas'),
    loading: host.getByRole('status'),
    failure: host.getByRole('alert'),
    retry: host.getByRole('button', { name: 'Try again' }),
    panel,
    play: panel.getByRole('button', { name: 'Play' }),
    go: panel.getByRole('button', { name: 'Go' }),
    cashOut: panel.getByRole('button', { name: 'Cash out' }),
    bet: page.getByRole('textbox', { name: 'Bet' }),
    balance: page.getByRole('status', { name: 'Balance' }),
    result: page.locator('.result__label'),
  };
}

/** Collects page errors and console errors, apart from the ones the injected failure causes. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() !== 'error' || EXPECTED_ERRORS.some((known) => text.includes(known))) return;
    errors.push(text);
  });
  return errors;
}

/** Holds every atlas request until `release` is called. */
async function holdAtlas(page: Page) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(ATLAS, async (route) => {
    await released;
    await route.continue();
  });
  return release;
}

/** Fails the first `count` atlas requests, then lets them through. */
async function failAtlas(page: Page, count: number, fail: (route: Route) => Promise<void>) {
  let failures = 0;
  await page.route(ATLAS, async (route) => {
    if (failures++ < count) await fail(route);
    else await route.continue();
  });
}

const notFound = (route: Route) => route.fulfill({ status: 404, body: '' });

async function playOneRound(ui: ReturnType<typeof game>) {
  await ui.play.click();
  await expect(ui.cashOut).toBeEnabled();
  await ui.cashOut.click();
  await expect(ui.result).toHaveText('Cashed out');
}

test('shows a loading state with nothing playable until the game is ready', async ({ page }) => {
  const errors = watchErrors(page);
  const release = await holdAtlas(page);
  const ui = game(page);

  await page.goto('/');

  await expect(ui.loading).toHaveText(/loading/i);
  await expect(ui.host).toHaveAttribute('aria-busy', 'true');
  await expect(ui.canvas).toHaveCount(0);
  await expect(ui.panel).toHaveAttribute('aria-busy', 'true');
  await expect(ui.play).toBeDisabled();
  await expect(ui.bet).toBeDisabled();
  // A key press during loading starts nothing, now or once the game is ready.
  await page.keyboard.press('Space');
  await expect(ui.balance).toHaveText('$1,000.00');

  release();

  await expect(ui.loading).toHaveCount(0, STARTUP);
  await expect(ui.canvas).toHaveCount(1);
  await expect(ui.play).toBeEnabled();
  await expect(page.locator('.result__value')).toHaveText('Ready');
  await expect(ui.balance).toHaveText('$1,000.00');
  await playOneRound(ui);
  expect(errors).toEqual([]);
});

test('recovers from a missing atlas with Try again and plays normally', async ({ page }) => {
  const errors = watchErrors(page);
  await failAtlas(page, 1, notFound);
  const ui = game(page);

  await page.goto('/');

  await expect(ui.failure).toContainText('could not start', STARTUP);
  await expect(ui.loading).toHaveCount(0);
  await expect(ui.canvas).toHaveCount(0);
  await expect(ui.play).toBeDisabled();
  await expect(ui.go).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect(ui.balance).toHaveText('$1,000.00');

  await ui.retry.click();

  await expect(ui.failure).toHaveCount(0);
  await expect(ui.play).toBeEnabled(STARTUP);
  await expect(ui.retry).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Game controls' })).toHaveCount(1);

  // One step per Go: a second ticker or scene would show up as an extra landing.
  await ui.play.click();
  await expect(ui.go).toBeEnabled();
  await expect(ui.canvas).toHaveAttribute('data-sound-count', '2');
  await ui.go.click();
  await expect(ui.go).toBeEnabled();
  await expect(ui.canvas).toHaveAttribute('data-sound-count', '4');
  await ui.cashOut.click();
  await expect(ui.result).toHaveText('Cashed out');
  expect(errors).toEqual([]);
});

test('fails clearly on a malformed atlas', async ({ page }) => {
  const errors = watchErrors(page);
  await failAtlas(page, 1, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"frames": [' }),
  );
  const ui = game(page);

  await page.goto('/');

  await expect(ui.failure).toContainText('could not start', STARTUP);
  await expect(ui.canvas).toHaveCount(0);
  await expect(ui.play).toBeDisabled();

  await ui.retry.click();
  await expect(ui.play).toBeEnabled(STARTUP);
  await playOneRound(ui);
  expect(errors).toEqual([]);
});

test('fails clearly when the atlas lacks a frame the game draws', async ({ page }) => {
  const errors = watchErrors(page);
  await page.route(ATLAS, async (route) => {
    const response = await route.fetch();
    const atlas = (await response.json()) as { frames: Record<string, unknown> };
    delete atlas.frames.chicken_shadow;
    await route.fulfill({ response, json: atlas });
  });
  const ui = game(page);

  await page.goto('/');

  await expect(ui.failure).toContainText('could not start', STARTUP);
  await expect(ui.canvas).toHaveCount(0);
  await expect(ui.play).toBeDisabled();
  await expect(ui.retry).toBeVisible();
  expect(errors).toEqual([]);
});

test('restores balance, bet and difficulty after a reload', async ({ page }) => {
  const ui = game(page);
  await page.goto('/');
  await expect(ui.play).toBeEnabled(STARTUP);

  await ui.bet.fill('2');
  await ui.bet.press('Tab');
  await playOneRound(ui);
  await page.locator('.difficulty__option[data-level="medium"]').click();
  const balance = await ui.balance.textContent();

  await page.reload();

  await expect(ui.play).toBeEnabled(STARTUP);
  await expect(ui.balance).toHaveText(balance ?? '');
  await expect(ui.bet).toHaveValue('2.00');
  await expect(page.locator('.difficulty__option[data-level="medium"] input')).toBeChecked();
});

for (const viewport of VIEWPORTS) {
  test(`loading and failure states fit ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const release = await holdAtlas(page);
    const ui = game(page);
    await page.goto('/');

    await expect(ui.loading).toBeInViewport();

    // A request held past the reload never reaches the page; only the next one fails.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    release();
    await failAtlas(page, 1, notFound);
    await page.reload();

    await expect(ui.failure).toBeVisible(STARTUP);
    await expect(ui.retry).toBeInViewport({ ratio: 1 });
    const box = await ui.retry.boundingBox();
    // Sub-pixel layout can report a 44px box as 43.99998px.
    expect(box?.height).toBeGreaterThanOrEqual(44 - 0.01);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);

    await ui.retry.click();
    await expect(ui.play).toBeEnabled(STARTUP);
    await expect(page.locator('canvas')).toHaveCount(1);
  });
}
