import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DIFFICULTIES,
  EngineError,
  getMultiplierTable,
  MockEngine,
  type Difficulty,
  type GameEngine,
  type RoundState,
  type StepResult,
} from '@/engine';
import {
  createGameStore,
  createSoundSettings,
  instantScene,
  SOUND_SETTINGS_KEY,
  type GameStore,
  type Settings,
} from '@/store';
import { App } from './App';

vi.mock('@/game/GameCanvas', () => ({
  GameCanvas: () => <div data-testid="game-canvas" />,
}));

function renderApp(settings: Partial<Settings> = {}, sound = createSoundSettings()) {
  const initial: Settings = { balance: 1234.5, difficulty: 'easy', bet: 1, ...settings };
  const store = createGameStore({
    engine: new MockEngine({ seed: 1, balance: initial.balance, latency: { min: 0, max: 0 } }),
    settings: initial,
  });
  render(<App store={store} sound={sound} />);
  return store;
}

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

const betInput = () => screen.getByRole('textbox', { name: 'Bet' });

describe('App shell', () => {
  it('renders the header with the brand and the store balance', () => {
    renderApp();

    const header = screen.getByRole('banner');
    expect(
      within(header).getByRole('heading', { level: 1, name: 'Chicken Crossing' }),
    ).toBeInTheDocument();
    expect(within(header).getByRole('status', { name: 'Balance' })).toHaveTextContent('$1,234.50');
  });

  it('keeps the settings control visibly unavailable', () => {
    renderApp();

    expect(screen.getByRole('button', { name: /settings/i })).toBeDisabled();
  });

  it('offers a sound toggle that starts on and switches with a click', () => {
    const sound = createSoundSettings();
    renderApp({}, sound);
    const toggle = screen.getByRole('button', { name: 'Sound' });

    expect(toggle).toBeEnabled();
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(sound.getState().muted).toBe(true);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(sound.getState().muted).toBe(false);
  });

  it('shows a saved mute choice and keeps it apart from the game settings', () => {
    const storage = memoryStorage();
    storage.setItem(SOUND_SETTINGS_KEY, JSON.stringify({ muted: true }));
    const store = renderApp({}, createSoundSettings(storage));

    expect(screen.getByRole('button', { name: 'Sound' })).toHaveAttribute('aria-pressed', 'false');
    expect(store.getState()).not.toHaveProperty('muted');
  });

  it('renders the game area with the canvas and the round status', () => {
    renderApp();

    const game = screen.getByRole('main', { name: 'Game' });
    expect(within(game).getByTestId('game-canvas')).toBeInTheDocument();
    expect(within(game).getByText('Ready')).toBeInTheDocument();
  });

  it('renders the control panel with only Play available before a round', () => {
    renderApp();

    expect(actionStates()).toEqual({ play: true, go: false, cashOut: false });
  });
});

/** Cash out also names the amount it would pay, so names match from the start. */
const actionName = (name: string) => new RegExp(`^${name}(\\s|$)`);

