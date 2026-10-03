import { Container, EventEmitter, Ticker } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import { DIFFICULTIES, MockEngine, type Difficulty } from '@/engine';
import { createRng } from '@/engine/rng';
import { drawLosingStep } from '@/engine/round';
import { createGameStore, createSoundSettings, DEFAULT_SETTINGS, type GameStore } from '@/store';
import { WORLD_HEIGHT } from './layout';
import { GameScene } from './GameScene';
import { mountGameScene } from './mountGameScene';
import type { PixiStage } from './pixiStage';
import { SOUND_CUES, type AudioOutput, type SoundCue } from './Sound';
import { createTestAssets } from './testAssets';

class FakeRenderer extends EventEmitter {
  readonly screen = { width: 1024, height: 768 };
}

function fakeAudio() {
  return {
    cues: new Set<SoundCue>(SOUND_CUES),
    play: vi.fn<(cue: SoundCue, volume: number) => void>(),
    stopAll: vi.fn(),
    unlock: vi.fn(),
  } satisfies AudioOutput;
}

function setup(difficulty: Difficulty = 'easy', audio: AudioOutput | null = null) {
  const renderer = new FakeRenderer();
  const ticker = new Ticker();
  ticker.autoStart = false;
  const root = new Container({ label: 'gameRoot' });
  const stage = {
    app: { renderer, ticker, canvas: document.createElement('canvas') },
    root,
    assets: createTestAssets(),
    audio,
  } as unknown as PixiStage;
  const store = createGameStore({
    engine: new MockEngine({ seed: 1, latency: { min: 0, max: 0 } }),
    settings: { ...DEFAULT_SETTINGS, difficulty },
  });
  const scene = () => root.getChildByLabel('gameScene') as Container | null;
  const lanes = () =>
    scene()
      ?.getChildByLabel('world')
      ?.getChildByLabel('lanes')
      ?.children.filter((child) => child.label.startsWith('lane-'));
  const isNext = (index: number) =>
    lanes()?.[index - 1]?.getChildByLabel('highlight')?.visible ?? false;
  return { renderer, ticker, root, stage, store, scene, lanes, isNext };
}

/** Counts the listeners currently subscribed to `store`. */
function countSubscriptions(store: Pick<StoreApi<unknown>, 'subscribe'>) {
  const subscribe = store.subscribe.bind(store);
  let active = 0;
  vi.spyOn(store, 'subscribe').mockImplementation((listener) => {
    const unsubscribe = subscribe(listener);
    active++;
    let subscribed = true;
    return () => {
      if (subscribed) active--;
      subscribed = false;
      unsubscribe();
    };
  });
  return () => active;
}

describe('mountGameScene', () => {
  it('creates the scene under the game root for the selected difficulty', () => {
    const { stage, store, root, scene, lanes } = setup('medium');

    mountGameScene(stage, store);

    expect(root.children).toEqual([scene()]);
    expect(lanes()).toHaveLength(DIFFICULTIES.medium.steps);
  });

  it('rebuilds lanes when the store difficulty changes', () => {
    const { stage, store, lanes } = setup('easy');
    mountGameScene(stage, store);

    store.getState().setDifficulty('hardcore');
    expect(lanes()).toHaveLength(DIFFICULTIES.hardcore.steps);

    store.getState().setDifficulty('hard');
    expect(lanes()).toHaveLength(DIFFICULTIES.hard.steps);
  });

  it('follows renderer resizes', () => {
    const { stage, store, renderer, scene } = setup();
    mountGameScene(stage, store);

    renderer.emit('resize', 390, 844, 2);

    expect(scene()?.scale.y).toBeCloseTo(844 / WORLD_HEIGHT);
  });

  it('shows the progress the store reports', async () => {
    const { stage, store, isNext } = setup('easy');
    mountGameScene(stage, store);

    expect(isNext(1)).toBe(true);

    // Play already takes the first step.
    await store.getState().play();
    expect(store.getState().stepIndex).toBe(1);
    expect(isNext(1)).toBe(false);
    expect(isNext(2)).toBe(true);

    await store.getState().go();
    expect(store.getState().stepIndex).toBe(2);
    expect(isNext(3)).toBe(true);
  });

  it('removes the scene, its listener and the store link on teardown', async () => {
    const { stage, store, renderer, root, ticker } = setup();
    const listeners = ticker.count;
    const teardown = mountGameScene(stage, store);
    // Traffic and the chicken's frame animation.
    expect(ticker.count).toBe(listeners + 2);

    teardown();

    expect(root.children).toHaveLength(0);
    expect(renderer.listenerCount('resize')).toBe(0);
    expect(ticker.count).toBe(listeners);
    store.getState().setDifficulty('hard');
    await expect(store.getState().play()).resolves.toBeUndefined();
    expect(root.children).toHaveLength(0);
  });

  it('leaves no traffic or store links behind over repeated mounts', () => {
    const { stage, store, root, ticker } = setup('easy');
    const settings = createSoundSettings();
    const listeners = ticker.count;
    const gameLinks = countSubscriptions(store);
    const soundLinks = countSubscriptions(settings);

    for (let i = 0; i < 5; i++) {
      const teardown = mountGameScene(stage, store, settings);
      expect([gameLinks(), soundLinks()]).toEqual([1, 1]);
      ticker.update(1000 * (i + 1));
      teardown();
    }

    expect(root.children).toHaveLength(0);
    expect(ticker.count).toBe(listeners);
    // A leaked listener would only reach a destroyed scene, so nothing else would show it.
    expect([gameLinks(), soundLinks()]).toEqual([0, 0]);
  });

  it('connects nothing and leaves nothing running when the scene fails to set up', () => {
    const { stage, store, renderer, root, ticker } = setup();
    const listeners = ticker.count;
    const failure = new Error('scene broke');
    vi.spyOn(GameScene.prototype, 'setProgress').mockImplementationOnce(() => {
      throw failure;
    });
    const audio = fakeAudio();

    expect(() => mountGameScene({ ...stage, audio }, store)).toThrow(failure);

    expect(root.children).toHaveLength(0);
    expect(ticker.count).toBe(listeners);
    expect(renderer.listenerCount('resize')).toBe(0);
    expect(audio.stopAll).toHaveBeenCalled();
  });
});

