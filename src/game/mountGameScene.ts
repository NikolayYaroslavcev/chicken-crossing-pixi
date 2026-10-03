import type { GameStore } from '@/store';
import { createSoundSettings, type SoundSettingsStore } from '@/store/sound';
import type { EffectKind, EffectPhase } from './Effects';
import { GameScene } from './GameScene';
import type { PixiStage } from './pixiStage';
import { Sound, type SoundCue } from './Sound';

function reducedMotionQuery(): MediaQueryList | null {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
}

/**
 * Creates the scene under the stage root, keeps it in sync with the renderer size and the
 * selected difficulty, and connects it to the store. Sound follows the player's mute setting
 * and hears the scene's moments plus a click for each accepted Play, Go or Cash out. Returns
 * the matching teardown.
 *
 * The canvas element carries the effect last started (`data-effect`) and the ones still
 * playing (`data-effects`), and the sound last played (`data-sound`) with a running count
 * (`data-sound-count`), so the page can tell what the scene is showing and playing.
 */
export function mountGameScene(
  { app, root, assets, audio }: PixiStage,
  store: GameStore,
  soundSettings: SoundSettingsStore = createSoundSettings(),
): () => void {
  const { renderer } = app;
  const canvas = app.canvas as HTMLCanvasElement;
  const playing = new Set<EffectKind>();
  const onEffect = (kind: EffectKind, phase: EffectPhase) => {
    if (phase === 'start') {
      playing.add(kind);
      canvas.dataset.effect = kind;
    } else {
      playing.delete(kind);
    }
    canvas.dataset.effects = [...playing].join(' ');
  };
  let played = 0;
  const onPlay = (cue: SoundCue) => {
    canvas.dataset.sound = cue;
    canvas.dataset.soundCount = String(++played);
  };
  const sound = new Sound(audio, { muted: soundSettings.getState().muted, onPlay });

  const motion = reducedMotionQuery();
  const state = store.getState();
  let scene: GameScene | null = null;
  try {
    scene = new GameScene(root, {
      difficulty: state.difficulty,
      viewport: { width: renderer.screen.width, height: renderer.screen.height },
      assets,
      ticker: app.ticker,
      reducedMotion: motion?.matches ?? false,
      onEffect,
      sound,
    });
    scene.setProgress(state.stepIndex);
  } catch (error) {
    // Nothing is connected yet; whatever the scene drew goes with the stage.
    scene?.destroy();
    sound.destroy();
    throw error;
  }

  const onResize = (width: number, height: number) => scene.resize({ width, height });
  renderer.on('resize', onResize);
  const onMotionChange = (event: MediaQueryListEvent) => scene.setReducedMotion(event.matches);
  motion?.addEventListener('change', onMotionChange);

  const unsubscribe = store.subscribe((next, previous) => {
    if (next.difficulty !== previous.difficulty) scene.setDifficulty(next.difficulty);
    // Only Play, Go and Cash out take the lock, and only once the store accepts them. This
    // runs inside the click or key press, which is what lets the browser start audio.
    if (next.busy && !previous.busy) sound.play('click');
  });
  const unsubscribeSound = soundSettings.subscribe((next) => sound.setMuted(next.muted));
  const detach = state.attachScene(scene);

  return () => {
    detach();
    unsubscribe();
    unsubscribeSound();
    renderer.off('resize', onResize);
    motion?.removeEventListener('change', onMotionChange);
    scene.destroy();
    sound.destroy();
  };
}