function actionStates() {
  const panel = screen.getByRole('region', { name: 'Game controls' });
  const enabled = (name: string) =>
    !within(panel)
      .getByRole('button', { name: actionName(name) })
      .hasAttribute('disabled');
  return { play: enabled('Play'), go: enabled('Go'), cashOut: enabled('Cash out') };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const ROUND: RoundState = {
  status: 'playing',
  difficulty: 'easy',
  bet: 10,
  stepIndex: 0,
  multiplier: 1,
  balance: 990,
};

function stepResult(overrides: Partial<StepResult> = {}): StepResult {
  return {
    survived: true,
    stepIndex: 1,
    multiplier: 1.22,
    status: 'playing',
    win: 0,
    balance: 990,
    ...overrides,
  };
}

/** Answers like an engine with a $1000 wallet and a $10 bet; tests override single answers. */
function renderRound() {
  const engine = {
    startRound: vi.fn<GameEngine['startRound']>().mockResolvedValue(ROUND),
    step: vi.fn<GameEngine['step']>().mockResolvedValue(stepResult()),
    cashOut: vi.fn<GameEngine['cashOut']>().mockResolvedValue({ win: 12.2, balance: 1002.2 }),
  };
  const store = createGameStore({
    engine,
    settings: { balance: 1000, difficulty: 'easy', bet: 10 },
  });
  render(<App store={store} />);
  return { engine, store };
}

const button = (name: string) =>
  within(screen.getByRole('region', { name: 'Game controls' })).getByRole('button', {
    name: actionName(name),
  });
const balance = () => screen.getByRole('status', { name: 'Balance' });
const settled = (store: GameStore) => waitFor(() => expect(store.getState().busy).toBe(false));

async function startRound(store: GameStore) {
  fireEvent.click(button('Play'));
  await settled(store);
}

describe('Round actions', () => {
  it('starts a round and takes the first step on Play', async () => {
    const { engine, store } = renderRound();

    await startRound(store);

    expect(engine.startRound).toHaveBeenCalledExactlyOnceWith(10, 'easy');
    expect(engine.step).toHaveBeenCalledOnce();
    expect(actionStates()).toEqual({ play: false, go: true, cashOut: true });
    expect(balance()).toHaveTextContent('$990.00');
    expect(screen.getByText('x1.22')).toBeInTheDocument();
    expect(betInput()).toBeDisabled();
    expect(screen.getByRole('group', { name: 'Difficulty' })).toBeDisabled();
  });

  it('locks every action until the engine and the animation are done', async () => {
    const { engine, store } = renderRound();
    const answer = deferred<RoundState>();
    engine.startRound.mockReturnValueOnce(answer.promise);

    fireEvent.click(button('Play'));

    expect(actionStates()).toEqual({ play: false, go: false, cashOut: false });
    expect(betInput()).toBeDisabled();
    fireEvent.click(button('Play'));
    await act(async () => answer.resolve(ROUND));
    await settled(store);
    expect(engine.startRound).toHaveBeenCalledOnce();
    expect(actionStates()).toEqual({ play: false, go: true, cashOut: true });
  });

  it('takes the next step on Go', async () => {
    const { engine, store } = renderRound();
    await startRound(store);
    engine.step.mockResolvedValueOnce(stepResult({ stepIndex: 2, multiplier: 1.48 }));

    fireEvent.click(button('Go'));
    await settled(store);

    expect(engine.step).toHaveBeenCalledTimes(2);
    expect(screen.getByText('x1.48')).toBeInTheDocument();
    expect(actionStates()).toEqual({ play: false, go: true, cashOut: true });
  });

  it('shows the crash and offers a new round', async () => {
    const { engine, store } = renderRound();
    engine.step.mockResolvedValueOnce(stepResult({ survived: false, status: 'crashed' }));

    await startRound(store);

    expect(screen.getByText('Crashed')).toBeInTheDocument();
    expect(screen.getByText('-$10.00')).toBeInTheDocument();
    expect(balance()).toHaveTextContent('$990.00');
    expect(actionStates()).toEqual({ play: true, go: false, cashOut: false });
    expect(betInput()).toBeEnabled();
    expect(screen.getByRole('group', { name: 'Difficulty' })).toBeEnabled();
  });

  it('shows the payout and balance the engine reports on Cash out', async () => {
    const { engine, store } = renderRound();
    await startRound(store);

    fireEvent.click(button('Cash out'));
    await settled(store);

    expect(engine.cashOut).toHaveBeenCalledOnce();
    expect(screen.getByText('Cashed out')).toBeInTheDocument();
    expect(screen.getByText('+$12.20')).toBeInTheDocument();
    expect(balance()).toHaveTextContent('$1,002.20');
    expect(actionStates()).toEqual({ play: true, go: false, cashOut: false });
  });

  it('shows the finish with the engine payout', async () => {
    const { engine, store } = renderRound();
    await startRound(store);
    engine.step.mockResolvedValueOnce(
      stepResult({ stepIndex: 24, multiplier: 24.5, status: 'finished', win: 245, balance: 1235 }),
    );

    fireEvent.click(button('Go'));
    await settled(store);

    expect(screen.getByText('Finished')).toBeInTheDocument();
    expect(screen.getByText('+$245.00')).toBeInTheDocument();
    expect(balance()).toHaveTextContent('$1,235.00');
    expect(actionStates()).toEqual({ play: true, go: false, cashOut: false });
  });

  it('starts the next round straight from a result', async () => {
    const { engine, store } = renderRound();
    await startRound(store);
    fireEvent.click(button('Cash out'));
    await settled(store);
    engine.startRound.mockResolvedValueOnce({ ...ROUND, balance: 992.2 });
    engine.step.mockResolvedValueOnce(stepResult({ balance: 992.2 }));

    await startRound(store);

    expect(engine.startRound).toHaveBeenCalledTimes(2);
    expect(screen.getByText('x1.22')).toBeInTheDocument();
    expect(balance()).toHaveTextContent('$992.20');
    expect(actionStates()).toEqual({ play: false, go: true, cashOut: true });
  });

  describe('keeps a result tied to its round', () => {
    const increaseBet = () => fireEvent.click(screen.getByRole('button', { name: 'Increase bet' }));

    it('keeps the crash loss when the bet changes afterwards', async () => {
      const { engine, store } = renderRound();
      engine.step.mockResolvedValueOnce(stepResult({ survived: false, status: 'crashed' }));
      await startRound(store);

      increaseBet();

      expect(betInput()).toHaveValue('11.00');
      expect(screen.getByText('Crashed')).toBeInTheDocument();
      expect(screen.getByText('-$10.00')).toBeInTheDocument();
    });

    it('keeps the cash out win when the bet changes afterwards', async () => {
      const { store } = renderRound();
      await startRound(store);
      fireEvent.click(button('Cash out'));
      await settled(store);

      increaseBet();

      expect(screen.getByText('Cashed out')).toBeInTheDocument();
      expect(screen.getByText('+$12.20')).toBeInTheDocument();
    });

    it('keeps the finish payout when the bet changes afterwards', async () => {
      const { engine, store } = renderRound();
      engine.step.mockResolvedValueOnce(
        stepResult({
          stepIndex: 24,
          multiplier: 24.5,
          status: 'finished',
          win: 245,
          balance: 1235,
        }),
      );
      await startRound(store);

      increaseBet();

      expect(screen.getByText('Finished')).toBeInTheDocument();
      expect(screen.getByText('+$245.00')).toBeInTheDocument();
    });

    it('returns to Ready when the difficulty changes after a result', async () => {
      const { store } = renderRound();
      await startRound(store);
      fireEvent.click(button('Cash out'));
      await settled(store);

      fireEvent.click(screen.getByRole('radio', { name: /^hard\b/i }));

      expect(screen.getByText('Ready')).toBeInTheDocument();
      expect(screen.queryByText('+$12.20')).not.toBeInTheDocument();
      expect(balance()).toHaveTextContent('$1,002.20');
      expect(actionStates()).toEqual({ play: true, go: false, cashOut: false });
    });
  });

  it('reports a rejected round and keeps Play available', async () => {
    const { engine, store } = renderRound();
    engine.startRound.mockRejectedValueOnce(
      new EngineError('INSUFFICIENT_BALANCE', 'Bet exceeds the available balance'),
    );

    await startRound(store);

    expect(screen.getByRole('alert')).toHaveTextContent('Bet exceeds the available balance');
    expect(balance()).toHaveTextContent('$1,000.00');
    expect(actionStates()).toEqual({ play: true, go: false, cashOut: false });
  });
});

describe('Keyboard', () => {
  const press = (key: string, target: Element = document.body) =>
    fireEvent.keyDown(target, { key });

  it('plays with Space and steps with Space during a round', async () => {
    const { engine, store } = renderRound();

    press(' ');
    await settled(store);
    expect(engine.startRound).toHaveBeenCalledOnce();

    press(' ');
    await settled(store);
    expect(engine.step).toHaveBeenCalledTimes(2);
    expect(engine.cashOut).not.toHaveBeenCalled();
  });

  it('cashes out with Enter during a round and starts a round with it between rounds', async () => {
    const { engine, store } = renderRound();

    press('Enter');
    await settled(store);
    expect(engine.startRound).toHaveBeenCalledOnce();

    press('Enter');
    await settled(store);
    expect(engine.cashOut).toHaveBeenCalledOnce();
    expect(engine.step).toHaveBeenCalledOnce();
  });

  it('ignores repeated presses while an action is running', async () => {
    const { engine, store } = renderRound();
    const answer = deferred<RoundState>();
    engine.startRound.mockReturnValueOnce(answer.promise);

    press(' ');
    press(' ');
    press('Enter');
    await act(async () => answer.resolve(ROUND));
    await settled(store);

    expect(engine.startRound).toHaveBeenCalledOnce();
    expect(engine.step).toHaveBeenCalledOnce();
    expect(engine.cashOut).not.toHaveBeenCalled();
  });

  it('keeps the page from scrolling on Space', () => {
    renderRound();

    expect(press(' ')).toBe(false);
  });

  it('leaves Space and Enter to the bet input', async () => {
    const { engine, store } = renderRound();

    fireEvent.change(betInput(), { target: { value: '15' } });
    expect(press(' ', betInput())).toBe(true);
    press('Enter', betInput());
    await settled(store);

    expect(engine.startRound).not.toHaveBeenCalled();
    expect(store.getState().bet).toBe(15);
  });

  // The lock only covers the action itself, so a held key would otherwise walk on by itself.
  it('acts once per press, not again while the key is held down', async () => {
    const { engine, store } = renderRound();
    const hold = (key: string) => fireEvent.keyDown(document.body, { key, repeat: true });

    press(' ');
    await settled(store);
    expect(hold(' ')).toBe(false);
    hold('Enter');
    await settled(store);

    expect(engine.startRound).toHaveBeenCalledOnce();
    expect(engine.step).toHaveBeenCalledOnce();
    expect(engine.cashOut).not.toHaveBeenCalled();
  });

  it('leaves Space and Enter to a focused button', async () => {
    const { engine, store } = renderRound();
    const toggle = screen.getByRole('button', { name: 'Sound' });

    expect(press(' ', toggle)).toBe(true);
    press('Enter', toggle);
    await settled(store);

    expect(engine.startRound).not.toHaveBeenCalled();
  });
});

describe('Round status', () => {
  it('shows the live multiplier during a round', () => {
    const store = renderApp();

    act(() => store.setState({ status: 'playing', multiplier: 1.22 }));

    expect(screen.getByText('x1.22')).toBeInTheDocument();
  });

  it.each([
    ['cashed_out', 'Cashed out', '+$12.20'],
    ['finished', 'Finished', '+$12.20'],
    ['crashed', 'Crashed', '-$1.00'],
  ] as const)('labels the %s outcome', (status, label, value) => {
    const store = renderApp();

    act(() => store.setState({ status, roundBet: 1, win: status === 'crashed' ? 0 : 12.2 }));

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(value)).toBeInTheDocument();
  });
});