describe('mountGameScene teardown mid-round', () => {
  /** A store whose first step on `difficulty` survives or crashes, with audio to count presses. */
  function midRoundSetup(difficulty: Difficulty, crashFirst: boolean) {
    const context = setup(difficulty, fakeAudio());
    let seed = 0;
    while ((drawLosingStep(difficulty, createRng(seed)) === 1) !== crashFirst) seed++;
    const store = createGameStore({
      engine: new MockEngine({ seed, latency: { min: 0, max: 0 } }),
      settings: { ...DEFAULT_SETTINGS, difficulty },
    });
    const played = () =>
      (context.stage.audio as ReturnType<typeof fakeAudio>).play.mock.calls.map(([cue]) => cue);
    return { ...context, store, played };
  }

  /** Starts a round and returns while the opening hop is still in the air. */
  async function playUntilAirborne(store: GameStore) {
    const round = store.getState().play();
    // The engine answers without delay; the hop itself takes a fraction of a second.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getState()).toMatchObject({ busy: true, stepIndex: 0 });
    // Wrapped, so awaiting this helper does not wait for the round as well.
    return { round };
  }

  // The store outlives the canvas (retry, remount), so a hop cut short must still let it go.
  it('releases the store when the scene goes mid-hop and plays on after a remount', async () => {
    const { stage, store, root, played } = midRoundSetup('easy', false);
    const teardown = mountGameScene(stage, store);
    const { round } = await playUntilAirborne(store);

    teardown();
    await round;
    expect(store.getState()).toMatchObject({ status: 'playing', stepIndex: 1, busy: false });

    mountGameScene(stage, store);
    const before = played().length;
    await store.getState().go();

    expect(store.getState()).toMatchObject({ stepIndex: 2, busy: false, error: null });
    expect(root.children).toHaveLength(1);
    // One click per press after the remount.
    expect(played().slice(before)).toEqual(['click', 'step']);
  });

  it('releases the store when the scene goes during a crash and starts a new round after', async () => {
    const { stage, store, played } = midRoundSetup('hardcore', true);
    const teardown = mountGameScene(stage, store);
    const { round } = await playUntilAirborne(store);

    teardown();
    await round;
    expect(store.getState()).toMatchObject({ status: 'crashed', stepIndex: 1, busy: false });

    mountGameScene(stage, store);
    const before = played().length;
    await store.getState().play();

    expect(store.getState()).toMatchObject({ busy: false, error: null });
    expect(store.getState().stepIndex).toBe(1);
    expect(played().slice(before)[0]).toBe('click');
    expect(
      played()
        .slice(before)
        .filter((cue) => cue === 'click'),
    ).toHaveLength(1);
  });
});

describe('mountGameScene effects', () => {
  it('marks the canvas with the effect that started and the ones still playing', async () => {
    const { stage, store, ticker } = setup('easy');
    const { canvas } = stage.app as unknown as { canvas: HTMLCanvasElement };
    mountGameScene(stage, store);
    expect(canvas.dataset.effect).toBeUndefined();

    // Seed 1 survives the opening step, so the chicken lands.
    await store.getState().play();
    expect(canvas.dataset.effect).toBe('land');
    expect(canvas.dataset.effects).toBe('land');

    let now = 0;
    for (let i = 0; i < 120; i++) ticker.update((now += 1000 / 60));
    expect(canvas.dataset.effect).toBe('land');
    expect(canvas.dataset.effects).toBe('');
  });
});

