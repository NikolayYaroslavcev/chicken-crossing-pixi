import { afterEach, describe, expect, it, vi } from 'vitest';
import { CUE_VOLUME, Sound, SOUND_CUES, type AudioOutput, type SoundCue } from './Sound';

function fakeOutput(cues: readonly SoundCue[] = SOUND_CUES) {
  return {
    cues: new Set(cues),
    play: vi.fn<(cue: SoundCue, volume: number) => void>(),
    stopAll: vi.fn(),
    unlock: vi.fn(),
  } satisfies AudioOutput;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Sound', () => {
  it('plays each cue through its loaded clip at its own level', () => {
    const output = fakeOutput();
    const sound = new Sound(output);

    for (const cue of SOUND_CUES) sound.play(cue);

    expect(output.play.mock.calls).toEqual(SOUND_CUES.map((cue) => [cue, CUE_VOLUME[cue]]));
  });

  it('keeps every level in the 0..1 range, with the click the quietest', () => {
    const levels = Object.values(CUE_VOLUME);

    expect(levels.every((level) => level > 0 && level <= 1)).toBe(true);
    expect(Math.min(...levels)).toBe(CUE_VOLUME.click);
  });

  it('asks the browser to unlock audio before playing', () => {
    const output = fakeOutput();
    const order: string[] = [];
    output.unlock.mockImplementation(() => order.push('unlock'));
    output.play.mockImplementation(() => order.push('play'));

    new Sound(output).play('click');

    expect(order).toEqual(['unlock', 'play']);
  });

  it('reports each cue that actually started', () => {
    const onPlay = vi.fn();
    const sound = new Sound(fakeOutput(), { onPlay });

    sound.play('step');
    sound.play('crash');

    expect(onPlay.mock.calls).toEqual([['step'], ['crash']]);
  });

  it('starts unmuted by default and can start muted', () => {
    expect(new Sound(fakeOutput()).muted).toBe(false);
    expect(new Sound(fakeOutput(), { muted: true }).muted).toBe(true);
  });

  it('plays nothing while muted and stops what is ringing when muted', () => {
    const output = fakeOutput();
    const onPlay = vi.fn();
    const sound = new Sound(output, { onPlay });

    sound.setMuted(true);
    sound.play('finish');

    expect(output.stopAll).toHaveBeenCalledTimes(1);
    expect(output.play).not.toHaveBeenCalled();
    expect(onPlay).not.toHaveBeenCalled();
    expect(sound.canPlay('finish')).toBe(false);
  });

  it('plays the next cue right after unmuting without replaying the muted ones', () => {
    const output = fakeOutput();
    const sound = new Sound(output, { muted: true });
    sound.play('step');
    sound.play('crash');

    sound.setMuted(false);
    expect(output.play).not.toHaveBeenCalled();
    sound.play('cashOut');

    expect(output.play.mock.calls).toEqual([['cashOut', CUE_VOLUME.cashOut]]);
  });

  it('ignores a mute setting that does not change anything', () => {
    const output = fakeOutput();
    const sound = new Sound(output);

    sound.setMuted(false);
    sound.setMuted(true);
    sound.setMuted(true);

    expect(output.stopAll).toHaveBeenCalledTimes(1);
  });

  it('runs silently without an output', () => {
    const onPlay = vi.fn();
    const sound = new Sound(null, { onPlay });

    expect(() => {
      for (const cue of SOUND_CUES) sound.play(cue);
      sound.setMuted(true);
      sound.destroy();
    }).not.toThrow();
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('skips clips that did not load and plays the rest', () => {
    const output = fakeOutput(['step', 'crash']);
    const sound = new Sound(output);

    sound.play('finish');
    sound.play('step');

    expect(output.play.mock.calls).toEqual([['step', CUE_VOLUME.step]]);
  });

  it('turns off a clip that fails to play, with one warning, and keeps the others', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const output = fakeOutput();
    output.play.mockImplementation((cue) => {
      if (cue === 'crash') throw new Error('decode failed');
    });
    const onPlay = vi.fn();
    const sound = new Sound(output, { onPlay });

    expect(() => {
      sound.play('crash');
      sound.play('crash');
    }).not.toThrow();
    sound.play('step');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(output.play).toHaveBeenCalledTimes(2);
    expect(onPlay.mock.calls).toEqual([['step']]);
  });

  it('survives an output that cannot stop, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const output = fakeOutput();
    output.stopAll.mockImplementation(() => {
      throw new Error('closed');
    });

    expect(() => new Sound(output).setMuted(true)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stops playing sounds on destroy and ignores everything after it', () => {
    const output = fakeOutput();
    const sound = new Sound(output);

    sound.destroy();
    sound.destroy();
    sound.play('click');
    sound.setMuted(true);

    expect(output.stopAll).toHaveBeenCalledTimes(1);
    expect(output.play).not.toHaveBeenCalled();
  });
});
