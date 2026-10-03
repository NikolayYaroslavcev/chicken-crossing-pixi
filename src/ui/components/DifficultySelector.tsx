import { useId } from 'react';
import { useStore } from 'zustand';
import { DIFFICULTIES, DIFFICULTY_LEVELS, getMultiplierTable } from '@/engine';
import { formatMultiplier } from '@/game/GameScene';
import type { GameStore } from '@/store';

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export interface DifficultySelectorProps {
  store: GameStore;
  disabled?: boolean;
  /** Disabled because a round is on; says so. Defaults to `disabled`. */
  locked?: boolean;
}

export function DifficultySelector({
  store,
  disabled = false,
  locked = disabled,
}: DifficultySelectorProps) {
  const difficulty = useStore(store, (state) => state.difficulty);
  const setDifficulty = useStore(store, (state) => state.setDifficulty);
  const name = useId();
  const selected = DIFFICULTIES[difficulty];
  const top = getMultiplierTable(difficulty).at(-1) ?? 1;

  return (
    <fieldset className="field difficulty" disabled={disabled}>
      <legend className="field__label">
        Difficulty
        {locked && (
          <span className="field__aside" aria-hidden="true">
            Locked this round
          </span>
        )}
      </legend>
      <div className="difficulty__options">
        {DIFFICULTY_LEVELS.map((level, rank) => {
          const { steps, traps } = DIFFICULTIES[level];
          return (
            <label key={level} className="difficulty__option" data-level={level}>
              <input
                className="visually-hidden"
                type="radio"
                name={name}
                value={level}
                checked={level === difficulty}
                onChange={() => setDifficulty(level)}
              />
              <span className="difficulty__name">{capitalize(level)}</span>{' '}
              <span className="difficulty__meta">
                {steps} steps · {plural(traps, 'trap')}
              </span>
              <span className="difficulty__risk" aria-hidden="true">
                {DIFFICULTY_LEVELS.map((other, index) => (
                  <span key={other} data-on={index <= rank ? '' : undefined} />
                ))}
              </span>
            </label>
          );
        })}
      </div>
      <p className="difficulty__summary">
        {selected.steps} steps · {plural(selected.traps, 'trap')} · up to{' '}
        <strong>{formatMultiplier(top)}</strong>
      </p>
    </fieldset>
  );
}
