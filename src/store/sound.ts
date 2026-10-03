import { createStore, type StoreApi } from 'zustand/vanilla';
import type { SettingsStorage } from './settings';

export interface SoundSettings {
  muted: boolean;
  setMuted(muted: boolean): void;
  toggleMuted(): void;
}

export type SoundSettingsStore = StoreApi<SoundSettings>;

export const SOUND_SETTINGS_KEY = 'chicken-crossing:sound';

function loadMuted(storage: SettingsStorage | null): boolean {
  try {
    const saved: unknown = JSON.parse(storage?.getItem(SOUND_SETTINGS_KEY) ?? 'null');
    return (
      typeof saved === 'object' && saved !== null && (saved as { muted?: unknown }).muted === true
    );
  } catch {
    return false;
  }
}

function saveMuted(storage: SettingsStorage | null, muted: boolean): void {
  try {
    storage?.setItem(SOUND_SETTINGS_KEY, JSON.stringify({ muted }));
  } catch {
    // Best effort, like the game settings.
  }
}

/** Sound is on for a first visit; a mute choice is saved and restored on the next load. */
export function createSoundSettings(storage: SettingsStorage | null = null): SoundSettingsStore {
  return createStore<SoundSettings>()((set, get) => ({
    muted: loadMuted(storage),
    setMuted(muted) {
      if (muted === get().muted) return;
      set({ muted });
      saveMuted(storage, muted);
    },
    toggleMuted() {
      get().setMuted(!get().muted);
    },
  }));
}
