import { Application, Container } from 'pixi.js';
import { loadGameAssets, type GameAssets } from './assets';
import { loadGameAudio } from './audio';
import type { AudioOutput } from './Sound';

/** Past 2x the extra pixels cost fill rate on phones without a visible gain. */
export const MAX_RESOLUTION = 2;

export function rendererResolution(devicePixelRatio = globalThis.devicePixelRatio): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(devicePixelRatio, MAX_RESOLUTION);
}

/**
 * The Pixi side of the game. Everything the game draws goes under `root`, laid out in
 * logical (CSS) pixels; the renderer maps them to device pixels. `assets` are loaded before
 * the stage is handed out, so nothing drawn later has to wait for a texture. `audio` is
 * optional: it is null when sound could not be loaded, and the game runs without it.
 */
export interface PixiStage {
  readonly app: Application;
  readonly root: Container;
  readonly assets: GameAssets;
  readonly audio: AudioOutput | null;
}

export interface StageSize {
  width: number;
  height: number;
}

export async function createPixiStage(size: StageSize): Promise<PixiStage> {
  const app = new Application();
  let assets: GameAssets;
  let audio: AudioOutput | null;
  const initializing = app.init({
    width: size.width,
    height: size.height,
    resolution: rendererResolution(),
    autoDensity: true,
    backgroundAlpha: 0,
    antialias: true,
    preference: 'webgl',
  });
  try {
    // All start at once; if the renderer or the atlas fails the stage is released and the
    // error passed on. Audio never fails: missing clips are just left out.
    [, assets, audio] = await Promise.all([initializing, loadGameAssets(), loadGameAudio()]);
  } catch (error) {
    // The atlas can fail while the renderer is still starting. Releasing the app before init
    // settles would leave init to start the ticker over an already destroyed stage.
    await initializing.catch(() => {});
    releaseFailedApplication(app);
    throw error;
  }

  const root = new Container({ label: 'gameRoot' });
  app.stage.addChild(root);
  return { app, root, assets, audio };
}

export function resizePixiStage({ app }: PixiStage, size: StageSize): void {
  app.renderer.resize(size.width, size.height, rendererResolution());
}

export function destroyPixiStage({ app }: PixiStage): void {
  app.destroy({ removeView: true }, { children: true });
}

// `Application.destroy` needs a renderer, which a failed `init` may not have created.
function releaseFailedApplication(app: Application): void {
  const partial = app as Partial<Pick<Application, 'renderer'>>;
  if (partial.renderer) {
    app.destroy({ removeView: true }, { children: true });
  } else {
    app.stage.destroy({ children: true });
  }
}
