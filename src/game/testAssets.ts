import { Texture } from 'pixi.js';
import { CAR_MODELS, CHICKEN_ANIMATIONS, type CarTextures, type GameAssets } from './assets';

/** Ground point of the chicken frames, as the atlas would set it. */
export const CHICKEN_ANCHOR = { x: 0.5, y: 0.9 };

const FRAME_COUNTS = { idle: 4, jump: 4, dead: 4, win: 4 } as const;

function texture(label: string, defaultAnchor?: { x: number; y: number }): Texture {
  return new Texture({ label, defaultAnchor });
}

/** Stand-ins for the atlas textures, one labelled texture per frame; nothing is downloaded. */
export function createTestAssets(): GameAssets {
  return {
    chicken: {
      animations: Object.fromEntries(
        CHICKEN_ANIMATIONS.map((name) => [
          name,
          Array.from({ length: FRAME_COUNTS[name] }, (_, i) =>
            texture(`chicken_${name}_${i}`, CHICKEN_ANCHOR),
          ),
        ]),
      ) as GameAssets['chicken']['animations'],
      shadow: texture('chicken_shadow', { x: 0.5, y: 0.5 }),
    },
    cars: CAR_MODELS.map((model): CarTextures => ({
      base: texture(`car_${model}_base`),
      paint: texture(`car_${model}_paint`),
      details: texture(`car_${model}_details`),
    })),
  };
}
