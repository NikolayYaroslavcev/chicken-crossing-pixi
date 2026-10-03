import { describe, expect, it } from 'vitest';
import { SETTINGS_KEY } from './settings';
import { createSoundSettings, SOUND_SETTINGS_KEY } from './sound';

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

describe('createSoundSettings', () => {
  it('starts with sound on for a first visit', () => {
    expect(createSoundSettings(memoryStorage()).getState().muted).toBe(false);
    expect(createSoundSettings().getState().muted).toBe(false);
  });

  it('saves a mute and an unmute under its own key', () => {
    const storage = memoryStorage();
    const settings = createSoundSettings(storage);

    settings.getState().toggleMuted();
    expect(settings.getState().muted).toBe(true);
    expect(JSON.parse(storage.items.get(SOUND_SETTINGS_KEY) ?? '')).toEqual({ muted: true });

    settings.getState().setMuted(false);
    expect(JSON.parse(storage.items.get(SOUND_SETTINGS_KEY) ?? '')).toEqual({ muted: false });
    expect(storage.items.has(SETTINGS_KEY)).toBe(false);
  });

  it('restores a saved mute after a reload', () => {
    const storage = memoryStorage();
    createSoundSettings(storage).getState().setMuted(true);

    expect(createSoundSettings(storage).getState().muted).toBe(true);
  });

  it('falls back to sound on for anything it cannot read', () => {
    for (const saved of ['not json', '{"muted":"yes"}', 'null', '[]', '{"muted":1}']) {
      const storage = memoryStorage({ [SOUND_SETTINGS_KEY]: saved });
      expect(createSoundSettings(storage).getState().muted).toBe(false);
    }
  });

  it('keeps working when the storage throws', () => {
    const storage = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    const settings = createSoundSettings(storage);

    expect(settings.getState().muted).toBe(false);
    settings.getState().setMuted(true);
    expect(settings.getState().muted).toBe(true);
  });

  it('does not write when the value does not change', () => {
    const storage = memoryStorage();
    createSoundSettings(storage).getState().setMuted(false);

    expect(storage.items.size).toBe(0);
  });
});
