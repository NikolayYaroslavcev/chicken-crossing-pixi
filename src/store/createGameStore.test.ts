// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BALANCE,
  DIFFICULTIES,
  EngineError,
  MockEngine,
  type CashOutResult,
  type GameEngine,
  type RoundState,
  type StepResult,
} from '@/engine';
import { createRng } from '@/engine/rng';
import { drawLosingStep } from '@/engine/round';
import {
  canCashOut,
  canGo,
  canPlay,
  cashOutWin,
  createGameStore,
  type GameStoreOptions,
} from './createGameStore';
import type { GameScene } from './scene';
import { DEFAULT_SETTINGS, loadSettings, SETTINGS_KEY, type SettingsStorage } from './settings';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const ROUND: RoundState = {
  status: 'playing',
  difficulty: 'medium',
  bet: 10,
  stepIndex: 0,
  multiplier: 1,
  balance: 990,
};

function stepResult(overrides: Partial<StepResult> = {}): StepResult {
  return {
    survived: true,
    stepIndex: 1,
    multiplier: 1.11,
    status: 'playing',
    win: 0,
    balance: 990,
    ...overrides,
  };
}

const multiplierAt = (stepIndex: number) => Math.round((1 + 0.11 * stepIndex) * 100) / 100;

/** Survives every step unless a test says otherwise. */
function fakeEngine() {
  let stepIndex = 0;
  return {
    startRound: vi.fn<GameEngine['startRound']>().mockImplementation((bet, difficulty) => {
      stepIndex = 0;
      return Promise.resolve({ ...ROUND, bet, difficulty });
    }),
    step: vi.fn<GameEngine['step']>().mockImplementation(() => {
      stepIndex += 1;
      return Promise.resolve(stepResult({ stepIndex, multiplier: multiplierAt(stepIndex) }));
    }),
    cashOut: vi.fn<GameEngine['cashOut']>().mockResolvedValue({ win: 11.1, balance: 1001.1 }),
  };
}

function fakeScene() {
  return {
    startRound: vi.fn<GameScene['startRound']>().mockResolvedValue(undefined),
    step: vi.fn<GameScene['step']>().mockResolvedValue(undefined),
    cashOut: vi.fn<GameScene['cashOut']>().mockResolvedValue(undefined),
    reset: vi.fn<GameScene['reset']>(),
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      items.set(key, value);
    }),
    saved: () => JSON.parse(items.get(SETTINGS_KEY) ?? 'null') as unknown,
  };
}

function setup(options: Partial<GameStoreOptions> = {}) {
  const engine = fakeEngine();
  const scene = fakeScene();
  const store = createGameStore({
    engine,
    scene,
    settings: { balance: 1000, difficulty: 'medium', bet: 10 },
    ...options,
  });
  return { engine, scene, store, actions: store.getState() };
}

async function setupPlaying(options: Partial<GameStoreOptions> = {}) {
  const context = setup(options);
  await context.actions.play();
  return context;
}

