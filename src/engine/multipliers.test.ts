// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, DIFFICULTY_LEVELS, getDifficultyConfig, isDifficulty } from './difficulty';
import { EngineError } from './errors';
import type { Difficulty } from './types';
import { getMultiplier, getMultiplierTable, getSurvivalProbability, RTP } from './multipliers';

describe('difficulty config', () => {
  it.each([
    ['easy', 24, 1],
    ['medium', 22, 3],
    ['hard', 20, 5],
    ['hardcore', 15, 10],
  ] as const)('%s has %i steps and %i traps', (difficulty, steps, traps) => {
    expect(getDifficultyConfig(difficulty)).toEqual({ steps, traps });
  });

  it('lists exactly the four levels', () => {
    expect(DIFFICULTY_LEVELS).toEqual(['easy', 'medium', 'hard', 'hardcore']);
    expect(Object.keys(DIFFICULTIES)).toEqual(DIFFICULTY_LEVELS);
  });

  it('cannot be mutated', () => {
    expect(Object.isFrozen(DIFFICULTIES)).toBe(true);
    expect(Object.isFrozen(DIFFICULTIES.easy)).toBe(true);
    expect(() => {
      (DIFFICULTIES.easy as { steps: number }).steps = 99;
    }).toThrow(TypeError);
  });

  it('rejects unknown difficulties', () => {
    expect(isDifficulty('extreme')).toBe(false);
    expect(isDifficulty('toString')).toBe(false);
    expect(() => getDifficultyConfig('extreme' as Difficulty)).toThrow(
      expect.objectContaining({ code: 'INVALID_DIFFICULTY' }),
    );
  });
});

describe('multipliers', () => {
  it.each([
    ['easy', 1.02],
    ['medium', 1.11],
    ['hard', 1.22],
    ['hardcore', 1.63],
  ] as const)('%s starts at x%f', (difficulty, first) => {
    expect(getMultiplier(difficulty, 1)).toBe(first);
  });

  // Every safe lane must be crossed to finish, so the last step survives 1 in C(25, traps)
  // rounds and pays 0.98 times that, with no rounding: 25, 2300, 53 130 and 3 268 760.
  it.each([
    ['easy', 24.5],
    ['medium', 2254],
    ['hard', 52067.4],
    ['hardcore', 3203384.8],
  ] as const)('%s ends at x%f', (difficulty, last) => {
    expect(getMultiplier(difficulty, DIFFICULTIES[difficulty].steps)).toBe(last);
  });

  it.each(DIFFICULTY_LEVELS)('%s has one multiplier per step', (difficulty) => {
    const table = getMultiplierTable(difficulty);
    expect(table).toHaveLength(DIFFICULTIES[difficulty].steps);
    expect(table.at(-1)).toBe(getMultiplier(difficulty, DIFFICULTIES[difficulty].steps));
  });

  it.each(DIFFICULTY_LEVELS)('%s grows strictly with finite values', (difficulty) => {
    const table = getMultiplierTable(difficulty);
    table.forEach((multiplier, i) => {
      expect(Number.isFinite(multiplier)).toBe(true);
      expect(multiplier).toBeGreaterThan(i === 0 ? 1 : (table[i - 1] as number));
    });
  });

  it.each(DIFFICULTY_LEVELS)('%s rounds RTP / P_k down to cents', (difficulty) => {
    getMultiplierTable(difficulty).forEach((multiplier, i) => {
      const exact = RTP / getSurvivalProbability(difficulty, i + 1);
      expect(Math.round(multiplier * 100)).toBeCloseTo(multiplier * 100, 6);
      expect(multiplier).toBeLessThanOrEqual(exact + 1e-9);
      expect(exact - multiplier).toBeLessThan(0.01 + 1e-9);
    });
  });

  it('floors instead of rounding to nearest', () => {
    // medium: 0.98 * 25 / 22 = 1.1136..., hardcore step 2: 0.98 * 600 / 210 = 2.8
    expect(getMultiplier('medium', 1)).toBe(1.11);
    expect(getMultiplier('hardcore', 2)).toBe(2.8);
    // hard: 0.98 * 25 / 20 = 1.225 must not round up to 1.23
    expect(getMultiplier('hard', 1)).toBe(1.22);
  });

  it.each([0, -1, 25, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects step index %s on easy',
    (stepIndex) => {
      expect(() => getMultiplier('easy', stepIndex)).toThrow(EngineError);
      expect(() => getMultiplier('easy', stepIndex)).toThrow(
        expect.objectContaining({ code: 'INVALID_STEP' }),
      );
    },
  );

  it('rejects a step past the last one of a shorter level', () => {
    expect(() => getMultiplier('hardcore', 16)).toThrow(
      expect.objectContaining({ code: 'INVALID_STEP' }),
    );
  });

  it('exposes immutable tables', () => {
    expect(Object.isFrozen(getMultiplierTable('easy'))).toBe(true);
  });
});