describe('Bet control', () => {
  it('shows the current bet', () => {
    renderApp({ bet: 25 });

    expect(betInput()).toHaveValue('25.00');
  });

  it('commits a typed bet to the store on Enter', () => {
    const store = renderApp();

    fireEvent.change(betInput(), { target: { value: '12.5' } });
    fireEvent.keyDown(betInput(), { key: 'Enter' });

    expect(store.getState().bet).toBe(12.5);
    expect(betInput()).toHaveValue('12.50');
  });

  it('passes an invalid bet through unchanged and reports the engine rule', () => {
    const store = renderApp();

    fireEvent.change(betInput(), { target: { value: '1.234' } });
    fireEvent.blur(betInput());

    expect(store.getState().bet).toBe(1.234);
    expect(betInput()).toHaveValue('1.234');
    expect(betInput()).toHaveAttribute('aria-invalid', 'true');
    expect(betInput()).toHaveAccessibleDescription(/two decimal places/);
  });

  it('reports an out-of-range bet without clamping it', () => {
    const store = renderApp();

    fireEvent.change(betInput(), { target: { value: '500' } });
    fireEvent.blur(betInput());

    expect(store.getState().bet).toBe(500);
    expect(betInput()).toHaveAccessibleDescription(/between 0.01 and 200/);
  });

  it('ignores text that is not a number', () => {
    const store = renderApp({ bet: 3 });

    fireEvent.change(betInput(), { target: { value: 'abc' } });
    fireEvent.blur(betInput());

    expect(store.getState().bet).toBe(3);
    expect(betInput()).toHaveValue('3.00');
  });

  it('steps the bet and disables steps the engine would reject', () => {
    const store = renderApp({ bet: 1 });
    const decrease = screen.getByRole('button', { name: 'Decrease bet' });
    const increase = screen.getByRole('button', { name: 'Increase bet' });

    expect(decrease).toBeDisabled();
    fireEvent.click(increase);
    expect(store.getState().bet).toBe(2);
    fireEvent.click(decrease);
    expect(store.getState().bet).toBe(1);

    act(() => store.setState({ bet: 199.5 }));
    expect(increase).toBeDisabled();
  });

  it('is locked while a round is in progress', () => {
    const store = renderApp();

    act(() => store.setState({ status: 'playing' }));

    expect(betInput()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Increase bet' })).toBeDisabled();
  });
});

describe('Difficulty selector', () => {
  it('offers all four levels with the engine configuration', () => {
    renderApp({ difficulty: 'medium' });

    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual([
      'easy',
      'medium',
      'hard',
      'hardcore',
    ]);
    expect(screen.getByRole('radio', { name: /medium/i })).toBeChecked();
    const { steps, traps } = DIFFICULTIES.hardcore;
    expect(screen.getByText(`${steps} steps · ${traps} traps`)).toBeInTheDocument();
  });

  it('changes the difficulty through the store', () => {
    const store = renderApp();

    fireEvent.click(screen.getByRole('radio', { name: /^hard\b/i }));

    expect(store.getState().difficulty).toBe('hard');
    expect(screen.getByRole('radio', { name: /^hard\b/i })).toBeChecked();
  });

  it('is locked while a round is in progress', () => {
    const store = renderApp();

    act(() => store.setState({ status: 'playing' }));

    expect(screen.getByRole('group', { name: 'Difficulty' })).toBeDisabled();
  });
});

describe('Round summary', () => {
  const summary = () => within(screen.getByRole('main', { name: 'Game' })).getByRole('status');

  it('invites a bet before the first round', () => {
    renderApp();

    expect(summary()).toHaveTextContent('Ready');
    expect(summary()).toHaveTextContent('Choose your bet and start');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows how far the chicken got out of the lanes of the level', async () => {
    const { engine, store } = renderRound();
    await startRound(store);
    engine.step.mockResolvedValueOnce(stepResult({ stepIndex: 2, multiplier: 1.48 }));
    fireEvent.click(button('Go'));
    await settled(store);

    expect(summary()).toHaveTextContent('Lane 2 of 24');
    expect(screen.getByRole('progressbar', { name: 'Lanes crossed' })).toHaveAttribute(
      'aria-valuenow',
      '2',
    );
  });

  it('names the payout on Cash out while there is one to collect', async () => {
    const { store } = renderRound();
    await startRound(store);

    // x1.22 on a $10 bet, worked out by the engine's own payout rule.
    expect(button('Cash out')).toHaveAccessibleName('Cash out $12.20');

    fireEvent.click(button('Cash out'));
    await settled(store);
    expect(button('Cash out')).toHaveAccessibleName('Cash out');
  });

  it('tells the multiplier and lane of a cash out', async () => {
    const { store } = renderRound();
    await startRound(store);
    fireEvent.click(button('Cash out'));
    await settled(store);

    expect(summary()).toHaveTextContent('x1.22 · lane 1 of 24');
  });

  it('tells the lane a crash happened on', async () => {
    const { engine, store } = renderRound();
    engine.step.mockResolvedValueOnce(stepResult({ survived: false, status: 'crashed' }));
    await startRound(store);

    expect(summary()).toHaveTextContent('Hit on lane 1 of 24 · bet lost');
  });

  it('tells the final multiplier of a finished crossing', async () => {
    const { engine, store } = renderRound();
    engine.step.mockResolvedValueOnce(
      stepResult({ stepIndex: 24, multiplier: 24.5, status: 'finished', win: 245, balance: 1235 }),
    );
    await startRound(store);

    expect(summary()).toHaveTextContent('x24.50 · all 24 lanes crossed');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '24');
  });

  it('marks the controls as busy while an action runs', async () => {
    const { engine, store } = renderRound();
    const answer = deferred<RoundState>();
    engine.startRound.mockReturnValueOnce(answer.promise);
    const panel = screen.getByRole('region', { name: 'Game controls' });

    fireEvent.click(button('Play'));
    expect(panel).toHaveAttribute('aria-busy', 'true');

    await act(async () => answer.resolve(ROUND));
    await settled(store);
    expect(panel).toHaveAttribute('aria-busy', 'false');
  });

  it('says the bet and difficulty are locked during a round', () => {
    const store = renderApp();
    expect(screen.queryByText('Locked this round')).not.toBeInTheDocument();

    act(() => store.setState({ status: 'playing' }));

    expect(screen.getAllByText('Locked this round')).toHaveLength(2);
  });

  it('advertises the keyboard shortcut of each action', () => {
    renderApp();

    expect(button('Play')).toHaveAttribute('aria-keyshortcuts', 'Space Enter');
    expect(button('Go')).toHaveAttribute('aria-keyshortcuts', 'Space');
    expect(button('Cash out')).toHaveAttribute('aria-keyshortcuts', 'Enter');
  });
});