describe('createGameStore', () => {
  describe('initial state', () => {
    it('starts idle with the given settings', () => {
      const { store } = setup();
      expect(store.getState()).toMatchObject({
        status: 'idle',
        difficulty: 'medium',
        bet: 10,
        balance: 1000,
        stepIndex: 0,
        multiplier: 1,
        win: 0,
        busy: false,
        error: null,
      });
    });
  });

  describe('play', () => {
    it('starts a round with the current bet and difficulty and takes the first step', async () => {
      const { store, engine, scene, actions } = setup();
      await actions.play();
      expect(engine.startRound).toHaveBeenCalledExactlyOnceWith(10, 'medium');
      expect(scene.startRound).toHaveBeenCalledExactlyOnceWith(ROUND);
      expect(engine.step).toHaveBeenCalledOnce();
      expect(scene.step).toHaveBeenCalledExactlyOnceWith(
        stepResult({ stepIndex: 1, multiplier: 1.11 }),
      );
      expect(store.getState()).toMatchObject({
        ...ROUND,
        stepIndex: 1,
        multiplier: 1.11,
        win: 0,
        busy: false,
        error: null,
      });
    });

    it('shows the started round while the first step animates and stays busy', async () => {
      const { store, scene, actions } = setup();
      const animation = deferred<undefined>();
      scene.step.mockReturnValueOnce(animation.promise);
      const pending = actions.play();
      await vi.waitFor(() => expect(scene.step).toHaveBeenCalled());
      expect(store.getState()).toMatchObject({
        status: 'playing',
        stepIndex: 0,
        balance: 990,
        busy: true,
      });
      animation.resolve(undefined);
      await pending;
      expect(store.getState()).toMatchObject({ stepIndex: 1, multiplier: 1.11, busy: false });
    });

    it('ends the round when the first step crashes', async () => {
      const { store, engine, actions } = setup();
      engine.step.mockResolvedValueOnce(
        stepResult({ survived: false, stepIndex: 1, multiplier: 1.11, status: 'crashed' }),
      );
      await actions.play();
      const state = store.getState();
      expect(state).toMatchObject({ status: 'crashed', stepIndex: 1, multiplier: 1, win: 0 });
      expect([canPlay(state), canGo(state), canCashOut(state)]).toEqual([true, false, false]);
    });

    it('ends the round when the first step already finishes it', async () => {
      const { store, engine, actions } = setup();
      engine.step.mockResolvedValueOnce(
        stepResult({ stepIndex: 1, multiplier: 2, status: 'finished', win: 20, balance: 1010 }),
      );
      await actions.play();
      expect(store.getState()).toMatchObject({ status: 'finished', win: 20, balance: 1010 });
    });

    it('keeps the started round when the first step is rejected', async () => {
      const { store, engine, actions } = setup();
      engine.step.mockRejectedValueOnce(new EngineError('INVALID_STATE', 'Round is over'));
      await actions.play();
      const state = store.getState();
      expect(state).toMatchObject({
        status: 'playing',
        stepIndex: 0,
        balance: 990,
        busy: false,
        error: { code: 'INVALID_STATE' },
      });
      expect([canGo(state), canCashOut(state)]).toEqual([true, false]);
    });

    it('does not step when the start animation fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { store, engine, scene, actions } = setup();
      scene.startRound.mockRejectedValueOnce(new Error('texture missing'));
      await actions.play();
      expect(engine.step).not.toHaveBeenCalled();
      expect(store.getState()).toMatchObject({
        status: 'playing',
        stepIndex: 0,
        busy: false,
        error: { code: 'UNEXPECTED' },
      });
      consoleError.mockRestore();
    });

    it('starts a new round straight from a finished one', async () => {
      const { store, engine, actions } = await setupPlaying();
      engine.step.mockResolvedValueOnce(stepResult({ survived: false, status: 'crashed' }));
      await actions.go();
      await actions.play();

      expect(engine.startRound).toHaveBeenCalledTimes(2);
      expect(store.getState()).toMatchObject({
        status: 'playing',
        stepIndex: 1,
        multiplier: 1.11,
        win: 0,
      });
    });

    it('does not start a round while one is playing', async () => {
      const { engine, actions } = await setupPlaying();
      await actions.play();
      expect(engine.startRound).toHaveBeenCalledOnce();
    });

    it.each([
      new EngineError('INVALID_BET', 'Bet must be between 0.01 and 200'),
      new EngineError('INSUFFICIENT_BALANCE', 'Bet exceeds the available balance'),
    ])('keeps the previous state when the engine rejects with $code', async (error) => {
      const { store, engine, scene, actions } = setup();
      const before = store.getState();
      engine.startRound.mockRejectedValueOnce(error);
      await actions.play();

      expect(scene.startRound).not.toHaveBeenCalled();
      expect(store.getState()).toEqual({
        ...before,
        error: { code: error.code, message: error.message },
      });
    });
  });

  describe('go', () => {
    it('applies a successful step reported by the engine', async () => {
      const { store, engine, scene, actions } = await setupPlaying();
      const result = stepResult({ stepIndex: 2, multiplier: 1.22 });
      engine.step.mockResolvedValueOnce(result);
      await actions.go();
      expect(engine.step).toHaveBeenCalledTimes(2);
      expect(scene.step).toHaveBeenLastCalledWith(result);
      expect(store.getState()).toMatchObject({
        status: 'playing',
        stepIndex: 2,
        multiplier: 1.22,
        win: 0,
        busy: false,
      });
    });

    it('applies a crash without paying anything', async () => {
      const { store, engine, actions } = await setupPlaying();
      engine.step.mockResolvedValueOnce(stepResult({ stepIndex: 1, multiplier: 1.11 }));
      await actions.go();
      engine.step.mockResolvedValueOnce(
        stepResult({ survived: false, stepIndex: 2, multiplier: 1.22, status: 'crashed' }),
      );
      await actions.go();

      expect(store.getState()).toMatchObject({
        status: 'crashed',
        stepIndex: 2,
        multiplier: 1.11,
        win: 0,
        balance: 990,
        busy: false,
      });
    });

    it('applies the final step with the win and balance from the engine', async () => {
      const { store, engine, actions } = await setupPlaying();
      engine.step.mockResolvedValueOnce(
        stepResult({ stepIndex: 22, multiplier: 50, status: 'finished', win: 500, balance: 1490 }),
      );
      await actions.go();

      expect(store.getState()).toMatchObject({
        status: 'finished',
        stepIndex: 22,
        multiplier: 50,
        win: 500,
        balance: 1490,
      });
    });

    it('does nothing outside a round', async () => {
      const { engine, actions } = setup();
      await actions.go();
      expect(engine.step).not.toHaveBeenCalled();
    });

    it('exposes an engine error and stays in the round', async () => {
      const { store, engine, actions } = await setupPlaying();
      engine.step.mockRejectedValueOnce(new EngineError('INVALID_STATE', 'Round is over'));
      await actions.go();
      expect(store.getState()).toMatchObject({
        status: 'playing',
        stepIndex: 1,
        busy: false,
        error: { code: 'INVALID_STATE', message: 'Round is over' },
      });
    });
  });

  describe('cashOut', () => {
    it('stores the win and balance reported by the engine', async () => {
      const { store, engine, scene, actions } = await setupPlaying();
      await actions.go();
      await actions.cashOut();

      expect(engine.cashOut).toHaveBeenCalledOnce();
      expect(scene.cashOut).toHaveBeenCalledExactlyOnceWith({ win: 11.1, balance: 1001.1 });
      expect(store.getState()).toMatchObject({
        status: 'cashed_out',
        stepIndex: 2,
        multiplier: 1.22,
        win: 11.1,
        balance: 1001.1,
        busy: false,
      });
    });

    it('leaves the round playing when the engine rejects', async () => {
      const { store, engine, scene, actions } = await setupPlaying();
      engine.cashOut.mockRejectedValueOnce(
        new EngineError('INVALID_STATE', 'Cannot cash out before the first step'),
      );
      await actions.cashOut();

      expect(scene.cashOut).not.toHaveBeenCalled();
      expect(store.getState()).toMatchObject({
        status: 'playing',
        win: 0,
        busy: false,
        error: { code: 'INVALID_STATE' },
      });
    });

    it('does nothing outside a round', async () => {
      const { engine, actions } = setup();
      await actions.cashOut();
      expect(engine.cashOut).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('returns a finished round to idle and keeps balance and settings', async () => {
      const { store, scene, actions } = await setupPlaying();
      await actions.go();
      await actions.cashOut();
      actions.reset();

      expect(scene.reset).toHaveBeenCalledOnce();
      expect(store.getState()).toMatchObject({
        status: 'idle',
        stepIndex: 0,
        multiplier: 1,
        win: 0,
        busy: false,
        error: null,
        balance: 1001.1,
        difficulty: 'medium',
        bet: 10,
      });
    });

    it('clears a stored error', async () => {
      const { store, engine, actions } = setup();
      engine.startRound.mockRejectedValueOnce(new EngineError('INVALID_BET', 'Bad bet'));
      await actions.play();
      actions.reset();
      expect(store.getState().error).toBeNull();
    });

    it('cannot abandon a round in progress', async () => {
      const { store, scene, actions } = await setupPlaying();
      actions.reset();
      expect(scene.reset).not.toHaveBeenCalled();
      expect(store.getState().status).toBe('playing');
    });
  });

  describe('settings', () => {
    it('changes bet and difficulty between rounds only', async () => {
      const { store, engine, actions } = setup();
      actions.setBet(25);
      actions.setDifficulty('hardcore');
      await actions.play();
      expect(engine.startRound).toHaveBeenCalledWith(25, 'hardcore');

      actions.setBet(50);
      actions.setDifficulty('easy');
      expect(store.getState()).toMatchObject({ bet: 25, difficulty: 'hardcore' });
    });
  });

  describe('round result', () => {
    const crash = stepResult({ survived: false, status: 'crashed', balance: 999 });

    it('keeps the bet of a crashed round when the next bet changes', async () => {
      const { store, engine, actions } = setup({
        settings: { balance: 1000, difficulty: 'medium', bet: 1 },
      });
      engine.step.mockResolvedValueOnce(crash);
      await actions.play();
      expect(store.getState()).toMatchObject({ status: 'crashed', roundBet: 1, win: 0 });

      actions.setBet(50);
      expect(store.getState()).toMatchObject({
        status: 'crashed',
        roundBet: 1,
        bet: 50,
        balance: 999,
      });

      await actions.play();
      expect(engine.startRound).toHaveBeenLastCalledWith(50, 'medium');
      expect(store.getState()).toMatchObject({ status: 'playing', roundBet: 50, bet: 50 });
    });

    it('keeps the cash out win when the next bet changes', async () => {
      const { store, actions } = await setupPlaying();
      await actions.cashOut();

      actions.setBet(50);
      expect(store.getState()).toMatchObject({
        status: 'cashed_out',
        win: 11.1,
        roundBet: 10,
        balance: 1001.1,
      });
    });

    it('keeps the finish payout when the next bet changes', async () => {
      const { store, engine, actions } = setup();
      engine.step.mockResolvedValueOnce(
        stepResult({ stepIndex: 1, multiplier: 2, status: 'finished', win: 20, balance: 1010 }),
      );
      await actions.play();

      actions.setBet(50);
      expect(store.getState()).toMatchObject({
        status: 'finished',
        win: 20,
        roundBet: 10,
        balance: 1010,
      });
    });

    it.each(['crashed', 'cashed_out', 'finished'] as const)(
      'clears a %s result when the difficulty changes',
      async (status) => {
        const { store, engine, actions } = await setupPlaying();
        if (status === 'cashed_out') await actions.cashOut();
        else
          engine.step.mockResolvedValueOnce(
            stepResult({ survived: status !== 'crashed', status, win: 20, balance: 1010 }),
          );
        if (status !== 'cashed_out') await actions.go();
        const { balance } = store.getState();
        expect(store.getState().status).toBe(status);

        actions.setDifficulty('hardcore');
        expect(store.getState()).toMatchObject({
          status: 'idle',
          stepIndex: 0,
          multiplier: 1,
          win: 0,
          difficulty: 'hardcore',
          bet: 10,
          balance,
        });
        expect(engine.startRound).toHaveBeenCalledOnce();

        await actions.play();
        expect(engine.startRound).toHaveBeenLastCalledWith(10, 'hardcore');
      },
    );

    it('keeps the result when the same difficulty is selected again', async () => {
      const { store, actions } = await setupPlaying();
      await actions.cashOut();
      actions.setDifficulty('medium');
      expect(store.getState()).toMatchObject({ status: 'cashed_out', win: 11.1 });
    });
  });

  describe('busy lock', () => {
    it('ignores a second play while the engine is answering', async () => {
      const { store, engine, actions } = setup();
      const pending = deferred<RoundState>();
      engine.startRound.mockReturnValueOnce(pending.promise);

      const first = actions.play();
      expect(store.getState().busy).toBe(true);
      await actions.play();
      pending.resolve(ROUND);
      await first;

      expect(engine.startRound).toHaveBeenCalledOnce();
      expect(store.getState().busy).toBe(false);
    });

    it('ignores every action while the first step of a new round animates', async () => {
      const { engine, scene, actions } = setup();
      const animation = deferred<undefined>();
      scene.step.mockReturnValueOnce(animation.promise);
      const first = actions.play();
      await vi.waitFor(() => expect(scene.step).toHaveBeenCalled());
      await Promise.all([actions.play(), actions.go(), actions.cashOut()]);
      animation.resolve(undefined);
      await first;
      expect(engine.startRound).toHaveBeenCalledOnce();
      expect(engine.step).toHaveBeenCalledOnce();
      expect(engine.cashOut).not.toHaveBeenCalled();
    });

    it('ignores go and cash out while a step is pending', async () => {
      const { engine, actions } = await setupPlaying();
      const pending = deferred<StepResult>();
      engine.step.mockReturnValueOnce(pending.promise);

      const first = actions.go();
      await Promise.all([actions.go(), actions.cashOut(), actions.play()]);
      pending.resolve(stepResult({ stepIndex: 2 }));
      await first;
      expect(engine.step).toHaveBeenCalledTimes(2);
      expect(engine.cashOut).not.toHaveBeenCalled();
      expect(engine.startRound).toHaveBeenCalledOnce();
    });

    it('ignores go while a cash out is pending', async () => {
      const { engine, actions } = await setupPlaying();
      await actions.go();
      const pending = deferred<CashOutResult>();
      engine.cashOut.mockReturnValueOnce(pending.promise);

      const first = actions.cashOut();
      await Promise.all([actions.go(), actions.cashOut()]);
      pending.resolve({ win: 11.1, balance: 1001.1 });
      await first;
      expect(engine.step).toHaveBeenCalledTimes(2);
      expect(engine.cashOut).toHaveBeenCalledOnce();
    });

    it('ignores settings and reset while busy', async () => {
      const { store, engine, scene, actions } = setup();
      const pending = deferred<RoundState>();
      engine.startRound.mockReturnValueOnce(pending.promise);

      const first = actions.play();
      actions.setBet(99);
      actions.setDifficulty('hard');
      actions.reset();
      pending.resolve(ROUND);
      await first;

      expect(scene.reset).not.toHaveBeenCalled();
      expect(store.getState()).toMatchObject({ bet: 10, status: 'playing' });
    });
  });

  describe('available actions', () => {
    it.each([
      ['idle', 0, false, [true, false, false]],
      ['playing', 0, false, [false, true, false]],
      ['playing', 3, false, [false, true, true]],
      ['playing', 3, true, [false, false, false]],
      ['crashed', 3, false, [true, false, false]],
      ['cashed_out', 3, false, [true, false, false]],
      ['finished', 24, false, [true, false, false]],
      ['finished', 24, true, [false, false, false]],
    ] as const)('%s at step %i, busy %s', (status, stepIndex, busy, expected) => {
      const state = { status, stepIndex, busy, sceneReady: true };
      expect([canPlay(state), canGo(state), canCashOut(state)]).toEqual(expected);
    });

    it.each(['idle', 'playing', 'crashed'] as const)('none while %s without a scene', (status) => {
      const state = { status, stepIndex: 3, busy: false, sceneReady: false };
      expect([canPlay(state), canGo(state), canCashOut(state)]).toEqual([false, false, false]);
    });
  });

  describe('waiting for a scene', () => {
    it('ignores every action until a scene is attached', async () => {
      const { store, engine, actions } = setup({ awaitScene: true });

      expect(store.getState().sceneReady).toBe(false);
      await actions.play();
      actions.setBet(25);
      actions.setDifficulty('hard');

      expect(engine.startRound).not.toHaveBeenCalled();
      expect(store.getState()).toMatchObject({ status: 'idle', bet: 10, difficulty: 'medium' });
    });

    it('plays on the attached scene and waits again once it is detached', async () => {
      const { store, engine, actions } = setup({ awaitScene: true });
      const scene = fakeScene();

      const detach = actions.attachScene(scene);
      expect(store.getState().sceneReady).toBe(true);
      await actions.play();
      expect(scene.startRound).toHaveBeenCalledTimes(1);

      detach();
      expect(store.getState().sceneReady).toBe(false);
      await actions.go();
      expect(engine.step).toHaveBeenCalledTimes(1);

      // A new scene picks up the round where it was left.
      actions.attachScene(fakeScene());
      await actions.go();
      expect(engine.step).toHaveBeenCalledTimes(2);
    });

    it('stays ready when an older scene detaches after a newer one attached', () => {
      const { store, actions } = setup({ awaitScene: true });

      const detachOld = actions.attachScene(fakeScene());
      actions.attachScene(fakeScene());
      detachOld();

      expect(store.getState().sceneReady).toBe(true);
    });

    it('is ready from the start by default', () => {
      expect(setup().store.getState().sceneReady).toBe(true);
    });
  });

  describe('cash out preview', () => {
    it('pays what the engine would pay on cash out', async () => {
      // Seed 1 survives the opening step on easy.
      const engine = new MockEngine({ seed: 1, balance: 100, latency: { min: 0, max: 0 } });
      const store = createGameStore({ engine, settings: { ...DEFAULT_SETTINGS, bet: 3.33 } });
      await store.getState().play();
      expect(store.getState().status).toBe('playing');
      const preview = cashOutWin(store.getState());

      await store.getState().cashOut();

      expect(preview).toBeGreaterThan(3.33);
      expect(store.getState().win).toBe(preview);
    });

    it.each([
      ['idle', 0],
      ['playing', 0],
      ['cashed_out', 3],
      ['crashed', 3],
      ['finished', 24],
    ] as const)('is nothing while %s at step %i', (status, stepIndex) => {
      expect(cashOutWin({ status, stepIndex, roundBet: 10, multiplier: 2 })).toBe(0);
    });
  });

  describe('scene animation', () => {
    it('keeps the previous step until the step animation ends', async () => {
      const { store, scene, actions } = await setupPlaying();
      const animation = deferred<undefined>();
      scene.step.mockReturnValueOnce(animation.promise);

      const pending = actions.go();
      await vi.waitFor(() => expect(scene.step).toHaveBeenCalled());
      expect(store.getState()).toMatchObject({ stepIndex: 1, multiplier: 1.11, busy: true });
      animation.resolve(undefined);
      await pending;
      expect(store.getState()).toMatchObject({ stepIndex: 2, multiplier: 1.22, busy: false });
    });

    it('keeps the round idle until the start animation ends', async () => {
      const { store, scene, actions } = setup();
      const animation = deferred<undefined>();
      scene.startRound.mockReturnValueOnce(animation.promise);

      const pending = actions.play();
      await vi.waitFor(() => expect(scene.startRound).toHaveBeenCalled());
      expect(store.getState()).toMatchObject({ status: 'idle', balance: 1000, busy: true });

      animation.resolve(undefined);
      await pending;
      expect(store.getState()).toMatchObject({ status: 'playing', balance: 990, busy: false });
    });

    it('keeps the cash out pending until its animation ends', async () => {
      const { store, scene, actions } = await setupPlaying();
      await actions.go();
      const animation = deferred<undefined>();
      scene.cashOut.mockReturnValueOnce(animation.promise);

      const pending = actions.cashOut();
      await vi.waitFor(() => expect(scene.cashOut).toHaveBeenCalled());
      expect(store.getState()).toMatchObject({ status: 'playing', win: 0, busy: true });

      animation.resolve(undefined);
      await pending;
      expect(store.getState()).toMatchObject({ status: 'cashed_out', win: 11.1 });
    });

    it('still applies the engine outcome when the animation fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { store, scene, actions } = await setupPlaying();
      scene.step.mockRejectedValueOnce(new Error('texture missing'));
      await actions.go();

      expect(store.getState()).toMatchObject({
        stepIndex: 2,
        busy: false,
        error: { code: 'UNEXPECTED', message: 'Something went wrong' },
      });
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('animates on a scene attached later and falls back after detaching', async () => {
      const { scene: initialScene, store } = setup({ scene: undefined });
      const scene = fakeScene();
      const detach = store.getState().attachScene(scene);
      await store.getState().play();
      expect(scene.startRound).toHaveBeenCalledOnce();
      expect(scene.step).toHaveBeenCalledOnce();
      detach();
      await store.getState().go();
      expect(scene.step).toHaveBeenCalledOnce();
      expect(initialScene.step).not.toHaveBeenCalled();
      expect(store.getState().stepIndex).toBe(2);
    });
  });

  describe('unexpected errors', () => {
    it('hides the internal message and unlocks the store', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { store, engine, actions } = setup();
      engine.startRound.mockRejectedValueOnce(new TypeError('fetch failed at line 42'));
      await actions.play();

      expect(store.getState()).toMatchObject({
        status: 'idle',
        busy: false,
        error: { code: 'UNEXPECTED', message: 'Something went wrong' },
      });
      consoleError.mockRestore();
    });
  });

  describe('persistence', () => {
    it('saves balance and settings but not the round', async () => {
      const storage = memoryStorage();
      const { actions } = await setupPlaying({ storage });
      actions.setBet(5);
      await actions.go();

      expect(storage.saved()).toEqual({ balance: 990, difficulty: 'medium', bet: 10 });
    });

    it('saves settings changes between rounds', () => {
      const storage = memoryStorage();
      const { actions } = setup({ storage });
      actions.setBet(5);
      actions.setDifficulty('hard');
      expect(storage.saved()).toEqual({ balance: 1000, difficulty: 'hard', bet: 5 });
    });

    it('does not write when nothing persistent changed', async () => {
      const storage = memoryStorage();
      const { engine, actions } = setup({ storage });
      engine.startRound.mockRejectedValueOnce(new EngineError('INVALID_BET', 'Bad bet'));
      await actions.play();
      expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('restores settings into an idle store after a reload', async () => {
      const storage = memoryStorage();
      await setupPlaying({ storage });

      const settings = loadSettings(storage);
      const { store } = setup({ storage, settings });
      expect(store.getState()).toMatchObject({
        status: 'idle',
        stepIndex: 0,
        busy: false,
        balance: 990,
        difficulty: 'medium',
        bet: 10,
      });
    });

    it.each([
      ['nothing saved', {}],
      ['broken JSON', { [SETTINGS_KEY]: '{oops' }],
      ['wrong types', { [SETTINGS_KEY]: '{"balance":"lots","difficulty":"insane","bet":-1}' }],
    ])('falls back to defaults with %s', (_, items) => {
      expect(loadSettings(memoryStorage(items))).toEqual(DEFAULT_SETTINGS);
    });

    it('defaults to the engine demo balance', () => {
      expect(loadSettings(null).balance).toBe(DEFAULT_BALANCE);
    });

    it('survives a storage that throws', async () => {
      const storage: SettingsStorage = {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('quota');
        },
      };
      expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
      const { store } = await setupPlaying({ storage });
      expect(store.getState().status).toBe('playing');
    });
  });

  describe('with MockEngine', () => {
    function seedWhere(accept: (losingStep: number | null) => boolean) {
      for (let seed = 0; ; seed++) {
        if (accept(drawLosingStep('easy', createRng(seed)))) return seed;
      }
    }

    function realStore(seed: number) {
      const engine = new MockEngine({ seed, balance: 100, latency: { min: 0, max: 0 } });
      return createGameStore({ engine, settings: { balance: 100, difficulty: 'easy', bet: 10 } });
    }

    it('plays a round to cash out', async () => {
      const store = realStore(seedWhere((step) => step === null || step > 2));
      const { play, go, cashOut, reset } = store.getState();
      await play();
      await go();
      await cashOut();

      const { win, balance, status } = store.getState();
      expect(status).toBe('cashed_out');
      expect(win).toBeGreaterThan(10);
      expect(balance).toBe(Math.round((90 + win) * 100) / 100);

      reset();
      await play();
      expect(store.getState().stepIndex).toBe(1);
    });

    it('plays a round to the final lane', async () => {
      const store = realStore(seedWhere((step) => step === null));
      await store.getState().play();
      while (store.getState().status === 'playing') {
        await store.getState().go();
      }
      expect(store.getState()).toMatchObject({
        status: 'finished',
        stepIndex: DIFFICULTIES.easy.steps,
        multiplier: 24.5,
        win: 245,
        balance: 335,
      });
    });
  });
});
