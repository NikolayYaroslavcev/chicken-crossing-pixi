import { EngineError } from './errors';
import { fromCents, toCents } from './money';
import { cashOutRound, createRound, stepRound, type Round } from './round';
import { createRng, type Rng } from './rng';
import type { CashOutResult, Difficulty, GameEngine, RoundState, StepResult } from './types';

export interface Latency {
  min: number;
  max: number;
}

export interface MockEngineOptions {
  seed?: number;
  balance?: number;
  latency?: Latency;
}

export const DEFAULT_BALANCE = 1000;
const DEFAULT_LATENCY: Latency = { min: 100, max: 300 };

export class MockEngine implements GameEngine {
  private readonly rng: Rng;
  private readonly latency: Latency;
  private balanceCents: number;
  private round: Round | null = null;

  constructor({
    seed = Date.now(),
    balance = DEFAULT_BALANCE,
    latency = DEFAULT_LATENCY,
  }: MockEngineOptions = {}) {
    this.rng = createRng(seed);
    this.latency = latency;
    this.balanceCents = toCents(balance);
  }

  startRound(bet: number, difficulty: Difficulty): Promise<RoundState> {
    return this.respond(() => {
      if (this.round?.status === 'playing') {
        throw new EngineError('INVALID_STATE', 'Cannot start a round while another is playing');
      }
      const round = createRound(bet, difficulty, this.rng);
      if (toCents(bet) > this.balanceCents) {
        throw new EngineError('INSUFFICIENT_BALANCE', 'Bet exceeds the available balance');
      }
      this.balanceCents -= toCents(bet);
      this.round = round;
      return this.snapshot(round);
    });
  }

  step(): Promise<StepResult> {
    return this.respond(() => {
      const { round, result } = stepRound(this.round);
      this.settle(round);
      return { ...result, status: round.status, win: round.win, balance: this.balance };
    });
  }

  cashOut(): Promise<CashOutResult> {
    return this.respond(() => {
      const round = cashOutRound(this.round);
      this.settle(round);
      return { win: round.win, balance: this.balance };
    });
  }

  private settle(round: Round): void {
    this.round = round;
    this.balanceCents += toCents(round.win);
  }

  private get balance(): number {
    return fromCents(this.balanceCents);
  }

  private snapshot(round: Round): RoundState {
    return {
      status: round.status,
      difficulty: round.difficulty,
      bet: round.bet,
      stepIndex: round.stepIndex,
      multiplier: round.multiplier,
      balance: this.balance,
    };
  }

  // The round changes before the simulated network delay, so overlapping calls cannot
  // both act on the same state.
  private async respond<T>(action: () => T): Promise<T> {
    const result = action();
    const { min, max } = this.latency;
    const delay = min + Math.random() * (max - min);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return result;
  }
}
