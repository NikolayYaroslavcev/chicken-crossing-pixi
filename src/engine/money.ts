import { EngineError } from './errors';

export const MIN_BET = 0.01;
export const MAX_BET = 200;

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function validateBet(bet: number): void {
  if (typeof bet !== 'number' || !Number.isFinite(bet)) {
    throw new EngineError('INVALID_BET', `Bet must be a finite number, got ${String(bet)}`);
  }
  if (bet < MIN_BET || bet > MAX_BET) {
    throw new EngineError('INVALID_BET', `Bet must be between ${MIN_BET} and ${MAX_BET}`);
  }
  if (Math.abs(bet * 100 - toCents(bet)) > 1e-6) {
    throw new EngineError('INVALID_BET', 'Bet cannot have more than two decimal places');
  }
}

/** Payout is floored to whole cents, like the displayed multiplier. */
export function calculateWin(bet: number, multiplier: number): number {
  return fromCents(Math.floor((toCents(bet) * toCents(multiplier)) / 100));
}
