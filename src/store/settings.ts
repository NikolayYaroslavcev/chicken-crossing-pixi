import { DEFAULT_BALANCE, isDifficulty, type Difficulty } from '@/engine';

export interface Settings {
  balance: number;
  difficulty: Difficulty;
  bet: number;
}

export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const SETTINGS_KEY = 'chicken-crossing:settings';
export const DEFAULT_BET = 1;

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  balance: DEFAULT_BALANCE,
  difficulty: 'easy',
  bet: DEFAULT_BET,
});

function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function readSaved(storage: SettingsStorage | null): Record<string, unknown> {
  try {
    const saved: unknown = JSON.parse(storage?.getItem(SETTINGS_KEY) ?? 'null');
    return typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function loadSettings(storage: SettingsStorage | null): Settings {
  const { balance, difficulty, bet } = readSaved(storage);
  return {
    balance: isAmount(balance) ? balance : DEFAULT_SETTINGS.balance,
    difficulty: isDifficulty(difficulty) ? difficulty : DEFAULT_SETTINGS.difficulty,
    bet: isAmount(bet) ? bet : DEFAULT_SETTINGS.bet,
  };
}

export function saveSettings(storage: SettingsStorage | null, settings: Settings): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Persistence is best effort: a full or blocked storage must not break the game.
  }
}
