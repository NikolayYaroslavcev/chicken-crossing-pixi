import type { Frame } from './frame.ts';

/**
 * Cars seen from above, front bumper facing down. Every model has the same footprint as the
 * traffic expects (54 × 92). Each one is split in three layers: the base (shadow, wheels), the
 * paint drawn in greys so a tint colours it, and the details on top (glass, lights).
 */

const LENGTH = 92;
const WIDTH = 54;
const FRAME_WIDTH = 76;
const FRAME_HEIGHT = 112;

const INK = '#1c2029';
const GLASS = '#26364a';
const GLASS_SHINE = '#9fc3e6';

export const CAR_MODELS = ['sedan', 'hatchback', 'pickup'] as const;
type Model = (typeof CAR_MODELS)[number];

/** Centres the car in the frame; all drawing below uses the car centre as the origin. */
function centred(content: string): string {
  return `<g transform="translate(${FRAME_WIDTH / 2} ${FRAME_HEIGHT / 2})">${content}</g>`;
}

const HALF_W = WIDTH / 2;
const HALF_L = LENGTH / 2;

interface Shape {
  /** Corner radius of the front bumper. */
  nose: number;
  /** Where the windscreen starts, measured from the car centre towards the front. */
  windscreen: number;
  mirrors: number;
  rearAxle: number;
}

const SHAPES: Record<Model, Shape> = {
  sedan: { nose: 16, windscreen: 10, mirrors: 4, rearAxle: -26 },
  hatchback: { nose: 16, windscreen: 6, mirrors: 0, rearAxle: -26 },
  pickup: { nose: 13, windscreen: 14, mirrors: 6, rearAxle: -28 },
};

/** The body outline: slightly pinched at the cabin so the silhouette reads as a car. */
function bodyPath(model: Model): string {
  const front = SHAPES[model].nose;
  return `M${-HALF_W + 4} ${-HALF_L + 10}
    Q${-HALF_W + 2} ${-HALF_L} ${-HALF_W + 13} ${-HALF_L}
    L${HALF_W - 13} ${-HALF_L}
    Q${HALF_W - 2} ${-HALF_L} ${HALF_W - 4} ${-HALF_L + 10}
    L${HALF_W} ${-8} L${HALF_W - 1} 8
    L${HALF_W} ${HALF_L - front}
    Q${HALF_W} ${HALF_L} ${HALF_W - front} ${HALF_L}
    L${-HALF_W + front} ${HALF_L}
    Q${-HALF_W} ${HALF_L} ${-HALF_W} ${HALF_L - front}
    L${-HALF_W + 1} 8 L${-HALF_W} ${-8} Z`;
}

function base(model: Model): string {
  const wheel = (x: number, y: number) =>
    `<rect x="${x - 4.5}" y="${y - 10}" width="9" height="20" rx="3.5" fill="#15171c"/>
     <rect x="${x - 2}" y="${y - 7}" width="4" height="14" rx="2" fill="#3a3f4a"/>`;
  const rear = SHAPES[model].rearAxle;
  return `<defs><filter id="blur" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="3"/></filter></defs>
    ${centred(`
      <path d="${bodyPath(model)}" transform="translate(3 6)" fill="#000" opacity="0.32" filter="url(#blur)"/>
      ${wheel(-HALF_W + 1, rear)}${wheel(HALF_W - 1, rear)}
      ${wheel(-HALF_W + 1, 26)}${wheel(HALF_W - 1, 26)}
    `)}`;
}

function paint(model: Model): string {
  const panels =
    model === 'pickup'
      ? `<path d="M${-HALF_W + 5} -6 L${HALF_W - 5} -6" stroke="#b8bcc4" stroke-width="2"/>`
      : `<path d="M-14 ${HALF_L - 4} Q0 ${HALF_L - 1} 14 ${HALF_L - 4}" fill="none" stroke="#c9cdd4" stroke-width="2"/>`;
  return `<defs>
      <linearGradient id="paint" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#b4b9c2"/>
        <stop offset="0.22" stop-color="#ffffff"/>
        <stop offset="0.78" stop-color="#ffffff"/>
        <stop offset="1" stop-color="#b4b9c2"/>
      </linearGradient>
    </defs>
    ${centred(`
      <path d="${bodyPath(model)}" fill="url(#paint)"/>
      ${panels}
    `)}`;
}

