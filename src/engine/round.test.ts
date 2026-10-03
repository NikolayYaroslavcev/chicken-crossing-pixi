// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, DIFFICULTY_LEVELS } from './difficulty';
import { getMultiplier } from './multipliers';
import { createRng } from './rng';
import { cashOutRound, createRound, drawLosingStep, stepRound, type Round } from './round';
import type { Difficulty } from './types';

function roundWithLosingStep(difficulty: Difficulty, losingStep: number | null, bet = 10): Round {
  return { ...createRound(bet, difficulty, createRng(1)), losingStep };
}

function stepTimes(round: Round, times: number): Round {
  let current = round;
  for (let i = 0; i < times; i++) {
    current = stepRound(current).round;
  }
  return current;
}

describe('seeded rng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const sequence = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(sequence);
    sequence.forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });
  });

  it('produces different sequences for different seeds', () => {
    expect(createRng(1)()).not.toBe(createRng(2)());
  });
});

describe('drawLosingStep', () => {
  it.each(DIFFICULTY_LEVELS)('is reproducible for %s', (difficulty) => {
    for (let seed = 0; seed < 50; seed++) {
      expect(drawLosingStep(difficulty, createRng(seed))).toBe(
        drawLosingStep(difficulty, createRng(seed)),
      );
    }
  });

  it.each(DIFFICULTY_LEVELS)('varies with the seed and stays in range for %s', (difficulty) => {
    const { steps } = DIFFICULTIES[difficulty];
    const outcomes = new Set<number | null>();
    for (let seed = 0; seed < 500; seed++) {
      const losingStep = drawLosingStep(difficulty, createRng(seed));
      outcomes.add(losingStep);
      if (losingStep !== null) {
        expect(Number.isInteger(losingStep)).toBe(true);
        expect(losingStep).toBeGreaterThanOrEqual(1);
        expect(losingStep).toBeLessThanOrEqual(steps);
      }
    }
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it('crashes on easy step 1 about once in 25 rounds', () => {
    const rng = createRng(7);
    let firstStepCrashes = 0;
    for (let i = 0; i < 25_000; i++) {
      if (drawLosingStep('easy', rng) === 1) firstStepCrashes++;
    }
    expect(firstStepCrashes / 25_000).toBeCloseTo(1 / 25, 2);
  });
});

describe('round lifecycle', () => {
  it('starts playing on the sidewalk with the losing step already chosen', () => {
    const round = createRound(5, 'medium', createRng(3));
    expect(round).toMatchObject({
      status: 'playing',
      difficulty: 'medium',
      bet: 5,
      stepIndex: 0,
      multiplier: 1,
      win: 0,
    });
    expect(round.losingStep).toBe(drawLosingStep('medium', createRng(3)));
  });

  it('advances one step per call with the table multiplier', () => {
    const round = roundWithLosingStep('hard', 4);
    const first = stepRound(round);
    expect(first.result).toEqual({ survived: true, stepIndex: 1, multiplier: 1.22 });
    expect(first.round).toMatchObject({ status: 'playing', stepIndex: 1, multiplier: 1.22 });

    const second = stepRound(first.round);
    expect(second.result).toEqual({
      survived: true,
      stepIndex: 2,
      multiplier: getMultiplier('hard', 2),
    });
  });

  it('does not mutate the previous round', () => {
    const round = roundWithLosingStep('easy', null);
    stepRound(round);
    expect(round.stepIndex).toBe(0);
  });

  it('crashes exactly on the losing step and loses the stake', () => {
    const beforeTrap = stepTimes(roundWithLosingStep('hard', 3), 2);
    const { round, result } = stepRound(beforeTrap);
    expect(result).toEqual({ survived: false, stepIndex: 3, multiplier: getMultiplier('hard', 3) });
    expect(round).toMatchObject({ status: 'crashed', stepIndex: 3, win: 0 });
    expect(round.multiplier).toBe(beforeTrap.multiplier);
  });

  it('can crash on the very first step', () => {
    const { round, result } = stepRound(roundWithLosingStep('hardcore', 1));
    expect(result.survived).toBe(false);
    expect(round.status).toBe('crashed');
  });

  it.each(DIFFICULTY_LEVELS)(
    'finishes %s after the last step and pays the top multiplier',
    (difficulty) => {
      const { steps } = DIFFICULTIES[difficulty];
      const beforeLast = stepTimes(roundWithLosingStep(difficulty, null, 2), steps - 1);
      expect(beforeLast.status).toBe('playing');

      const { round, result } = stepRound(beforeLast);
      const top = getMultiplier(difficulty, steps);
      expect(result).toEqual({ survived: true, stepIndex: steps, multiplier: top });
      expect(round).toMatchObject({ status: 'finished', stepIndex: steps, multiplier: top });
      expect(round.win).toBe(Math.floor(2 * top * 100 + 1e-6) / 100);
    },
  );

  it('crashes on the last step when the trap is there', () => {
    const { round } = stepRound(stepTimes(roundWithLosingStep('easy', 24), 23));
    expect(round.status).toBe('crashed');
  });

  it('cashes out at bet times the current multiplier', () => {
    const round = cashOutRound(stepTimes(roundWithLosingStep('easy', null, 10), 3));
    expect(round).toMatchObject({ status: 'cashed_out', stepIndex: 3 });
    expect(round.win).toBe(Math.floor(10 * getMultiplier('easy', 3) * 100 + 1e-6) / 100);
  });

  it('rejects cash out before the first step', () => {
    expect(() => cashOutRound(roundWithLosingStep('easy', null))).toThrow(
      expect.objectContaining({ code: 'INVALID_STATE' }),
    );
  });

  describe('rejects actions outside of playing', () => {
    const crashed = stepRound(roundWithLosingStep('easy', 1)).round;
    const cashedOut = cashOutRound(stepTimes(roundWithLosingStep('easy', null), 1));
    const finished = stepTimes(roundWithLosingStep('hardcore', null), 15);

    it.each([
      ['no round', null],
      ['crashed', crashed],
      ['cashed_out', cashedOut],
      ['finished', finished],
    ] as const)('%s', (_, round) => {
      expect(() => stepRound(round)).toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
      expect(() => cashOutRound(round)).toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
    });
  });
});
