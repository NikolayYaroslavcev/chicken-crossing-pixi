// @vitest-environment node
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { DIFFICULTIES } from './difficulty';
import { EngineError } from './errors';
import { MockEngine } from './MockEngine';
import { getMultiplier } from './multipliers';
import { createRng } from './rng';
import { drawLosingStep } from './round';
import type { Difficulty, StepResult } from './types';

const instant = { min: 0, max: 0 };

function seedWhere(difficulty: Difficulty, accept: (losingStep: number | null) => boolean) {
  for (let seed = 0; ; seed++) {
    if (accept(drawLosingStep(difficulty, createRng(seed)))) return seed;
  }
}

function engineWith(
  difficulty: Difficulty,
  accept: (losingStep: number | null) => boolean,
  balance = 100,
) {
  return new MockEngine({ seed: seedWhere(difficulty, accept), balance, latency: instant });
}

async function playUntilOver(engine: MockEngine, difficulty: Difficulty) {
  const results = [];
  for (;;) {
    const result = await engine.step();
    results.push(result);
    if (!result.survived || result.stepIndex === DIFFICULTIES[difficulty].steps) return results;
  }
}

describe('MockEngine', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('startRound', () => {
    it('starts a round and takes the bet from the balance', async () => {
      const engine = new MockEngine({ seed: 1, balance: 100, latency: instant });
      await expect(engine.startRound(25.5, 'hard')).resolves.toEqual({
        status: 'playing',
        difficulty: 'hard',
        bet: 25.5,
        stepIndex: 0,
        multiplier: 1,
        balance: 74.5,
      });
    });

    it.each([0.01, 200])('accepts the bet limit %f', async (bet) => {
      const engine = new MockEngine({ seed: 1, balance: 1000, latency: instant });
      await expect(engine.startRound(bet, 'easy')).resolves.toMatchObject({ bet });
    });

    it.each([
      0,
      -1,
      0.009,
      200.01,
      1.005,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      '10' as unknown as number,
    ])('rejects bet %s without touching the balance', async (bet) => {
      const engine = new MockEngine({ seed: 1, balance: 1000, latency: instant });
      await expect(engine.startRound(bet, 'easy')).rejects.toMatchObject({ code: 'INVALID_BET' });
      await expect(engine.startRound(1, 'easy')).resolves.toMatchObject({ balance: 999 });
    });

    it('rejects an unknown difficulty', async () => {
      const engine = new MockEngine({ seed: 1, latency: instant });
      await expect(engine.startRound(1, 'insane' as Difficulty)).rejects.toMatchObject({
        code: 'INVALID_DIFFICULTY',
      });
    });

    it('rejects a bet above the balance', async () => {
      const engine = new MockEngine({ seed: 1, balance: 5, latency: instant });
      await expect(engine.startRound(5.01, 'easy')).rejects.toMatchObject({
        code: 'INSUFFICIENT_BALANCE',
      });
      await expect(engine.startRound(5, 'easy')).resolves.toMatchObject({ balance: 0 });
    });

    it('rejects a second round while one is playing', async () => {
      const engine = new MockEngine({ seed: 1, latency: instant });
      await engine.startRound(1, 'easy');
      await expect(engine.startRound(1, 'easy')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });

    it.each(['crashed', 'cashed_out', 'finished'] as const)(
      'allows a new round after the round is %s',
      async (outcome) => {
        const engine =
          outcome === 'finished'
            ? engineWith('easy', (step) => step === null)
            : engineWith('easy', (step) => step === 2);
        await engine.startRound(1, 'easy');
        if (outcome === 'cashed_out') {
          await engine.step();
          await engine.cashOut();
        } else {
          await playUntilOver(engine, 'easy');
        }
        await expect(engine.startRound(1, 'medium')).resolves.toMatchObject({
          status: 'playing',
          difficulty: 'medium',
          stepIndex: 0,
        });
      },
    );
  });

  describe('determinism', () => {
    it('picks the same losing step for the same seed and difficulty', async () => {
      const play = async () => {
        const engine = new MockEngine({ seed: 2024, balance: 1000, latency: instant });
        const rounds = [];
        for (let i = 0; i < 5; i++) {
          await engine.startRound(1, 'hard');
          rounds.push(await playUntilOver(engine, 'hard'));
        }
        return rounds;
      };
      expect(await play()).toEqual(await play());
    });

    it('can pick different losing steps for different seeds', async () => {
      const crashSteps = new Set<number>();
      for (let seed = 0; seed < 20; seed++) {
        const engine = new MockEngine({ seed, latency: instant });
        await engine.startRound(1, 'hardcore');
        crashSteps.add((await playUntilOver(engine, 'hardcore')).length);
      }
      expect(crashSteps.size).toBeGreaterThan(1);
    });

    it('follows the losing step drawn at startRound', async () => {
      const seed = seedWhere('medium', (step) => step === 4);
      const engine = new MockEngine({ seed, latency: instant });
      await engine.startRound(1, 'medium');
      const results = await playUntilOver(engine, 'medium');
      expect(results.map((r) => r.survived)).toEqual([true, true, true, false]);
      expect(results.at(-1)?.stepIndex).toBe(4);
    });
  });

  describe('gameplay', () => {
    it('reports successful steps with increasing multipliers', async () => {
      const engine = engineWith('easy', (step) => step === null);
      await engine.startRound(10, 'easy');
      await expect(engine.step()).resolves.toEqual({
        survived: true,
        stepIndex: 1,
        multiplier: 1.02,
        status: 'playing',
        win: 0,
        balance: 90,
      });
      await expect(engine.step()).resolves.toEqual({
        survived: true,
        stepIndex: 2,
        multiplier: getMultiplier('easy', 2),
        status: 'playing',
        win: 0,
        balance: 90,
      });
    });

    it('crashes on the losing step, keeps the stake and blocks further actions', async () => {
      const engine = engineWith('hard', (step) => step === 3, 50);
      await engine.startRound(20, 'hard');
      await engine.step();
      await engine.step();
      await expect(engine.step()).resolves.toEqual({
        survived: false,
        stepIndex: 3,
        multiplier: getMultiplier('hard', 3),
        status: 'crashed',
        win: 0,
        balance: 30,
      });
      await expect(engine.step()).rejects.toMatchObject({ code: 'INVALID_STATE' });
      await expect(engine.cashOut()).rejects.toMatchObject({ code: 'INVALID_STATE' });
      await expect(engine.startRound(1, 'hard')).resolves.toMatchObject({ balance: 29 });
    });

    it('cashes out bet times multiplier, credits the balance and blocks further actions', async () => {
      const engine = engineWith('medium', (step) => step === null || step > 2, 100);
      await engine.startRound(12.34, 'medium');
      await engine.step();
      const { multiplier } = await engine.step();
      const expectedWin = Math.floor((1234 * Math.round(multiplier * 100)) / 100) / 100;

      await expect(engine.cashOut()).resolves.toEqual({
        win: expectedWin,
        balance: Math.round((100 - 12.34 + expectedWin) * 100) / 100,
      });
      await expect(engine.cashOut()).rejects.toMatchObject({ code: 'INVALID_STATE' });
      await expect(engine.step()).rejects.toMatchObject({ code: 'INVALID_STATE' });
      await expect(engine.startRound(1, 'medium')).resolves.toMatchObject({
        balance: Math.round((100 - 12.34 + expectedWin - 1) * 100) / 100,
      });
    });

    it('pays the minimum bet in whole cents', async () => {
      const engine = engineWith('easy', (step) => step === null || step > 1);
      await engine.startRound(0.01, 'easy');
      await engine.step();
      await expect(engine.cashOut()).resolves.toEqual({ win: 0.01, balance: 100 });
    });

    it('rejects cash out before the first step', async () => {
      const engine = new MockEngine({ seed: 1, latency: instant });
      await engine.startRound(1, 'easy');
      await expect(engine.cashOut()).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });

    it('finishes after the last step, pays the top multiplier and blocks further actions', async () => {
      const { steps } = DIFFICULTIES.easy;
      const engine = engineWith('easy', (step) => step === null, 10);
      await engine.startRound(10, 'easy');
      const results = await playUntilOver(engine, 'easy');

      expect(results).toHaveLength(steps);
      expect(results.every((r) => r.survived)).toBe(true);
      expect(results.at(-1)).toEqual({
        survived: true,
        stepIndex: 24,
        multiplier: 24.5,
        status: 'finished',
        win: 245,
        balance: 245,
      });
      await expect(engine.step()).rejects.toMatchObject({ code: 'INVALID_STATE' });
      await expect(engine.startRound(1, 'easy')).resolves.toMatchObject({ balance: 244 });
    });

    it.each([
      ['step', (engine: MockEngine) => engine.step()],
      ['cashOut', (engine: MockEngine) => engine.cashOut()],
    ])('rejects %s before any round', async (_, action) => {
      const engine = new MockEngine({ seed: 1, latency: instant });
      await expect(action(engine)).rejects.toBeInstanceOf(EngineError);
      await expect(action(engine)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });

    it('reports only the statuses a step can lead to', () => {
      expectTypeOf<StepResult['status']>().toEqualTypeOf<'playing' | 'crashed' | 'finished'>();
    });

    it('applies overlapping step calls one after another', async () => {
      const engine = engineWith('easy', (step) => step === null);
      await engine.startRound(1, 'easy');
      const results = await Promise.all([engine.step(), engine.step()]);
      expect(results.map((r) => r.stepIndex)).toEqual([1, 2]);
    });
  });

  describe('latency', () => {
    it('answers within the 100-300 ms window by default', async () => {
      vi.useFakeTimers();
      const engine = new MockEngine({ seed: 1 });
      let settled = false;
      const pending = engine.startRound(1, 'easy').then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(99);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(201);
      expect(settled).toBe(true);
      await pending;
    });
  });
});
