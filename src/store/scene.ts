import type { CashOutResult, RoundState, StepResult } from '@/engine';

/**
 * What the store needs from the rendering side. Each method plays the outcome the engine
 * already decided and resolves when the animation is over.
 */
export interface GameScene {
  startRound(round: RoundState): Promise<void>;
  step(result: StepResult): Promise<void>;
  cashOut(result: CashOutResult): Promise<void>;
  reset(): void;
}

export const instantScene: GameScene = {
  startRound: () => Promise.resolve(),
  step: () => Promise.resolve(),
  cashOut: () => Promise.resolve(),
  reset: () => {},
};
