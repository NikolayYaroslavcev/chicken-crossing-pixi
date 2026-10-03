import { DIFFICULTY_LEVELS, getDifficultyConfig, LANE_COUNT } from './difficulty';
import { EngineError } from './errors';
import type { Difficulty } from './types';

export const RTP = 0.98;
const RTP_PERCENT = 98n;

/**
 * M_k = RTP / P_k, floored to cents. Evaluated as floor(98 * total / safe) over exact integer
 * products, so values such as Easy's final x24.5 are not lost to floating-point drift.
 */
function buildTable(difficulty: Difficulty): readonly number[] {
  const { steps, traps } = getDifficultyConfig(difficulty);
  const table: number[] = [];
  let total = 1n;
  let safe = 1n;
  for (let i = 0; i < steps; i++) {
    total *= BigInt(LANE_COUNT - i);
    safe *= BigInt(LANE_COUNT - traps - i);
    table.push(Number((RTP_PERCENT * total) / safe) / 100);
  }
  return Object.freeze(table);
}

const tables = Object.fromEntries(
  DIFFICULTY_LEVELS.map((difficulty) => [difficulty, buildTable(difficulty)]),
) as Readonly<Record<Difficulty, readonly number[]>>;

function assertStepIndex(difficulty: Difficulty, stepIndex: number): void {
  const { steps } = getDifficultyConfig(difficulty);
  if (!Number.isInteger(stepIndex) || stepIndex < 1 || stepIndex > steps) {
    throw new EngineError(
      'INVALID_STEP',
      `Step index must be an integer from 1 to ${steps} for ${difficulty}, got ${stepIndex}`,
    );
  }
}

/** Multipliers for steps 1..steps; the multiplier of step k is at position k - 1. */
export function getMultiplierTable(difficulty: Difficulty): readonly number[] {
  getDifficultyConfig(difficulty);
  return tables[difficulty];
}

export function getMultiplier(difficulty: Difficulty, stepIndex: number): number {
  assertStepIndex(difficulty, stepIndex);
  return tables[difficulty][stepIndex - 1] as number;
}

export function getSurvivalProbability(difficulty: Difficulty, stepIndex: number): number {
  assertStepIndex(difficulty, stepIndex);
  const { traps } = getDifficultyConfig(difficulty);
  let probability = 1;
  for (let i = 0; i < stepIndex; i++) {
    probability *= (LANE_COUNT - traps - i) / (LANE_COUNT - i);
  }
  return probability;
}
