import type { Frame } from './frame.ts';

/**
 * The chicken, seen from the side and facing right. Coordinates are world units with the
 * origin where the feet touch the ground, so every frame shares the same anchor.
 */

const WIDTH = 104;
const HEIGHT = 96;
/** The feet sit this far above the bottom edge, leaving room for toes and dead-pose feathers. */
const GROUND = 10;

const INK = '#4a3f35';
const COLORS = {
  body: '#ffffff',
  bodyShade: '#efe4d2',
  wing: '#f6efe3',
  wingShade: '#ddcfb9',
  comb: '#e8473a',
  combShade: '#b92f25',
  beak: '#f7a823',
  beakShade: '#d97f12',
  legs: '#f08a24',
  eye: '#1f2430',
  cheek: '#ff9c8f',
} as const;

type Eyes = 'open' | 'blink' | 'happy' | 'squeeze' | 'cross';
type Legs = 'stand' | 'tuck' | 'spread' | 'kick';

interface Pose {
  /** Body lift above the feet; the legs stretch to keep touching the ground. */
  lift?: number;
  squashX?: number;
  squashY?: number;
  /** Wing angle in degrees, negative raises it. */
  wing?: number;
  legs?: Legs;
  eyes?: Eyes;
  beakOpen?: boolean;
  /** Whole-body rotation around the feet, in degrees. */
  tilt?: number;
  /** Extra transform for poses that leave the feet, applied last. */
  transform?: string;
  feathers?: readonly (readonly [number, number, number])[];
}

const LEG_PATHS: Record<Legs, string> = {
  stand:
    'M-7 -13 L-7 0 M-7 0 L-13 0 M-7 0 L-1 0 M-7 0 L-9 2.5 M4 -13 L4 0 M4 0 L-2 0 M4 0 L10 0 M4 0 L2 2.5',
  tuck: 'M-7 -13 L-10 -6 L-4 -4 M-10 -6 L-14 -7 M4 -13 L1 -6 L7 -4 M1 -6 L-3 -7',
  spread:
    'M-7 -13 L-12 0 M-12 0 L-18 0 M-12 0 L-6 0 M4 -13 L9 0 M9 0 L3 0 M9 0 L15 0 M-12 0 L-14 2.5 M9 0 L7 2.5',
  // Drawn pointing forward so they stick up once the body lies on its back.
  kick: 'M-7 -13 L6 -17 M6 -17 L9 -22 M6 -17 L11 -15 M4 -13 L16 -9 M16 -9 L21 -12 M16 -9 L19 -5',
};

function defs(): string {
  return `<defs>
    <radialGradient id="body" cx="0.62" cy="0.3" r="0.8">
      <stop offset="0.45" stop-color="${COLORS.body}"/>
      <stop offset="1" stop-color="${COLORS.bodyShade}"/>
    </radialGradient>
    <linearGradient id="comb" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${COLORS.comb}"/>
      <stop offset="1" stop-color="${COLORS.combShade}"/>
    </linearGradient>
    <linearGradient id="wing" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${COLORS.wing}"/>
      <stop offset="1" stop-color="${COLORS.wingShade}"/>
    </linearGradient>
  </defs>`;
}

