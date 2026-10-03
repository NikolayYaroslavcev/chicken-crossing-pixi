/// <reference lib="dom" />
/**
 * Renders the game artwork into one spritesheet: `public/assets/atlas/game.png` plus the
 * Pixi/TexturePacker-style `game.json` that describes its frames, anchors and animations.
 *
 *   npm run assets:atlas
 *
 * The SVG sources live next to this file. Frames are rasterised by headless Chromium at
 * `SCALE` pixels per world unit, so the sprites stay sharp on high-density screens.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { carFrames } from './cars.ts';
import { chickenAnimations, chickenFrames, chickenShadow } from './chicken.ts';
import type { Frame } from './frame.ts';

const SCALE = 2;
const PADDING = 2;
const MAX_WIDTH = 1024;
const OUT_DIR = fileURLToPath(new URL('../../public/assets/atlas/', import.meta.url));

interface Placed {
  frame: Frame;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Shelf packing: rows of frames, tallest first. Plenty for a few dozen same-sized frames. */
function pack(frames: Frame[]): { placed: Placed[]; width: number; height: number } {
  const sorted = [...frames].sort((a, b) => b.height - a.height);
  const placed: Placed[] = [];
  let x = PADDING;
  let y = PADDING;
  let rowHeight = 0;
  let width = 0;
  for (const frame of sorted) {
    const w = Math.ceil(frame.width * SCALE);
    const h = Math.ceil(frame.height * SCALE);
    if (x + w + PADDING > MAX_WIDTH) {
      x = PADDING;
      y += rowHeight + PADDING;
      rowHeight = 0;
    }
    placed.push({ frame, x, y, w, h });
    x += w + PADDING;
    rowHeight = Math.max(rowHeight, h);
    width = Math.max(width, x);
  }
  return { placed, width, height: y + rowHeight + PADDING };
}

function toSvg({ frame, w, h }: Placed): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${frame.width} ${frame.height}">${frame.svg}</svg>`;
}

async function render(placed: Placed[], width: number, height: number): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const items = placed.map((item) => ({ svg: toSvg(item), x: item.x, y: item.y }));
    const dataUrl = await page.evaluate(
      async ({ items, width, height }) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No 2D canvas');
        for (const { svg, x, y } of items) {
          const image = new Image();
          image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
          await image.decode();
          context.drawImage(image, x, y);
        }
        return canvas.toDataURL('image/png');
      },
      { items, width, height },
    );
    return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  } finally {
    await browser.close();
  }
}

function describe(
  placed: Placed[],
  animations: Record<string, string[]>,
  width: number,
  height: number,
) {
  const frames: Record<string, unknown> = {};
  const inOrder = [...placed].sort((a, b) =>
    a.frame.name.localeCompare(b.frame.name, 'en', { numeric: true }),
  );
  for (const { frame, x, y, w, h } of inOrder) {
    frames[frame.name] = {
      frame: { x, y, w, h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w, h },
      sourceSize: { w, h },
      anchor: frame.anchor,
    };
  }
  return {
    frames,
    animations,
    meta: {
      app: 'scripts/atlas/build.ts',
      image: 'game.png',
      format: 'RGBA8888',
      size: { w: width, h: height },
      scale: String(SCALE),
    },
  };
}

async function main(): Promise<void> {
  const frames = [...chickenFrames(), chickenShadow(), ...carFrames()];
  const { placed, width, height } = pack(frames);
  const png = await render(placed, width, height);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, 'game.png'), png);
  await writeFile(
    join(OUT_DIR, 'game.json'),
    `${JSON.stringify(describe(placed, chickenAnimations(), width, height), null, 2)}\n`,
  );
  console.log(`Atlas: ${frames.length} frames, ${width}×${height}px → ${OUT_DIR}`);
}

await main();
