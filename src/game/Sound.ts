export const SOUND_CUES = ['click', 'step', 'crash', 'cashOut', 'finish'] as const;
export type SoundCue = (typeof SOUND_CUES)[number];

/**
 * The loaded clips, behind whatever library plays them. `cues` lists the clips that loaded;
 * the others are simply never asked for.
 */
export interface AudioOutput {
  readonly cues: ReadonlySet<SoundCue>;
  play(cue: SoundCue, volume: number): void;
  stopAll(): void;
  /** Resumes playback the browser holds back until the page gets a user gesture. */
  unlock(): void;
}

/** What the scene needs: ask for a moment by name, never for a file. */
export interface SoundCues {
  play(cue: SoundCue): void;
}

export interface SoundOptions {
  muted?: boolean;
  onPlay?: (cue: SoundCue) => void;
}

/** Relative levels, so the small UI tick sits under the outcomes and the crash is not harsh. */
export const CUE_VOLUME: Readonly<Record<SoundCue, number>> = {
  click: 0.3,
  step: 0.45,
  crash: 0.55,
  cashOut: 0.5,
  finish: 0.6,
};

/**
 * Plays the game's sound effects. It only reacts to outcomes that are already decided and
 * keeps working, silently, without an output or with clips that failed to load.
 */
export class Sound implements SoundCues {
  private readonly output: AudioOutput | null;
  private readonly onPlay: ((cue: SoundCue) => void) | null;
  private readonly failed = new Set<SoundCue>();
  private mutedState: boolean;
  private destroyed = false;

  constructor(output: AudioOutput | null, { muted = false, onPlay }: SoundOptions = {}) {
    this.output = output;
    this.mutedState = muted;
    this.onPlay = onPlay ?? null;
  }

  get muted(): boolean {
    return this.mutedState;
  }

  canPlay(cue: SoundCue): boolean {
    return (
      !this.destroyed &&
      !this.mutedState &&
      !this.failed.has(cue) &&
      (this.output?.cues.has(cue) ?? false)
    );
  }

  /** Muting also cuts whatever is still ringing, so unmuting never brings an old sound back. */
  setMuted(muted: boolean): void {
    if (this.destroyed || muted === this.mutedState) return;
    this.mutedState = muted;
    if (muted) this.stop();
  }

  play(cue: SoundCue): void {
    if (!this.canPlay(cue)) return;
    const output = this.output as AudioOutput;
    try {
      output.unlock();
      output.play(cue, CUE_VOLUME[cue]);
    } catch (error) {
      this.failed.add(cue);
      console.warn(`Sound "${cue}" could not play and is turned off`, error);
      return;
    }
    this.onPlay?.(cue);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
  }

  private stop(): void {
    try {
      this.output?.stopAll();
    } catch (error) {
      console.warn('Could not stop the playing sounds', error);
    }
  }
}
