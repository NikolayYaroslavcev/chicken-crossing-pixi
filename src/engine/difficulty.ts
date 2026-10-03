import { EngineError } from './errors';
import type { Difficulty } from './types';

export const LANE_COUNT = 25;

export interface DifficultyConfig {
  readonly steps: number;
  readonly traps: number;
}

export const DIFFICULTIES: Readonly<Record<Difficulty, DifficultyConfig>> = Object.freeze({
  easy: Object.freeze({ steps: 24, traps: 1 }),
  medium: Object.freeze({ steps: 22, traps: 3 }),
  hard: Object.freeze({ steps: 20, traps: 5 }),
  hardcore: Object.freeze({ steps: 15, traps: 10 }),
});

export const DIFFICULTY_LEVELS: readonly Difficulty[] = Object.freeze([
  'easy',
  'medium',
  'hard',
  'hardcore',
]);

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && Object.hasOwn(DIFFICULTIES, value);
}

export function getDifficultyConfig(difficulty: Difficulty): DifficultyConfig {
  if (!isDifficulty(difficulty)) {
    throw new EngineError('INVALID_DIFFICULTY', `Unknown difficulty: ${String(difficulty)}`);
  }
  return DIFFICULTIES[difficulty];
}
