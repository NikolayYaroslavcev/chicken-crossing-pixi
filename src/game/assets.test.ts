import { Spritesheet, type SpritesheetData, Texture, TextureSource } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import atlasJson from '../../public/assets/atlas/game.json?raw';
import {
  ATLAS_ALIAS,
  CAR_MODELS,
  CHICKEN_ANIMATIONS,
  FONT_ALIAS,
  FONT_FAMILY,
  type AssetLoadError as AssetLoadErrorType,
  type GameAssets,
} from './assets';

const atlasData = JSON.parse(atlasJson) as SpritesheetData;

/** Parses the committed atlas description over a blank texture of the same size. */
async function parseAtlas(data: SpritesheetData = atlasData): Promise<Spritesheet> {
  const size = data.meta.size as { w: number; h: number };
  const source = new TextureSource({ width: size.w, height: size.h });
  const sheet = new Spritesheet(new Texture({ source }), data);
  await sheet.parse();
  return sheet;
}

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

/** A fresh copy of the module, so the load-once state does not leak between tests. */
async function importAssets() {
  vi.resetModules();
  return import('./assets');
}

beforeEach(() => {
  pixiAssets.keys.clear();
  pixiAssets.add.mockReset().mockImplementation(({ alias }: { alias: string }) => {
    pixiAssets.keys.add(alias);
  });
  pixiAssets.load.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readAtlas', () => {
  it('finds every chicken animation and car layer in the generated atlas', async () => {
    const { readAtlas } = await importAssets();
    const sheet = await parseAtlas();

    const assets = readAtlas(sheet);

    for (const name of CHICKEN_ANIMATIONS) {
      const frames = assets.chicken.animations[name];
      expect(frames.length).toBeGreaterThan(0);
      expect(frames).toEqual(sheet.animations[`chicken_${name}`]);
    }
    expect(assets.cars).toHaveLength(CAR_MODELS.length);
    expect(assets.cars[0]?.paint).toBe(sheet.textures['car_sedan_paint']);
  });

  it('keeps the chicken standing on one ground point in every frame', async () => {
    const { readAtlas } = await importAssets();
    const { chicken } = readAtlas(await parseAtlas());

    const frames = Object.values(chicken.animations).flat();
    const [first] = frames;
    expect(first?.defaultAnchor?.y).toBeGreaterThan(0.8);
    for (const frame of frames) {
      expect(frame.defaultAnchor).toEqual(first?.defaultAnchor);
      // Atlas pixels are 2 per world unit, so a frame is about a lane wide.
      expect(frame.width).toBeLessThan(112);
    }
  });

  it('fails loudly when the atlas lacks a frame the game draws', async () => {
    const { readAtlas, AssetLoadError } = await importAssets();
    const frames = { ...atlasData.frames };
    delete frames['car_pickup_details'];
    const sheet = await parseAtlas({ ...atlasData, frames });

    expect(() => readAtlas(sheet)).toThrow(AssetLoadError);
    expect(() => readAtlas(sheet)).toThrow(/car_pickup_details/);
  });

  it('fails loudly when a chicken animation is missing', async () => {
    const { readAtlas } = await importAssets();
    const animations = { ...atlasData.animations };
    delete animations['chicken_win'];
    const sheet = await parseAtlas({ ...atlasData, animations });

    expect(() => readAtlas(sheet)).toThrow(/chicken_win/);
  });
});

describe('loadGameAssets', () => {
  it('registers the atlas and font once and loads them once for every caller', async () => {
    const { loadGameAssets } = await importAssets();
    const sheet = await parseAtlas();
    pixiAssets.load.mockImplementation(async (alias: string) =>
      alias === ATLAS_ALIAS ? sheet : {},
    );

    const [first, second] = await Promise.all([loadGameAssets(), loadGameAssets()]);
    const third = await loadGameAssets();

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(pixiAssets.add).toHaveBeenCalledTimes(2);
    expect(pixiAssets.add).toHaveBeenCalledWith(
      expect.objectContaining({ alias: ATLAS_ALIAS, src: expect.stringMatching(/game\.json$/) }),
    );
    expect(pixiAssets.add).toHaveBeenCalledWith(
      expect.objectContaining({
        alias: FONT_ALIAS,
        data: expect.objectContaining({ family: FONT_FAMILY }),
      }),
    );
    expect(pixiAssets.load).toHaveBeenCalledTimes(2);
    expect(first.chicken.shadow).toBe(sheet.textures['chicken_shadow']);
  });

  it('rejects with an AssetLoadError when the atlas cannot be loaded, and can retry', async () => {
    const { loadGameAssets, AssetLoadError } = await importAssets();
    const cause = new Error('404');
    pixiAssets.load.mockImplementation(async (alias: string) => {
      if (alias === ATLAS_ALIAS) throw cause;
      return {};
    });

    const failure = (await loadGameAssets().catch((error: unknown) => error)) as AssetLoadErrorType;
    expect(failure).toBeInstanceOf(AssetLoadError);
    expect(failure.cause).toBe(cause);

    const sheet = await parseAtlas();
    pixiAssets.load.mockImplementation(async (alias: string) =>
      alias === ATLAS_ALIAS ? sheet : {},
    );
    const assets: GameAssets = await loadGameAssets();
    expect(assets.cars).toHaveLength(CAR_MODELS.length);
    // Registration is kept from the first attempt rather than repeated.
    expect(pixiAssets.add).toHaveBeenCalledTimes(2);
  });

  it('carries on with the fallback font when the font fails, but says so', async () => {
    const { loadGameAssets } = await importAssets();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sheet = await parseAtlas();
    pixiAssets.load.mockImplementation(async (alias: string) => {
      if (alias === FONT_ALIAS) throw new Error('font blocked');
      return sheet;
    });

    await expect(loadGameAssets()).resolves.toBeDefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('font'), expect.any(Error));
  });
});