function eyes(kind: Eyes): string {
  switch (kind) {
    case 'open':
      return `<ellipse cx="17" cy="-54" rx="2.7" ry="3.3" fill="${COLORS.eye}"/>
        <circle cx="18" cy="-55.4" r="1" fill="#ffffff"/>`;
    case 'blink':
      return `<path d="M14.2 -53.6 Q17 -51.6 19.8 -53.6" fill="none" stroke="${COLORS.eye}" stroke-width="1.8" stroke-linecap="round"/>`;
    case 'happy':
      return `<path d="M14.2 -53 Q17 -57.4 19.8 -53" fill="none" stroke="${COLORS.eye}" stroke-width="2" stroke-linecap="round"/>`;
    case 'squeeze':
      return `<path d="M14 -57 L19.6 -54 L14 -51" fill="none" stroke="${COLORS.eye}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'cross':
      return `<path d="M14.4 -56.6 L19.6 -51.4 M19.6 -56.6 L14.4 -51.4" stroke="${COLORS.eye}" stroke-width="1.9" stroke-linecap="round"/>`;
  }
}

function beak(open: boolean): string {
  const upper = open
    ? `<path d="M24.5 -57 Q31 -58 35 -55 Q30 -53 24.5 -52.5 Z" fill="${COLORS.beak}" stroke="${COLORS.beakShade}" stroke-width="1" stroke-linejoin="round"/>`
    : `<path d="M24.5 -56.5 Q31 -55.5 35 -52 Q30 -49 24.5 -48.5 Z" fill="${COLORS.beak}" stroke="${COLORS.beakShade}" stroke-width="1" stroke-linejoin="round"/>`;
  const lower = open
    ? `<path d="M24.5 -51.5 Q29.5 -50 32 -46.5 Q27 -46 24 -47.5 Z" fill="${COLORS.beakShade}"/>`
    : '';
  return lower + upper;
}

function wing(angle: number): string {
  // Hinged at the shoulder; a raised wing also lifts so it shows above the back.
  const lift = Math.min(0, angle) * 0.12;
  return `<g transform="translate(0 ${lift}) rotate(${-angle} 2 -37)">
    <path d="M-17 -33 C-13 -40 1 -40 6 -32 C5 -23 -5 -19 -13 -22 C-18 -25 -19 -29 -17 -33 Z"
      fill="url(#wing)" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M-11 -24 Q-8 -28 -5 -24 M-6 -23 Q-3 -27 0 -24" fill="none" stroke="${COLORS.wingShade}" stroke-width="1.6" stroke-linecap="round"/>
  </g>`;
}

function feather(x: number, y: number, angle: number): string {
  return `<g transform="translate(${x} ${y}) rotate(${angle})">
    <path d="M0 -6 C3.5 -3 3.5 3 0 6 C-3.5 3 -3.5 -3 0 -6 Z" fill="${COLORS.wing}" stroke="${INK}" stroke-width="1.1"/>
    <path d="M0 -5 L0 7" stroke="${INK}" stroke-width="0.9" stroke-linecap="round"/>
  </g>`;
}

function chicken(pose: Pose): string {
  const {
    lift = 0,
    squashX = 1,
    squashY = 1,
    wing: wingAngle = 0,
    legs = 'stand',
    eyes: eyeKind = 'open',
    beakOpen = false,
    tilt = 0,
    transform = '',
    feathers = [],
  } = pose;

  const legPath = LEG_PATHS[legs];
  const body = `<g transform="translate(0 ${-lift}) scale(${squashX} ${squashY})">
    <path d="M-17 -35 C-27 -40 -33 -50 -30 -58 C-26 -52 -21 -50 -17 -48 C-21 -55 -19 -62 -14 -64 C-13 -56 -10 -51 -6 -48 Z"
      fill="url(#body)" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
    <circle cx="8" cy="-66" r="4.4" fill="url(#comb)" stroke="${COLORS.combShade}" stroke-width="1"/>
    <circle cx="13.5" cy="-69" r="5.2" fill="url(#comb)" stroke="${COLORS.combShade}" stroke-width="1"/>
    <circle cx="19" cy="-66.5" r="4.2" fill="url(#comb)" stroke="${COLORS.combShade}" stroke-width="1"/>
    <path d="M-22 -30 C-22 -45 -11 -50 0 -48 C0 -60 6 -66 14 -66 C23 -66 27.5 -58 26.5 -50 C25.5 -43 22 -39 21 -34 C22 -22 14 -11 0 -11 C-14 -11 -22 -18 -22 -30 Z"
      fill="url(#body)" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
    <ellipse cx="25" cy="-44.5" rx="3" ry="4.6" fill="url(#comb)" stroke="${COLORS.combShade}" stroke-width="0.9"/>
    <ellipse cx="19.5" cy="-47.5" rx="3.6" ry="2.3" fill="${COLORS.cheek}" opacity="0.55"/>
    ${beak(beakOpen)}
    ${eyes(eyeKind)}
    ${wing(wingAngle)}
  </g>`;
  const legsSvg = `<path d="${legPath}" fill="none" stroke="${COLORS.legs}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  const loose = feathers.map(([x, y, angle]) => feather(x, y, angle)).join('');

  return `${defs()}<g transform="translate(${WIDTH / 2} ${HEIGHT - GROUND}) ${transform} rotate(${tilt})">
    ${legsSvg}${body}
  </g><g transform="translate(${WIDTH / 2} ${HEIGHT - GROUND})">${loose}</g>`;
}

/** Lying on its back, legs up, with the back resting on the ground. */
const LYING = 'translate(4 8) rotate(-90 0 -32)';

const POSES = {
  idle: [{}, { squashX: 1.02, squashY: 0.97, wing: 3 }, { eyes: 'blink' }],
  jump: [
    { legs: 'tuck', wing: -45, eyes: 'open', squashY: 1.04 },
    { legs: 'tuck', wing: -10, squashY: 1.02 },
    { legs: 'tuck', wing: 18 },
    { legs: 'tuck', wing: -20, squashY: 1.02 },
  ],
  dead: [
    { squashX: 1.14, squashY: 0.84, wing: -70, eyes: 'squeeze', beakOpen: true, legs: 'spread' },
    {
      tilt: -24,
      wing: -60,
      eyes: 'squeeze',
      beakOpen: true,
      legs: 'spread',
      feathers: [
        [-28, -58, -30],
        [24, -70, 40],
      ],
    },
    {
      transform: LYING,
      legs: 'kick',
      wing: -20,
      eyes: 'cross',
      beakOpen: true,
      feathers: [
        [-34, -42, -60],
        [30, -54, 70],
      ],
    },
    {
      transform: LYING,
      legs: 'kick',
      wing: -8,
      eyes: 'cross',
      beakOpen: true,
      feathers: [
        [-38, -8, -95],
        [36, -6, 100],
      ],
    },
  ],
  win: [
    { wing: -80, eyes: 'happy', beakOpen: true, lift: 2, legs: 'spread' },
    { wing: -40, eyes: 'happy', beakOpen: true, legs: 'spread' },
    { wing: -95, eyes: 'happy', beakOpen: true, lift: 3, legs: 'spread' },
    { wing: -40, eyes: 'happy', beakOpen: true, legs: 'spread' },
  ],
} satisfies Record<string, Pose[]>;

/** Frame order per animation; idle breathes three times before it blinks. */
const SEQUENCES: Record<keyof typeof POSES, number[]> = {
  idle: [0, 1, 0, 1, 0, 1, 2, 0],
  jump: [0, 1, 2, 3],
  dead: [0, 1, 2, 3],
  win: [0, 1, 2, 3],
};

export function chickenFrames(): Frame[] {
  const anchor = { x: 0.5, y: (HEIGHT - GROUND) / HEIGHT };
  return Object.entries(POSES).flatMap(([name, poses]) =>
    poses.map((pose, index) => ({
      name: `chicken_${name}_${index}`,
      width: WIDTH,
      height: HEIGHT,
      anchor,
      svg: chicken(pose as Pose),
    })),
  );
}

export function chickenAnimations(): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(SEQUENCES).map(([name, order]) => [
      `chicken_${name}`,
      order.map((index) => `chicken_${name}_${index}`),
    ]),
  );
}

export function chickenShadow(): Frame {
  return {
    name: 'chicken_shadow',
    width: 56,
    height: 18,
    anchor: { x: 0.5, y: 0.5 },
    svg: `<defs><radialGradient id="shadow">
        <stop offset="0" stop-color="#000" stop-opacity="0.32"/>
        <stop offset="0.7" stop-color="#000" stop-opacity="0.2"/>
        <stop offset="1" stop-color="#000" stop-opacity="0"/>
      </radialGradient></defs>
      <ellipse cx="28" cy="9" rx="27" ry="8.5" fill="url(#shadow)"/>`,
  };
}
