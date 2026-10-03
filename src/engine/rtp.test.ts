// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, DIFFICULTY_LEVELS } from './difficulty';
import { getMultiplier, getMultiplierTable, getSurvivalProbability, RTP } from './multipliers';
import { createRng, randomInt } from './rng';
import { cashOutRound, createRound, stepRound } from './round';
import type { Difficulty } from './types';

const ROUNDS = 100_000;

// Cashing out at high multipliers is a long-shot bet whose return cannot be estimated from
// 100k rounds, so the simulated player targets steps paying up to x5. Every step, including
// the last one, is covered exactly by the expected-return test below.
const MAX_TARGET_MULTIPLIER = 5;

function simulate(difficulty: Difficulty, seed: number) {
  const outcomes = createRng(seed);
  const player = createRng(seed ^ 0x9e3779b9);
  const targets = getMultiplierTable(difficulty)
    .map((multiplier, i) => ({ multiplier, stepIndex: i + 1 }))
    .filter(({ multiplier }) => multiplier <= MAX_TARGET_MULTIPLIER)
    .map(({ stepIndex }) => stepIndex);

  let wagered = 0;
  let returned = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const target = targets[randomInt(player, targets.length)] as number;
    let round = createRound(1, difficulty, outcomes);
    wagered += round.bet;
    while (round.status === 'playing' && round.stepIndex < target) {
      round = stepRound(round).round;
    }
    if (round.status === 'playing') {
      round = cashOutRound(round);
    }
    returned += round.win;
  }
  return returned / wagered;
}

describe('RTP', () => {
  it.each(DIFFICULTY_LEVELS)('%s returns about 98% over 100 000 simulated rounds', (difficulty) => {
    const rtp = simulate(difficulty, 20261002);
    expect(Math.abs(rtp - RTP)).toBeLessThan(0.01);
  });

  it.each(DIFFICULTY_LEVELS)(
    '%s expected return of every cash-out step is just under 98%',
    (difficulty) => {
      for (let stepIndex = 1; stepIndex <= DIFFICULTIES[difficulty].steps; stepIndex++) {
        const expected =
          getSurvivalProbability(difficulty, stepIndex) * getMultiplier(difficulty, stepIndex);
        expect(expected).toBeLessThanOrEqual(RTP + 1e-9);
        expect(expected).toBeGreaterThan(RTP - 0.01);
      }
    },
  );

  it('reaches the final easy step in about 1 of 25 rounds', () => {
    const rng = createRng(99);
    let finished = 0;
    for (let i = 0; i < ROUNDS; i++) {
      let round = createRound(1, 'easy', rng);
      while (round.status === 'playing') {
        round = stepRound(round).round;
      }
      if (round.status === 'finished') finished++;
    }
    expect(Math.abs(finished / ROUNDS - 1 / 25)).toBeLessThan(0.003);
  });
});
