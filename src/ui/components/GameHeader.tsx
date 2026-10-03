import { useState } from 'react';
import { useStore } from 'zustand';
import type { GameStore, SoundSettingsStore } from '@/store';
import { formatMoney } from '../format';

export interface GameHeaderProps {
  store: GameStore;
  sound: SoundSettingsStore;
}

export function GameHeader({ store, sound }: GameHeaderProps) {
  const balance = useStore(store, (state) => state.balance);
  const muted = useStore(sound, (state) => state.muted);
  const toggleMuted = useStore(sound, (state) => state.toggleMuted);
  const trend = useTrend(balance);

  return (
    <header className="header">
      <h1 className="brand">
        <BrandMark />
        <span className="brand__name">
          Chicken <span className="brand__accent">Crossing</span>
        </span>
      </h1>

      <div className="header__end">
        <div className="balance">
          <span className="balance__label" id="balance-label">
            Balance
          </span>
          <output
            key={balance}
            className="balance__value"
            data-trend={trend ?? undefined}
            aria-labelledby="balance-label"
          >
            {formatMoney(balance)}
          </output>
        </div>

        <div className="header__tools">
          <button
            type="button"
            className="icon-button"
            aria-label="Sound"
            aria-pressed={!muted}
            title={muted ? 'Sound off' : 'Sound on'}
            onClick={toggleMuted}
          >
            <SoundIcon muted={muted} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Settings (not available yet)"
            disabled
          >
            <SettingsIcon />
          </button>
        </div>
      </div>
    </header>
  );
}

function useTrend(value: number): 'up' | 'down' | null {
  const [previous, setPrevious] = useState(value);
  const [trend, setTrend] = useState<'up' | 'down' | null>(null);
  if (value !== previous) {
    setPrevious(value);
    setTrend(value > previous ? 'up' : 'down');
  }
  return trend;
}

function BrandMark() {
  return (
    <svg className="brand__mark" viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="12" fill="var(--color-primary)" />
      <circle cx="16" cy="9.5" r="3.2" fill="var(--color-danger)" />
      <circle cx="21" cy="8.5" r="3.6" fill="var(--color-danger)" />
      <circle cx="25.5" cy="10.5" r="2.8" fill="var(--color-danger)" />
      <ellipse cx="20" cy="23" rx="10.5" ry="11.5" fill="#fffaf0" />
      <circle cx="23.5" cy="20" r="1.8" fill="var(--color-on-primary)" />
      <path d="M29.5 22.5 L35 24.5 L29.5 26.5 Z" fill="#f08a24" />
    </svg>
  );
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      <path
        d={muted ? 'M15.5 9.5l5 5m0-5l-5 5' : 'M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10.3 3h3.4l.5 2.4 1.7 1 2.3-.8 1.7 2.9-1.8 1.6v2l1.8 1.6-1.7 2.9-2.3-.8-1.7 1-.5 2.4h-3.4l-.5-2.4-1.7-1-2.3.8-1.7-2.9 1.8-1.6v-2L3.8 8.5l1.7-2.9 2.3.8 1.7-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