describe('mountGameScene sound', () => {
  function soundSetup() {
    const audio = fakeAudio();
    const context = setup('easy', audio);
    const settings = createSoundSettings();
    const { canvas } = context.stage.app as unknown as { canvas: HTMLCanvasElement };
    const played = () => audio.play.mock.calls.map(([cue]) => cue);
    return { ...context, audio, settings, canvas, played };
  }

  it('clicks once for an accepted Play, then plays the landing of the first step', async () => {
    const { stage, store, settings, played } = soundSetup();
    mountGameScene(stage, store, settings);

    const round = store.getState().play();
    // The click is part of the press itself, before the engine has answered.
    expect(played()).toEqual(['click']);
    await round;

    expect(played()).toEqual(['click', 'step']);
  });

  it('clicks for Go and Cash out and plays the cash-out sound once the engine settles it', async () => {
    const { stage, store, settings, played } = soundSetup();
    mountGameScene(stage, store, settings);
    await store.getState().play();
    await store.getState().go();
    expect(played()).toEqual(['click', 'step', 'click', 'step']);

    await store.getState().cashOut();

    expect(played()).toEqual(['click', 'step', 'click', 'step', 'click', 'cashOut']);
  });

  it('stays silent for rejected actions, bet and difficulty changes and reset', async () => {
    const { stage, store, settings, played } = soundSetup();
    mountGameScene(stage, store, settings);

    await store.getState().go();
    await store.getState().cashOut();
    store.getState().setBet(2);
    store.getState().setDifficulty('medium');
    store.getState().reset();

    expect(played()).toEqual([]);
  });

  it('ignores a second press while the first one is still playing out', async () => {
    const { stage, store, settings, played } = soundSetup();
    mountGameScene(stage, store, settings);

    const first = store.getState().play();
    const second = store.getState().play();
    await Promise.all([first, second]);

    expect(played()).toEqual(['click', 'step']);
  });

  it('marks the canvas with the sound last played and how many have played', async () => {
    const { stage, store, settings, canvas } = soundSetup();
    mountGameScene(stage, store, settings);
    expect(canvas.dataset.sound).toBeUndefined();

    await store.getState().play();

    expect(canvas.dataset.sound).toBe('step');
    expect(canvas.dataset.soundCount).toBe('2');
  });

  it('follows the mute setting without touching the round', async () => {
    const { stage, store, settings, audio, played, canvas } = soundSetup();
    mountGameScene(stage, store, settings);

    settings.getState().setMuted(true);
    expect(audio.stopAll).toHaveBeenCalledTimes(1);
    await store.getState().play();
    expect(played()).toEqual([]);
    expect(canvas.dataset.sound).toBeUndefined();
    expect(store.getState().stepIndex).toBe(1);

    settings.getState().setMuted(false);
    await store.getState().go();
    expect(played()).toEqual(['click', 'step']);
  });

  it('starts muted when the player muted sound before', async () => {
    const { stage, store, settings, played } = soundSetup();
    settings.getState().setMuted(true);
    mountGameScene(stage, store, settings);

    await store.getState().play();

    expect(played()).toEqual([]);
  });

  it('plays the game through without any audio', async () => {
    const { stage, store } = setup('easy', null);
    const { canvas } = stage.app as unknown as { canvas: HTMLCanvasElement };
    mountGameScene(stage, store, createSoundSettings());

    await store.getState().play();
    await store.getState().cashOut();

    expect(store.getState().status).toBe('cashed_out');
    expect(canvas.dataset.sound).toBeUndefined();
  });

  it('stops the sound and drops the mute link on teardown', async () => {
    const { stage, store, settings, audio, played } = soundSetup();
    const teardown = mountGameScene(stage, store, settings);

    teardown();
    expect(audio.stopAll).toHaveBeenCalledTimes(1);
    settings.getState().setMuted(true);
    await store.getState().play();

    expect(audio.stopAll).toHaveBeenCalledTimes(1);
    expect(played()).toEqual([]);
  });

  it('follows the reduced-motion preference while mounted and stops on teardown', () => {
    const query = Object.assign(new EventTarget(), { matches: false });
    vi.stubGlobal('matchMedia', () => query);
    const setReducedMotion = vi.spyOn(GameScene.prototype, 'setReducedMotion');
    try {
      const { stage, store } = setup();
      const teardown = mountGameScene(stage, store);
      const change = (matches: boolean) =>
        query.dispatchEvent(Object.assign(new Event('change'), { matches }));

      change(true);
      expect(setReducedMotion).toHaveBeenLastCalledWith(true);
      change(false);
      expect(setReducedMotion).toHaveBeenLastCalledWith(false);

      teardown();
      change(true);
      expect(setReducedMotion).toHaveBeenCalledTimes(2);
    } finally {
      setReducedMotion.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
