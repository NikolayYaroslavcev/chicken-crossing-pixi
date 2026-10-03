import { getDifficultyConfig, LANE_COUNT } from './difficulty';
import { EngineError } from './errors';
import { calculateWin, validateBet } from './money';
import { getMultiplier } from './multipliers';
import { randomInt, type Rng } from './rng';
import type { Difficulty, GameStatus, StepResult, StepStatus } from './types';

export interface Round {
  readonly status: Exclude<GameStatus, 'idle'>;
  readonly difficulty: Difficulty;
  readonly bet: number;
  readonly stepIndex: number;
  readonly multiplier: number;
  readonly win: number;
  /** Step that hits a trap, or null when every step of the level is safe. */
  readonly losingStep: number | null;
}

/**
 * Hides the level's traps among all lanes (partial Fisher-Yates) and returns the first trapped
 * step. Since steps = lanes - traps, the round is won only when every trap lies past the last step.
 */
export function drawLosingStep(difficulty: Difficulty, rng: Rng): number | null {
  const { steps, traps } = getDifficultyConfig(difficulty);
  const lanes = Array.from({ length: LANE_COUNT }, (_, lane) => lane);
  let firstTrap = LANE_COUNT;
  for (let i = 0; i < traps; i++) {
    const j = i + randomInt(rng, LANE_COUNT - i);
    const lane = lanes[j] as number;
    lanes[j] = lanes[i] as number;
    lanes[i] = lane;
    firstTrap = Math.min(firstTrap, lane);
  }
  return firstTrap < steps ? firstTrap + 1 : null;
}

export function createRound(bet: number, difficulty: Difficulty, rng: Rng): Round {
  getDifficultyConfig(difficulty);
  validateBet(bet);
  return {
    status: 'playing',
    difficulty,
    bet,
    stepIndex: 0,
    multiplier: 1,
    win: 0,
    losingStep: drawLosingStep(difficulty, rng),
  };
}

function assertPlaying(round: Round | null, action: string): asserts round is Round {
  if (round?.status !== 'playing') {
    throw new EngineError(
      'INVALID_STATE',
      `Cannot ${action} while the round is ${round?.status ?? 'idle'}`,
    );
  }
}

export type RoundStepResult = Pick<StepResult, 'survived' | 'stepIndex' | 'multiplier'>;

export function stepRound(round: Round | null): {
  round: Round & { readonly status: StepStatus };
  result: RoundStepResult;
} {
  assertPlaying(round, 'step');
  const stepIndex = round.stepIndex + 1;
  const multiplier = getMultiplier(round.difficulty, stepIndex);

  if (stepIndex === round.losingStep) {
    return {
      round: { ...round, status: 'crashed', stepIndex },
      result: { survived: false, stepIndex, multiplier },
    };
  }

  const finished = stepIndex === getDifficultyConfig(round.difficulty).steps;
  return {
    round: {
      ...round,
      status: finished ? 'finished' : 'playing',
      stepIndex,
      multiplier,
      win: finished ? calculateWin(round.bet, multiplier) : 0,
    },
    result: { survived: true, stepIndex, multiplier },
  };
}

export function cashOutRound(round: Round | null): Round {
  assertPlaying(round, 'cash out');
  if (round.stepIndex === 0) {
    throw new EngineError('INVALID_STATE', 'Cannot cash out before the first step');
  }
  return { ...round, status: 'cashed_out', win: calculateWin(round.bet, round.multiplier) };
}
