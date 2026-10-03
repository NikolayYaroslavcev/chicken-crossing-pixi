import { MockEngine } from '@/engine';
import { createGameStore } from './createGameStore';
import { loadSettings, type SettingsStorage } from './settings';
import { createSoundSettings } from './sound';

export { canCashOut, canGo, canPlay, cashOutWin, createGameStore } from './createGameStore';
export type {
  GameActions,
  GameState,
  GameStore,
  GameStoreOptions,
  StoreError,
} from './createGameStore';
export { instantScene } from './scene';
export type { GameScene } from './scene';
export { DEFAULT_BET, DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';
export type { Settings, SettingsStorage } from './settings';
export { createSoundSettings, SOUND_SETTINGS_KEY } from './sound';
export type { SoundSettings, SoundSettingsStore } from './sound';

function browserStorage(): SettingsStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const storage = browserStorage();
const settings = loadSettings(storage);

// A fixed seed at build time makes the rounds repeatable for the end-to-end tests.
const seed = Number(import.meta.env.VITE_ENGINE_SEED) || undefined;

// The engine holds the wallet; the saved balance only seeds it on start.
export const gameStore = createGameStore({
  engine: new MockEngine({ seed, balance: settings.balance }),
  settings,
  storage,
  awaitScene: true,
});

export const soundSettings = createSoundSettings(storage);
