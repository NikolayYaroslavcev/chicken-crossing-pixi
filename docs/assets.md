# Assets

## Where things are

| What | Path |
| --- | --- |
| Sprite atlas (generated) | `public/assets/atlas/game.png`, `public/assets/atlas/game.json` |
| Atlas sources | `scripts/atlas/chicken.ts`, `scripts/atlas/cars.ts` |
| Atlas build | `scripts/atlas/build.ts`, run with `npm run assets:atlas` |
| Sound effects (generated) | `public/assets/audio/ui/click.wav`, `public/assets/audio/game/*.wav` |
| Sound build | `scripts/audio/build.ts`, run with `npm run assets:audio` |
| Favicon | `public/favicon.svg` |
| Multiplier font | npm package `@fontsource-variable/fredoka` |
| Loading code | `src/game/assets.ts`, `src/game/audio.ts` |

The atlas is a Pixi/TexturePacker-style spritesheet. Frames are drawn as SVG in world units
and rasterised by headless Chromium at 2 px per world unit (`meta.scale: "2"`), so Pixi sizes
the sprites in world units and they stay sharp on 2x screens. Each frame carries its anchor:
chicken frames are anchored at the point where the feet touch the ground, car layers at the
car centre. Chicken animations (`chicken_idle`, `chicken_jump`, `chicken_dead`,
`chicken_win`) are listed under `animations` and may repeat frames.

Each car model (`sedan`, `hatchback`, `pickup`) has three layers: `base` (shadow, wheels),
`paint` (drawn in greys, tinted per car at runtime) and `details` (glass, lights, outline).

After changing a source file, run `npm run assets:atlas` and commit the regenerated
`game.png` and `game.json`. The build needs the Playwright Chromium that the e2e tests use.

The sound effects are short mono 16-bit WAV files at 22.05 kHz (about 100 KB in total), so
every browser decodes them without a codec question. `scripts/audio/build.ts` synthesises them
from oscillators and seeded noise; the output is identical on every run. After changing it, run
`npm run assets:audio` and commit the regenerated files.

| File | Plays when |
| --- | --- |
| `ui/click.wav` | Play, Go or Cash out is accepted |
| `game/step.wav` | The chicken lands safely on a lane |
| `game/crash.wav` | A car hits the chicken |
| `game/cashout.wav` | A cash out is paid |
| `game/finish.wav` | The chicken lands on the last lane, in place of the step sound |

Audio is optional. A file that fails to load is skipped with a console warning and the game
plays on without it; it never blocks the start the way a missing atlas does. Nothing plays
before the first Play, Go or Cash out, and the mute choice is kept in `localStorage` under
`chicken-crossing:sound`.

## Sources and licences

| Asset | Source | Licence |
| --- | --- | --- |
| Chicken frames, car sprites, chicken shadow | Drawn for this project (`scripts/atlas`) | Original work, no third-party artwork |
| Sound effects | Synthesised for this project (`scripts/audio`) | Original work, no third-party samples |
| Favicon | Same drawing as the header brand mark in `GameHeader.tsx` | Original work |
| Fredoka (variable, latin subset) | [Fredoka](https://github.com/hafontia/Fredoka-One) via [Fontsource](https://fontsource.org/fonts/fredoka) | SIL Open Font License 1.1, © 2016 The Fredoka Project Authors |

The font licence text ships with the package at
`node_modules/@fontsource-variable/fredoka/LICENSE`. If the font fails to load, the game
logs a warning and the multipliers fall back to the system rounded/sans-serif stack.