describe('Bet presets', () => {
  it('sets the bet through the store and marks the matching preset', () => {
    const store = renderApp({ bet: 3 });
    const presets = screen.getByRole('group', { name: 'Quick bets' });

    fireEvent.click(within(presets).getByRole('button', { name: '$10' }));

    expect(store.getState().bet).toBe(10);
    expect(betInput()).toHaveValue('10.00');
    expect(within(presets).getByRole('button', { name: '$10' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(presets).getByRole('button', { name: '$5' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('is locked while a round is in progress', () => {
    const store = renderApp();

    act(() => store.setState({ status: 'playing' }));

    const presets = within(screen.getByRole('group', { name: 'Quick bets' }));
    expect(presets.getAllByRole('button').every((preset) => preset.hasAttribute('disabled'))).toBe(
      true,
    );
  });
});

describe('Difficulty summary', () => {
  it('describes the risk and the top multiplier of the selected level', () => {
    const store = renderApp();
    const top = (difficulty: Difficulty) => getMultiplierTable(difficulty).at(-1) as number;

    expect(screen.getByText(/24 steps · 1 trap · up to/)).toHaveTextContent(
      `x${top('easy').toFixed(2)}`,
    );

    act(() => store.getState().setDifficulty('hardcore'));

    expect(screen.getByText(/15 steps · 10 traps · up to/)).toHaveTextContent(
      `x${top('hardcore').toFixed(2)}`,
    );
  });
});

describe('Balance', () => {
  it('marks which way the balance moved on its last change', () => {
    const store = renderApp({ balance: 100 });

    expect(balance()).not.toHaveAttribute('data-trend');
    act(() => store.setState({ balance: 99 }));
    expect(balance()).toHaveAttribute('data-trend', 'down');
    act(() => store.setState({ balance: 120.5 }));
    expect(balance()).toHaveAttribute('data-trend', 'up');
    expect(balance()).toHaveTextContent('$120.50');
  });
});

describe('Before the scene is ready', () => {
  function renderWaiting() {
    const engine = {
      startRound: vi.fn<GameEngine['startRound']>().mockResolvedValue(ROUND),
      step: vi.fn<GameEngine['step']>().mockResolvedValue(stepResult()),
      cashOut: vi.fn<GameEngine['cashOut']>().mockResolvedValue({ win: 12.2, balance: 1002.2 }),
    };
    const store = createGameStore({
      engine,
      settings: { balance: 1000, difficulty: 'easy', bet: 10 },
      awaitScene: true,
    });
    render(<App store={store} />);
    return { engine, store };
  }

  it('keeps every control unavailable and ignores the keyboard', () => {
    const { engine } = renderWaiting();
    const panel = screen.getByRole('region', { name: 'Game controls' });

    expect(panel).toHaveAttribute('aria-busy', 'true');
    for (const name of ['Play', 'Go', 'Cash out']) expect(button(name)).toBeDisabled();
    expect(betInput()).toBeDisabled();
    // Nothing is locked by a round; the game is just not there yet.
    expect(screen.queryByText('Locked this round')).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: ' ' });
    fireEvent.keyDown(document.body, { key: 'Enter' });

    expect(engine.startRound).not.toHaveBeenCalled();
  });

  it('becomes playable once a scene is attached, with the saved settings intact', async () => {
    const { engine, store } = renderWaiting();

    act(() => void store.getState().attachScene(instantScene));

    expect(button('Play')).toBeEnabled();
    expect(betInput()).toHaveValue('10.00');
    expect(balance()).toHaveTextContent('$1,000.00');
    fireEvent.keyDown(document.body, { key: ' ' });
    await settled(store);
    expect(engine.startRound).toHaveBeenCalledWith(10, 'easy');
  });
});
