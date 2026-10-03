import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOUND_CUES } from './Sound';

const pixiAssets = vi.hoisted(() => ({
  keys: new Set<string>(),
  add: vi.fn(),
  load: vi.fn(),
}));

vi.mock('pixi.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pixi.js')>();
  return {
    ...actual,
    Assets: {
      resolver: { hasKey: (key: string) => pixiAssets.keys.has(key) },
      add: pixiAssets.add,
      load: pixiAssets.load,
    },
  };
});

const library = vi.hoisted(() => {
  const state = {
    context: { state: 'suspended', resume: vi.fn() },
    play: vi.fn(),
    stopAll: vi.fn(),
    module: () => ({
      sound: {
        useLegacy: false,
        get context() {
          return { audioContext: state.context };
        },
        play: state.play,
        stopAll: state.stopAll,
      },
    }),
  };
  return state;
});

vi.mock('@pixi/sound', () => library.module());

/** A fresh copy of the module, so the load-once state does not leak between tests. */
async function importAudio() {
  vi.resetModules();
  return import('./audio');
}

beforeEach(() => {
  library.context.state = 'suspended';
  library.context.resume.mockReset().mockResolvedValue(undefined);
  library.play.mockReset();
  library.stopAll.mockReset();
  pixiAssets.keys.clear();
  pixiAssets.add.mockReset().mockImplementation(({ alias }: { alias: string }) => {
    pixiAssets.keys.add(alias);
  });
  pixiAssets.load.mockReset().mockResolvedValue({});
});

afterEach(() => {
  vi.doMock('@pixi/sound', () => library.module());
  vi.restoreAllMocks();
});

describe('loadGameAudio', () => {
  it('registers and loads every clip from the audio folder', async () => {
    const { loadGameAudio, soundAlias, soundUrl } = await importAudio();

    const output = await loadGameAudio();

    expect([...(output?.cues ?? [])]).toEqual([...SOUND_CUES]);
    for (const cue of SOUND_CUES) {
      expect(pixiAssets.add).toHaveBeenCalledWith({ alias: soundAlias(cue), src: soundUrl(cue) });
      expect(pixiAssets.load).toHaveBeenCalledWith(soundAlias(cue));
      expect(soundUrl(cue)).toMatch(/assets\/audio\/(ui|game)\/[a-z]+\.wav$/);
    }
  });

  it('loads once and shares the result with every caller', async () => {
    const { loadGameAudio } = await importAudio();

    const [first, second] = await Promise.all([loadGameAudio(), loadGameAudio()]);
    const third = await loadGameAudio();

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(pixiAssets.load).toHaveBeenCalledTimes(SOUND_CUES.length);
  });

  it('leaves out a clip that fails to load, with a warning, and keeps the others', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pixiAssets.load.mockImplementation((alias: string) =>
      alias === 'sound-crash' ? Promise.reject(new Error('404')) : Promise.resolve({}),
    );
    const { loadGameAudio } = await importAudio();

    const output = await loadGameAudio();

    expect(output?.cues.has('crash')).toBe(false);
    expect(output?.cues.size).toBe(SOUND_CUES.length - 1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('crash');
  });

  it('resolves to null without rejecting when no clip loads', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    pixiAssets.load.mockRejectedValue(new Error('offline'));
    const { loadGameAudio } = await importAudio();

    await expect(loadGameAudio()).resolves.toBeNull();
  });

  it('resolves to null without rejecting when the audio library is unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.resetModules();
    vi.doMock('@pixi/sound', () => {
      throw new Error('no audio');
    });
    const { loadGameAudio } = await import('./audio');

    await expect(loadGameAudio()).resolves.toBeNull();
    expect(pixiAssets.load).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('plays and stops through the library using the loaded aliases', async () => {
    const { loadGameAudio } = await importAudio();
    const output = await loadGameAudio();

    output?.play('finish', 0.6);
    output?.stopAll();

    expect(library.play).toHaveBeenCalledWith('sound-finish', { volume: 0.6 });
    expect(library.stopAll).toHaveBeenCalledTimes(1);
  });

  it('resumes a suspended audio context on unlock and leaves a running one alone', async () => {
    const { loadGameAudio } = await importAudio();
    const output = await loadGameAudio();

    output?.unlock();
    expect(library.context.resume).toHaveBeenCalledTimes(1);

    library.context.state = 'running';
    output?.unlock();
    expect(library.context.resume).toHaveBeenCalledTimes(1);
  });

  it('warns instead of throwing when the browser refuses to start audio', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    library.context.resume.mockRejectedValue(new Error('not allowed'));
    const { loadGameAudio } = await importAudio();
    const output = await loadGameAudio();

    expect(() => output?.unlock()).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
  });
});
