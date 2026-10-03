import { useId, useState, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';
import { EngineError, MAX_BET, MIN_BET, validateBet } from '@/engine';
import type { GameStore } from '@/store';
import { formatAmountInput, formatMoney } from '../format';

const STEP = 1;
const PRESETS = [1, 5, 10, 50] as const;

function betError(bet: number): string | null {
  try {
    validateBet(bet);
    return null;
  } catch (error) {
    return error instanceof EngineError ? error.message : 'This bet is not accepted';
  }
}

export interface BetControlProps {
  store: GameStore;
  disabled?: boolean;
  /** Disabled because a round is on; says so. Defaults to `disabled`. */
  locked?: boolean;
}

export function BetControl({ store, disabled = false, locked = disabled }: BetControlProps) {
  const bet = useStore(store, (state) => state.bet);
  const setBet = useStore(store, (state) => state.setBet);
  // Text being typed; the store keeps the committed bet.
  const [draft, setDraft] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();

  const error = betError(bet);
  const decreased = Math.round((bet - STEP) * 100) / 100;
  const increased = Math.round((bet + STEP) * 100) / 100;

  function commit() {
    if (draft === null) return;
    const text = draft.trim().replace(',', '.');
    const value = Number(text);
    if (text !== '' && Number.isFinite(value)) setBet(value);
    setDraft(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') commit();
    if (event.key === 'Escape') setDraft(null);
  }

  return (
    <div className="field bet">
      <div className="field__head">
        <label className="field__label" htmlFor={inputId}>
          Bet
        </label>
        <span className="field__aside">
          {locked ? (
            'Locked this round'
          ) : (
            <>
              {formatMoney(MIN_BET)} – {formatMoney(MAX_BET)}
            </>
          )}
        </span>
      </div>

      <div className="bet__box" data-invalid={error ? '' : undefined}>
        <button
          type="button"
          className="bet__step"
          aria-label="Decrease bet"
          disabled={disabled || betError(decreased) !== null}
          onClick={() => setBet(decreased)}
        >
          <span aria-hidden="true">−</span>
        </button>
        <span className="bet__amount">
          <span className="bet__currency" aria-hidden="true">
            $
          </span>
          <input
            id={inputId}
            className="bet__input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={draft ?? formatAmountInput(bet)}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? hintId : undefined}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
          />
        </span>
        <button
          type="button"
          className="bet__step"
          aria-label="Increase bet"
          disabled={disabled || betError(increased) !== null}
          onClick={() => setBet(increased)}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>

      <div className="bet__presets" role="group" aria-label="Quick bets">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="chip"
            aria-pressed={bet === preset}
            disabled={disabled}
            onClick={() => {
              setDraft(null);
              setBet(preset);
            }}
          >
            {formatMoney(preset).replace('.00', '')}
          </button>
        ))}
      </div>

      {error && (
        <p className="field__error" id={hintId}>
          {error}
        </p>
      )}
    </div>
  );
}
