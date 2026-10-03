import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { DIFFICULTIES, type GameStatus } from '@/engine';
import { formatMultiplier } from '@/game/GameScene';
import type { GameState, GameStore } from '@/store';
import { formatMoney } from '../format';

type Tone = 'neutral' | 'live' | 'success' | 'danger';

type ResultState = Pick<GameState, 'stepIndex' | 'multiplier' | 'win' | 'roundBet'> & {
  steps: number;
};

interface ResultView {
  label: string | null;
  value: string;
  detail: string;
  tone: Tone;
  progress: boolean;
}

const describe: Record<GameStatus, (state: ResultState) => ResultView> = {
  idle: () => ({
    label: null,
    value: 'Ready',
    detail: 'Choose your bet and start',
    tone: 'neutral',
    progress: false,
  }),
  playing: ({ multiplier, stepIndex, steps }) => ({
    label: 'Multiplier',
    value: formatMultiplier(multiplier),
    detail: stepIndex === 0 ? 'Crossing the first lane' : `Lane ${stepIndex} of ${steps}`,
    tone: 'live',
    progress: true,
  }),
  cashed_out: ({ win, multiplier, stepIndex, steps }) => ({
    label: 'Cashed out',
    value: `+${formatMoney(win)}`,
    detail: `${formatMultiplier(multiplier)} · lane ${stepIndex} of ${steps}`,
    tone: 'success',
    progress: true,
  }),
  finished: ({ win, multiplier, steps }) => ({
    label: 'Finished',
    value: `+${formatMoney(win)}`,
    detail: `${formatMultiplier(multiplier)} · all ${steps} lanes crossed`,
    tone: 'success',
    progress: true,
  }),
  crashed: ({ roundBet, stepIndex, steps }) => ({
    label: 'Crashed',
    value: `-${formatMoney(roundBet)}`,
    detail: `Hit on lane ${stepIndex} of ${steps} · bet lost`,
    tone: 'danger',
    progress: true,
  }),
};

export interface GameResultProps {
  store: GameStore;
}

export function GameResult({ store }: GameResultProps) {
  const { status, difficulty, ...round } = useStore(
    store,
    useShallow(({ status, difficulty, stepIndex, multiplier, win, roundBet }) => ({
      status,
      difficulty,
      stepIndex,
      multiplier,
      win,
      roundBet,
    })),
  );
  const { steps } = DIFFICULTIES[difficulty];
  const { label, value, detail, tone, progress } = describe[status]({ ...round, steps });

  return (
    <div className="result" data-tone={tone} data-status={status} role="status" aria-live="polite">
      <p className="result__main">
        {label && <span className="result__label">{label}</span>}
        <span className="result__value">{value}</span>
      </p>
      <p className="result__detail">{detail}</p>
      {progress && (
        <span
          className="result__progress"
          role="progressbar"
          aria-label="Lanes crossed"
          aria-valuemin={0}
          aria-valuemax={steps}
          aria-valuenow={round.stepIndex}
        >
          <span style={{ width: `${(round.stepIndex / steps) * 100}%` }} />
        </span>
      )}
    </div>
  );
}
