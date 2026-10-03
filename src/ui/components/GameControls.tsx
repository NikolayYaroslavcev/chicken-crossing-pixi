import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { canCashOut, canGo, canPlay, cashOutWin, type GameStore } from '@/store';
import { formatMoney } from '../format';
import { BetControl } from './BetControl';
import { DifficultySelector } from './DifficultySelector';
import { GameActions, type ActionPhase } from './GameActions';

export interface GameControlsProps {
  store: GameStore;
}

export function GameControls({ store }: GameControlsProps) {
  // The store ignores bet and difficulty changes mid-round; the controls say so up front.
  const available = useStore(
    store,
    useShallow((state) => ({
      play: canPlay(state),
      go: canGo(state),
      cashOut: canCashOut(state),
      // Waiting for the scene reads the same as an action in progress: nothing to press yet.
      busy: state.busy || !state.sceneReady,
      ready: state.sceneReady,
      win: cashOutWin(state),
    })),
  );
  const { play, go, cashOut } = useStore(
    store,
    useShallow(({ play, go, cashOut }) => ({ play, go, cashOut })),
  );
  const phase: ActionPhase = available.busy ? 'busy' : available.play ? 'ready' : 'playing';

  return (
    <section className="panel" aria-label="Game controls" aria-busy={available.busy}>
      <BetControl
        store={store}
        disabled={!available.play}
        locked={available.ready && !available.play}
      />
      <DifficultySelector
        store={store}
        disabled={!available.play}
        locked={available.ready && !available.play}
      />
      <GameActions
        phase={phase}
        cashOutAmount={available.win > 0 ? formatMoney(available.win) : null}
        onPlay={available.play ? () => void play() : undefined}
        onGo={available.go ? () => void go() : undefined}
        onCashOut={available.cashOut ? () => void cashOut() : undefined}
      />
    </section>
  );
}
