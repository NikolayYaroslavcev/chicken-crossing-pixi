import { useStore } from 'zustand';
import type { GameStore } from '@/store';

export interface GameNoticeProps {
  store: GameStore;
}

/** The last rejected action; it clears as soon as the next action starts. */
export function GameNotice({ store }: GameNoticeProps) {
  const error = useStore(store, (state) => state.error);
  if (!error) return null;

  return (
    <p className="notice" role="alert">
      <svg className="notice__icon" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M10 5.5v5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="10" cy="14.2" r="1.2" fill="currentColor" />
      </svg>
      <span>{error.message}</span>
    </p>
  );
}
