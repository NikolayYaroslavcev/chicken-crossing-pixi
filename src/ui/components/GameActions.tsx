export type ActionPhase = 'ready' | 'playing' | 'busy';

export interface GameActionsProps {
  /** Which action leads right now; the buttons themselves follow the handlers. */
  phase: ActionPhase;
  /** What Cash out would pay, already formatted; nothing is shown without it. */
  cashOutAmount?: string | null;
  /** An action without a handler is shown disabled. */
  onPlay?: () => void;
  onGo?: () => void;
  onCashOut?: () => void;
}

const KEY_HINTS: Record<ActionPhase, { key: string; action: string }[]> = {
  ready: [{ key: 'Space', action: 'play' }],
  playing: [
    { key: 'Space', action: 'go' },
    { key: 'Enter', action: 'cash out' },
  ],
  busy: [],
};

export function GameActions({ phase, cashOutAmount, onPlay, onGo, onCashOut }: GameActionsProps) {
  return (
    <div className="actions" data-phase={phase}>
      <button
        type="button"
        className="button button--go"
        aria-keyshortcuts="Space"
        disabled={!onGo}
        onClick={onGo}
      >
        Go
        <svg className="button__icon" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M4 10h11m-4-4.5L15.5 10 11 14.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="button button--cash"
        aria-keyshortcuts="Enter"
        disabled={!onCashOut}
        onClick={onCashOut}
      >
        Cash out {cashOutAmount && <span className="button__amount">{cashOutAmount}</span>}
      </button>
      <button
        type="button"
        className="button button--play"
        aria-keyshortcuts="Space Enter"
        disabled={!onPlay}
        onClick={onPlay}
      >
        Play
      </button>
      <p className="actions__keys" aria-hidden="true">
        {KEY_HINTS[phase].map(({ key, action }) => (
          <span key={key}>
            <kbd>{key}</kbd> {action}
          </span>
        ))}
      </p>
    </div>
  );
}
