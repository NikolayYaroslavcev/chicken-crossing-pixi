export type Difficulty = 'easy' | 'medium' | 'hard' | 'hardcore';

export type GameStatus = 'idle' | 'playing' | 'crashed' | 'cashed_out' | 'finished';

/**
 * `stepIndex` is the 1-based number of the lane the chicken is on: 0 before the first step,
 * 1 after the first successful step, `steps` on the final lane.
 */
export interface RoundState {
  status: GameStatus;
  difficulty: Difficulty;
  bet: number;
  stepIndex: number;
  multiplier: number;
  balance: number;
}

export type StepStatus = Extract<GameStatus, 'playing' | 'crashed' | 'finished'>;

/**
 * `status` is the round status after the step. `win` is paid only when the step finishes
 * the round; `balance` already includes it.
 */
export interface StepResult {
  survived: boolean;
  stepIndex: number;
  multiplier: number;
  status: StepStatus;
  win: number;
  balance: number;
}

export interface CashOutResult {
  win: number;
  balance: number;
}

export interface GameEngine {
  startRound(bet: number, difficulty: Difficulty): Promise<RoundState>;
  step(): Promise<StepResult>;
  cashOut(): Promise<CashOutResult>;
}
