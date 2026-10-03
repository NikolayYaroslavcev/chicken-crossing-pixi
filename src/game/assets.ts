import { Assets, type Spritesheet, type Texture } from 'pixi.js';
import fontUrl from '@fontsource-variable/fredoka/files/fredoka-latin-wght-normal.woff2?url';
import type { ChickenState } from './Chicken';

/** Spritesheet built by `npm run assets:atlas`, served from `public/`. */
export const ATLAS_URL = `${import.meta.env.BASE_URL}assets/atlas/game.json`;
export const ATLAS_ALIAS = 'game-atlas';
export const FONT_ALIAS = 'game-font';
export const FONT_FAMILY = 'Fredoka';

export const CHICKEN_ANIMATIONS = [
  'idle',
  'jump',
  'dead',
  'win',
] as const satisfies readonly ChickenState[];

export const CAR_MODELS = ['sedan', 'hatchback', 'pickup'] as const;
const CAR_LAYERS = ['base', 'paint', 'details'] as const;

export interface ChickenTextures {
  readonly animations: Readonly<Record<ChickenState, Texture[]>>;
  readonly shadow: Texture;
}

/** One car model: the untinted base and details around a paint layer that gets tinted. */
export type CarTextures = Readonly<Record<(typeof CAR_LAYERS)[number], Texture>>;

/**
 * Everything the scene draws from the atlas. The textures belong to the Pixi asset cache and
 * live as long as the page; display objects borrow them and never destroy them.
 */
export interface GameAssets {
  readonly chicken: ChickenTextures;
  readonly cars: readonly CarTextures[];
}

export class AssetLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AssetLoadError';
  }
}

let loading: Promise<GameAssets> | null = null;

/**
 * Loads the atlas (and the game font) once and shares the result with every caller. A failed
 * load is not remembered, so a later call tries again.
 */
export function loadGameAssets(): Promise<GameAssets> {
  loading ??= load().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

async function load(): Promise<GameAssets> {
  if (!Assets.resolver.hasKey(ATLAS_ALIAS)) Assets.add({ alias: ATLAS_ALIAS, src: ATLAS_URL });
  if (!Assets.resolver.hasKey(FONT_ALIAS)) {
    Assets.add({
      alias: FONT_ALIAS,
      src: fontUrl,
      data: { family: FONT_FAMILY, weights: ['700'] },
    });
  }

  const [sheet] = await Promise.all([
    Assets.load<Spritesheet>(ATLAS_ALIAS).catch((cause: unknown) => {
      throw new AssetLoadError(`Could not load the sprite atlas from ${ATLAS_URL}`, { cause });
    }),
    // Text falls back to the system font stack, so a missing font is not worth failing over.
    Assets.load(FONT_ALIAS).catch((error: unknown) => {
      console.warn('Game font unavailable, using the fallback font', error);
    }),
  ]);
  return readAtlas(sheet);
}

export function readAtlas(sheet: Spritesheet): GameAssets {
  const texture = (name: string): Texture => {
    const found = sheet.textures[name];
    if (!found) throw new AssetLoadError(`Atlas has no frame "${name}"`);
    return found;
  };
  const animation = (name: ChickenState): Texture[] => {
    const frames = sheet.animations[`chicken_${name}`];
    if (!frames?.length) throw new AssetLoadError(`Atlas has no animation "chicken_${name}"`);
    return frames;
  };

  return {
    chicken: {
      animations: Object.fromEntries(
        CHICKEN_ANIMATIONS.map((name) => [name, animation(name)]),
      ) as Record<ChickenState, Texture[]>,
      shadow: texture('chicken_shadow'),
    },
    cars: CAR_MODELS.map(
      (model) =>
        Object.fromEntries(
          CAR_LAYERS.map((layer) => [layer, texture(`car_${model}_${layer}`)]),
        ) as CarTextures,
    ),
  };
}