function cabin(model: Model): string {
  // Windscreen faces the front (+y), rear window the back; the roof sits between them.
  switch (model) {
    case 'sedan':
      return `
        <path d="M-19 10 Q0 6 19 10 L21 22 Q0 18 -21 22 Z" fill="${GLASS}"/>
        <path d="M-17 -18 Q0 -15 17 -18 L19 -27 Q0 -24 -19 -27 Z" fill="${GLASS}"/>
        <rect x="-19" y="-18" width="38" height="28" rx="5" fill="#ffffff" opacity="0.16"/>
        <path d="M-21 -16 L-22 8 M21 -16 L22 8" stroke="${GLASS}" stroke-width="3" stroke-linecap="round"/>`;
    case 'hatchback':
      return `
        <path d="M-19 6 Q0 2 19 6 L21 18 Q0 14 -21 18 Z" fill="${GLASS}"/>
        <path d="M-18 -30 Q0 -27 18 -30 L19 -38 Q0 -36 -19 -38 Z" fill="${GLASS}"/>
        <rect x="-19" y="-30" width="38" height="36" rx="5" fill="#ffffff" opacity="0.16"/>
        <path d="M-21 -28 L-22 4 M21 -28 L22 4" stroke="${GLASS}" stroke-width="3" stroke-linecap="round"/>`;
    case 'pickup':
      return `
        <path d="M-19 14 Q0 10 19 14 L21 25 Q0 21 -21 25 Z" fill="${GLASS}"/>
        <rect x="-19" y="-4" width="38" height="18" rx="4" fill="#ffffff" opacity="0.16"/>
        <path d="M-17 -4 L17 -4 L18 -9 L-18 -9 Z" fill="${GLASS}"/>
        <rect x="-21" y="-42" width="42" height="32" rx="3" fill="${INK}" opacity="0.38"/>
        <path d="M-14 -38 L-14 -14 M-5 -38 L-5 -14 M5 -38 L5 -14 M14 -38 L14 -14" stroke="${INK}" stroke-width="1.6" opacity="0.35"/>`;
  }
}

function details(model: Model): string {
  const { nose, windscreen: w, mirrors } = SHAPES[model];
  return `<defs><linearGradient id="shine" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${GLASS_SHINE}" stop-opacity="0.75"/>
      <stop offset="1" stop-color="${GLASS_SHINE}" stop-opacity="0"/>
    </linearGradient></defs>
    ${centred(`
      ${cabin(model)}
      <path d="M-12 ${w + 1} L-2 ${w} L-8 ${w + 9} L-17 ${w + 10} Z" fill="url(#shine)"/>
      <rect x="${-HALF_W - 3}" y="${mirrors}" width="6" height="4" rx="2" fill="${INK}"/>
      <rect x="${HALF_W - 3}" y="${mirrors}" width="6" height="4" rx="2" fill="${INK}"/>
      <path d="M${-HALF_W + 5} ${HALF_L - 6} Q${-HALF_W + 7} ${HALF_L - 2} ${-HALF_W + 14} ${HALF_L - 1.5} L${-HALF_W + 15} ${HALF_L - 6} Z" fill="#fff6c2"/>
      <path d="M${HALF_W - 5} ${HALF_L - 6} Q${HALF_W - 7} ${HALF_L - 2} ${HALF_W - 14} ${HALF_L - 1.5} L${HALF_W - 15} ${HALF_L - 6} Z" fill="#fff6c2"/>
      <rect x="${-HALF_W + 6}" y="${-HALF_L + 1}" width="10" height="3.5" rx="1.5" fill="#e0392d"/>
      <rect x="${HALF_W - 16}" y="${-HALF_L + 1}" width="10" height="3.5" rx="1.5" fill="#e0392d"/>
      <path d="${bodyPath(model)}" fill="none" stroke="${INK}" stroke-width="2.2" stroke-opacity="0.75" stroke-linejoin="round"/>
      <path d="M${-HALF_W + nose} ${HALF_L - 0.5} L${HALF_W - nose} ${HALF_L - 0.5}" stroke="${INK}" stroke-width="2" stroke-opacity="0.35"/>
    `)}`;
}

export function carFrames(): Frame[] {
  const anchor = { x: 0.5, y: 0.5 };
  return CAR_MODELS.flatMap((model) =>
    (
      [
        ['base', base(model)],
        ['paint', paint(model)],
        ['details', details(model)],
      ] as const
    ).map(([layer, svg]) => ({
      name: `car_${model}_${layer}`,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      anchor,
      svg,
    })),
  );
}
