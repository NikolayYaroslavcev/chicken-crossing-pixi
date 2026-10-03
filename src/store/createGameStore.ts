import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  calculateWin,
  EngineError,
  type CashOutResult,
  type Difficulty,
  type EngineErrorCode,
  type GameEngine,
  type RoundState,
  type StepResult,
} from '@/engine';
import { instantScene, type GameScene } from './scene';
import { saveSettings, type Settings, type SettingsStorage } from './settings';

export interface StoreError {
  code: EngineErrorCode | 'UNEXPECTED';
  message: string;
}

export interface GameState extends RoundState {
  /** Payout of the current round; 0 until it is cashed out or finished. */
  win: number;
  /** Bet of the current or last round; `bet` is the setting for the next one. */
  roundBet: number;
  /** True while an engine call or a scene animation is in progress; actions are ignored. */
  busy: boolean;
  /** False while the store waits for a scene to show the rounds; actions are ignored. */
  sceneReady: boolean;
  error: StoreError | null;
}

export interface GameActions {
  play(): Promise<void>;
  go(): Promise<void>;
  cashOut(): Promise<void>;
  reset(): void;
  setBet(bet: number): void;
  setDifficulty(difficulty: Difficulty): void;
  attachScene(scene: GameScene): () => void;
}

export type GameStore = StoreApi<GameState & GameActions>;

export interface GameStoreOptions {
  engine: GameEngine;
  settings: Settings;
  scene?: GameScene;
  storage?: SettingsStorage | null;
  /**
   * Holds every action until `attachScene` connects a scene, and again once it is detached,
   * so nothing is played that the player cannot see. Off by default: the scene passed in
   * (or none) is used straight away.
   */
  awaitScene?: boolean;
}

const ROUND_DEFAULTS = {
  status: 'idle',
  stepIndex: 0,
  multiplier: 1,
  win: 0,
  roundBet: 0,
} as const satisfies Partial<GameState>;

type ActionState = Pick<GameState, 'status' | 'busy' | 'stepIndex' | 'sceneReady'>;

const idle = (state: ActionState) => state.sceneReady && !state.busy;
export const canPlay = (state: ActionState) => idle(state) && state.status !== 'playing';
export const canGo = (state: ActionState) => idle(state) && state.status === 'playing';
/** The engine pays nothing before the first lane is crossed. */
export const canCashOut = (state: ActionState) => canGo(state) && state.stepIndex > 0;

/**
 * What cashing out would pay right now, worked out the way the engine pays it; 0 when there is
 * nothing to collect yet.
 */
export const cashOutWin = (
  state: Pick<GameState, 'status' | 'stepIndex' | 'roundBet' | 'multiplier'>,
) =>
  state.status === 'playing' && state.stepIndex > 0
    ? calculateWin(state.roundBet, state.multiplier)
    : 0;

function toStoreError(error: unknown): StoreError {
  if (error instanceof EngineError) {
    return { code: error.code, message: error.message };
  }
  console.error(error);
  return { code: 'UNEXPECTED', message: 'Something went wrong' };
}

export function createGameStore({
  engine,
  settings,
  scene = instantScene,
  storage = null,
  awaitScene = false,
}: GameStoreOptions): GameStore {
  let currentScene = scene;

  const store = createStore<GameState & GameActions>()((set, get) => {
    // The lock is taken synchronously, so a second call in the same tick already sees busy.
    function lock(canRun: (state: GameState) => boolean): boolean {
      const state = get();
      if (!canRun(state)) return false;
      set({ busy: true, error: null });
      return true;
    }

    async function request<T>(call: () => Promise<T>): Promise<T | null> {
      try {
        return await call();
      } catch (error) {
        set({ busy: false, error: toStoreError(error) });
        return null;
      }
    }

    // The engine has already applied the outcome, so the state follows it even when the
    // animation fails.
    async function animate(play: () => Promise<void>): Promise<StoreError | null> {
      try {
        await play();
        return null;
      } catch (animationError) {
        return toStoreError(animationError);
      }
    }

    async function commit(play: () => Promise<void>, next: Partial<GameState>): Promise<void> {
      const error = await animate(play);
      set({ ...next, busy: false, error });
    }

    // Runs under a lock the caller already holds and releases it when done.
    async function step(): Promise<void> {
      const result = await request<StepResult>(() => engine.step());
      if (!result) return;
      await commit(() => currentScene.step(result), {
        status: result.status,
        stepIndex: result.stepIndex,
        multiplier: result.survived ? result.multiplier : get().multiplier,
        win: result.win,
        balance: result.balance,
      });
    }

    return {
      ...ROUND_DEFAULTS,
      ...settings,
      busy: false,
      sceneReady: !awaitScene,
      error: null,

      // The first step is part of starting a round: the chicken leaves the sidewalk at once.
      async play() {
        if (!lock(canPlay)) return;
        const { bet, difficulty } = get();
        const round = await request<RoundState>(() => engine.startRound(bet, difficulty));
        if (!round) return;
        const error = await animate(() => currentScene.startRound(round));
        // `bet` stays the setting; the round keeps its own copy for the result.
        const { bet: roundBet, ...roundState } = round;
        set({ ...roundState, roundBet, win: 0, busy: error === null, error });
        if (!error) await step();
      },

      async go() {
        if (!lock(canGo)) return;
        await step();
      },

      async cashOut() {
        if (!lock(canCashOut)) return;
        const result = await request<CashOutResult>(() => engine.cashOut());
        if (!result) return;
        await commit(() => currentScene.cashOut(result), {
          status: 'cashed_out',
          win: result.win,
          balance: result.balance,
        });
      },

      reset() {
        if (!canPlay(get())) return;
        set({ ...ROUND_DEFAULTS, error: null });
        currentScene.reset();
      },

      setBet(bet) {
        if (canPlay(get())) set({ bet, error: null });
      },

      // A result belongs to the difficulty it was played on, so a new one clears it.
      setDifficulty(difficulty) {
        const state = get();
        if (!canPlay(state) || difficulty === state.difficulty) return;
        set({ ...ROUND_DEFAULTS, difficulty, error: null });
      },

      attachScene(next) {
        currentScene = next;
        set({ sceneReady: true });
        return () => {
          if (currentScene !== next) return;
          currentScene = instantScene;
          set({ sceneReady: !awaitScene });
        };
      },
    };
  });

  store.subscribe((state, previous) => {
    if (
      state.balance !== previous.balance ||
      state.bet !== previous.bet ||
      state.difficulty !== previous.difficulty
    ) {
      saveSettings(storage, {
        balance: state.balance,
        difficulty: state.difficulty,
        bet: state.bet,
      });
    }
  });

  return store;
}
