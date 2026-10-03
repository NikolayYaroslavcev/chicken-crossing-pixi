import { gsap } from 'gsap';
import { Container, Graphics, GraphicsContext } from 'pixi.js';
import type { Point } from './layout';

export type EffectKind = 'land' | 'crash' | 'cashout' | 'finish';
export type EffectPhase = 'start' | 'end';
export type EffectListener = (kind: EffectKind, phase: EffectPhase) => void;

export interface EffectsOptions {
  reducedMotion?: boolean;
  /** Told when a kind of effect starts and when its last piece is gone. */
  onEffect?: EffectListener;
}

/** Every piece is created up front; a burst that finds the pool empty simply draws fewer. */
export const MAX_PARTICLES = 96;
export const MAX_RINGS = 8;

const SHAKE_AMPLITUDE = 3;

type Shape = 'dot' | 'spark' | 'feather';

interface Piece {
  readonly view: Graphics;
  active: boolean;
  kind: EffectKind;
  /** Seconds since the piece started; negative while it waits for its delay. */
  age: number;
  life: number;
}

interface Particle extends Piece {
  vx: number;
  vy: number;
  gravity: number;
  /** Share of the speed kept after one second. */
  drag: number;
  spin: number;
  scaleFrom: number;
  scaleTo: number;
  alpha: number;
}

interface Ring extends Piece {
  scaleFrom: number;
  scaleTo: number;
  /** Vertical squash, so a ring on the ground reads as lying flat. */
  squash: number;
  alpha: number;
}

interface Burst {
  shape: Shape;
  count: number;
  at: Point;
  spread: { x: number; y: number };
  speed: [number, number];
  /** Direction range in radians; 0 points right, -PI/2 up. */
  angle: [number, number];
  gravity: number;
  drag: number;
  life: [number, number];
  scale: [number, number];
  colors: readonly number[];
  alpha?: number;
  delay?: number;
  spin?: number;
}

interface RingSpec {
  at: Point;
  color: number;
  life: number;
  scale: [number, number];
  squash?: number;
  alpha?: number;
  delay?: number;
}

const COLORS = {
  dust: [0xe2dccf, 0xc9c2b6, 0xf2eee6],
  feathers: [0xffffff, 0xfff4e0, 0xf1e6d2],
  impact: 0xfff1b8,
  gold: [0xffcf4a, 0xffe08a, 0xfff6cf, 0xf5c518],
  celebration: [0xffcf4a, 0xffffff, 0xffe08a, 0xffffff, 0xf5c518],
  white: 0xffffff,
} as const;

/** Small deterministic generator: the visuals vary, but the same way on every run. */
function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawShapes(): Record<Shape | 'ring', GraphicsContext> {
  const spark = new GraphicsContext()
    .poly([0, -9, 2.2, -2.2, 9, 0, 2.2, 2.2, 0, 9, -2.2, 2.2, -9, 0, -2.2, -2.2])
    .fill(0xffffff);
  return {
    dot: new GraphicsContext().circle(0, 0, 8).fill(0xffffff),
    spark,
    feather: new GraphicsContext().ellipse(0, 0, 9, 3.5).fill(0xffffff),
    ring: new GraphicsContext().circle(0, 0, 10).stroke({ width: 3, color: 0xffffff }),
  };
}

/**
 * Short visual feedback in world coordinates: dust, sparks, rings and small tweens. It never
 * learns why it plays; the scene calls it after the engine has decided the outcome. Pieces are
 * pooled and moved by `update`, so a burst allocates nothing and work stops when all are gone.
 */
export class Effects {
  private readonly below = new Container({ label: 'effectsBelow' });
  private readonly above = new Container({ label: 'effects' });
  private readonly shapes = drawShapes();
  private readonly particles: Particle[] = [];
  private readonly rings: Ring[] = [];
  /** One running tween per target; a new one on the same target takes over from it. */
  private readonly tweens = new Map<
    object,
    { animation: gsap.core.Animation; finish: () => void }
  >();
  private readonly live: Record<EffectKind, number> = { land: 0, crash: 0, cashout: 0, finish: 0 };
  private readonly random = sequence(0x5eed);
  private reducedMotion: boolean;
  private readonly onEffect: EffectListener | null;
  private destroyed = false;

  /**
   * `ground` holds what lies under the chicken (rings on the road), `air` what flies in front
   * of it. Both scroll with the world.
   */
  constructor(ground: Container, air: Container, options: EffectsOptions = {}) {
    this.reducedMotion = options.reducedMotion ?? false;
    this.onEffect = options.onEffect ?? null;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const view = new Graphics({ context: this.shapes.dot, label: 'particle', visible: false });
      this.above.addChild(view);
      this.particles.push({
        view,
        active: false,
        kind: 'land',
        age: 0,
        life: 1,
        vx: 0,
        vy: 0,
        gravity: 0,
        drag: 1,
        spin: 0,
        scaleFrom: 1,
        scaleTo: 1,
        alpha: 1,
      });
    }
    for (let i = 0; i < MAX_RINGS; i++) {
      const view = new Graphics({ context: this.shapes.ring, label: 'ring', visible: false });
      this.below.addChild(view);
      this.rings.push({
        view,
        active: false,
        kind: 'land',
        age: 0,
        life: 1,
        scaleFrom: 1,
        scaleTo: 1,
        squash: 1,
        alpha: 1,
      });
    }
    ground.addChildAt(this.below, 0);
    air.addChild(this.above);
  }

  /** Applies to effects started from now on; the ones already playing finish as they began. */
  setReducedMotion(reducedMotion: boolean): void {
    this.reducedMotion = reducedMotion;
  }

  get activeCount(): number {
    let count = 0;
    for (const piece of this.particles) if (piece.active) count++;
    for (const piece of this.rings) if (piece.active) count++;
    return count;
  }

  get tweenCount(): number {
    return this.tweens.size;
  }

  isPlaying(kind: EffectKind): boolean {
    return this.live[kind] > 0;
  }

  land(at: Point): void {
    if (!this.begin('land')) return;
    this.ring('land', {
      at,
      color: COLORS.white,
      life: 0.38,
      scale: [1.2, 4.2],
      squash: 0.32,
      alpha: 0.5,
    });
    this.burst('land', {
      shape: 'dot',
      count: 8,
      at: { x: at.x, y: at.y - 2 },
      spread: { x: 14, y: 3 },
      speed: [50, 120],
      angle: [-Math.PI * 0.95, -Math.PI * 0.05],
      gravity: 160,
      drag: 0.05,
      life: [0.3, 0.46],
      scale: [0.42, 0.12],
      colors: COLORS.dust,
      alpha: 0.85,
    });
    this.end('land');
  }

  crash(at: Point, shakeTarget?: Container): void {
    if (!this.begin('crash')) return;
    const body = { x: at.x, y: at.y - 30 };
    this.burst('crash', {
      shape: 'spark',
      count: 1,
      at: body,
      spread: { x: 0, y: 0 },
      speed: [0, 0],
      angle: [0, 0],
      gravity: 0,
      drag: 1,
      life: [0.2, 0.2],
      scale: [1.4, 4.6],
      colors: [COLORS.impact],
      alpha: 0.95,
    });
    this.ring('crash', {
      at: body,
      color: COLORS.impact,
      life: 0.36,
      scale: [1.5, 6.5],
      alpha: 0.9,
    });
    this.ring('crash', {
      at,
      color: COLORS.white,
      life: 0.5,
      scale: [1.5, 5.5],
      squash: 0.32,
      alpha: 0.45,
    });
    this.burst('crash', {
      shape: 'feather',
      count: 12,
      at: body,
      spread: { x: 10, y: 10 },
      speed: [90, 230],
      angle: [-Math.PI, 0],
      gravity: 420,
      drag: 0.12,
      life: [0.65, 0.95],
      scale: [1, 0.7],
      colors: COLORS.feathers,
      spin: 9,
    });
    this.burst('crash', {
      shape: 'dot',
      count: 8,
      at,
      spread: { x: 18, y: 4 },
      speed: [40, 110],
      angle: [-Math.PI * 0.95, -Math.PI * 0.05],
      gravity: 120,
      drag: 0.08,
      life: [0.4, 0.6],
      scale: [0.55, 0.2],
      colors: COLORS.dust,
      alpha: 0.75,
    });
    if (shakeTarget && !this.reducedMotion) this.shake(shakeTarget);
    this.end('crash');
  }

  /** A few gold sparks rising off the chicken; deliberately smaller than the finish. */
  cashOut(at: Point): void {
    if (!this.begin('cashout')) return;
    const body = { x: at.x, y: at.y - 34 };
    this.ring('cashout', {
      at: body,
      color: COLORS.gold[0],
      life: 0.45,
      scale: [2, 4.4],
      alpha: 0.7,
    });
    this.burst('cashout', {
      shape: 'spark',
      count: 9,
      at: body,
      spread: { x: 26, y: 22 },
      speed: [30, 80],
      angle: [-Math.PI * 0.85, -Math.PI * 0.15],
      gravity: -30,
      drag: 0.2,
      life: [0.55, 0.8],
      scale: [0.75, 0],
      colors: COLORS.gold,
      spin: 4,
    });
    this.end('cashout');
  }

  finish(at: Point, egg: Point): void {
    if (!this.begin('finish')) return;
    const eggCentre = { x: egg.x, y: egg.y - 34 };
    const body = { x: at.x, y: at.y - 34 };
    this.ring('finish', {
      at: eggCentre,
      color: COLORS.gold[0],
      life: 0.6,
      scale: [2, 8],
      alpha: 0.9,
    });
    this.ring('finish', {
      at: eggCentre,
      color: COLORS.white,
      life: 0.6,
      scale: [2, 6.5],
      alpha: 0.6,
      delay: 0.18,
    });
    this.ring('finish', { at: body, color: COLORS.gold[1], life: 0.5, scale: [2, 5], alpha: 0.7 });
    this.burst('finish', {
      shape: 'spark',
      count: 28,
      at: eggCentre,
      spread: { x: 8, y: 10 },
      speed: [110, 260],
      angle: [-Math.PI, Math.PI],
      gravity: 160,
      drag: 0.25,
      life: [0.9, 1.3],
      scale: [1.4, 0.35],
      colors: COLORS.celebration,
      spin: 6,
    });
    this.burst('finish', {
      shape: 'spark',
      count: 12,
      at: body,
      spread: { x: 22, y: 18 },
      speed: [60, 150],
      angle: [-Math.PI * 0.9, -Math.PI * 0.1],
      gravity: 60,
      drag: 0.15,
      life: [0.7, 1],
      scale: [0.7, 0],
      colors: COLORS.gold,
      spin: 5,
      delay: 0.08,
    });
    this.burst('finish', {
      shape: 'dot',
      count: 10,
      at: { x: eggCentre.x, y: eggCentre.y + 10 },
      spread: { x: 30, y: 8 },
      speed: [20, 50],
      angle: [-Math.PI * 0.7, -Math.PI * 0.3],
      gravity: -40,
      drag: 0.3,
      life: [0.9, 1.3],
      scale: [0.3, 0],
      colors: COLORS.gold,
      delay: 0.2,
    });
    this.end('finish');
  }

  pop(target: Container, rest: number, peak: number, duration = 0.28): void {
    if (this.destroyed) return;
    this.track(
      target,
      gsap
        .timeline()
        .to(target.scale, { x: peak, y: peak, duration: duration * 0.4, ease: 'power2.out' })
        .to(target.scale, { x: rest, y: rest, duration: duration * 0.6, ease: 'back.out(3)' }),
      () => target.scale.set(rest),
    );
  }

  /** Eases `target` to a new position and scale; ends there even when cut short. */
  settle(target: Container, x: number, y: number, scale: number, duration = 0.26): void {
    if (this.destroyed) return;
    this.track(
      target,
      gsap
        .timeline()
        .to(target.position, { x, y, duration, ease: 'back.out(2)' }, 0)
        .to(target.scale, { x: scale, y: scale, duration, ease: 'back.out(2)' }, 0),
      () => {
        target.position.set(x, y);
        target.scale.set(scale);
      },
    );
  }

  update(seconds: number): void {
    if (this.destroyed) return;
    const dt = Math.min(Math.max(seconds, 0), 0.1);
    for (const piece of this.particles) {
      if (!piece.active) continue;
      piece.age += dt;
      if (piece.age < 0) continue;
      const t = piece.age / piece.life;
      if (t >= 1) {
        this.release(piece);
        continue;
      }
      const keep = piece.drag ** dt;
      piece.vx *= keep;
      piece.vy = piece.vy * keep + piece.gravity * dt;
      const { view } = piece;
      view.visible = true;
      view.x += piece.vx * dt;
      view.y += piece.vy * dt;
      view.rotation += piece.spin * dt;
      view.scale.set(piece.scaleFrom + (piece.scaleTo - piece.scaleFrom) * t);
      view.alpha = piece.alpha * (1 - t * t);
    }
    for (const ring of this.rings) {
      if (!ring.active) continue;
      ring.age += dt;
      if (ring.age < 0) continue;
      const t = ring.age / ring.life;
      if (t >= 1) {
        this.release(ring);
        continue;
      }
      const eased = 1 - (1 - t) ** 3;
      const scale = ring.scaleFrom + (ring.scaleTo - ring.scaleFrom) * eased;
      ring.view.visible = true;
      ring.view.scale.set(scale, scale * ring.squash);
      ring.view.alpha = ring.alpha * (1 - t);
    }
  }

  /** Removes every piece and stops every tween at its end state. */
  clear(): void {
    if (this.destroyed) return;
    for (const piece of this.particles) if (piece.active) this.release(piece);
    for (const ring of this.rings) if (ring.active) this.release(ring);
    const tweens = [...this.tweens.values()];
    this.tweens.clear();
    for (const { animation, finish } of tweens) {
      animation.kill();
      finish();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    this.below.destroy({ children: true });
    this.above.destroy({ children: true });
    for (const context of Object.values(this.shapes)) context.destroy();
    this.particles.length = 0;
    this.rings.length = 0;
  }

  private shake(target: Container): void {
    const amplitude = SHAKE_AMPLITUDE;
    this.track(
      target,
      gsap
        .timeline()
        .to(target, { y: amplitude, duration: 0.05, ease: 'power2.out' })
        .to(target, { y: amplitude * 0.15, duration: 0.06, ease: 'sine.inOut' })
        .to(target, { y: amplitude * 0.6, duration: 0.06, ease: 'sine.inOut' })
        .to(target, { y: 0, duration: 0.1, ease: 'power2.in' }),
      () => {
        target.y = 0;
      },
    );
  }

  /** A burst counts as live from here until its last piece is gone. */
  private begin(kind: EffectKind): boolean {
    if (this.destroyed) return false;
    this.live[kind]++;
    if (this.live[kind] === 1) this.onEffect?.(kind, 'start');
    return true;
  }

  /** Drops the hold `begin` took; a burst whose pool was empty ends right away. */
  private end(kind: EffectKind): void {
    this.live[kind]--;
    if (this.live[kind] === 0) this.onEffect?.(kind, 'end');
  }

  private burst(kind: EffectKind, spec: Burst): void {
    const count = this.reducedMotion ? Math.ceil(spec.count / 2) : spec.count;
    for (let i = 0; i < count; i++) {
      const piece = this.particles.find((candidate) => !candidate.active);
      if (!piece) return;
      const angle = this.between(spec.angle[0], spec.angle[1]);
      const speed = this.between(spec.speed[0], spec.speed[1]);
      Object.assign(piece, {
        active: true,
        kind,
        age: -(spec.delay ?? 0),
        life: this.between(spec.life[0], spec.life[1]),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: spec.gravity,
        drag: spec.drag,
        spin: (spec.spin ?? 0) * (this.random() * 2 - 1),
        scaleFrom: spec.scale[0],
        scaleTo: spec.scale[1],
        alpha: spec.alpha ?? 1,
      });
      const { view } = piece;
      view.context = this.shapes[spec.shape];
      view.tint = spec.colors[Math.floor(this.random() * spec.colors.length)] ?? 0xffffff;
      view.position.set(
        spec.at.x + this.between(-spec.spread.x, spec.spread.x),
        spec.at.y + this.between(-spec.spread.y, spec.spread.y),
      );
      view.rotation = this.random() * Math.PI * 2;
      view.scale.set(spec.scale[0]);
      view.alpha = piece.alpha;
      view.visible = false;
      this.live[kind]++;
    }
  }

  private ring(kind: EffectKind, spec: RingSpec): void {
    const ring = this.rings.find((candidate) => !candidate.active);
    if (!ring) return;
    Object.assign(ring, {
      active: true,
      kind,
      age: -(spec.delay ?? 0),
      life: this.reducedMotion ? spec.life * 0.7 : spec.life,
      scaleFrom: spec.scale[0],
      scaleTo: spec.scale[1],
      squash: spec.squash ?? 1,
      alpha: spec.alpha ?? 1,
    });
    const { view } = ring;
    view.tint = spec.color;
    view.position.set(spec.at.x, spec.at.y);
    view.scale.set(spec.scale[0], spec.scale[0] * ring.squash);
    view.alpha = ring.alpha;
    view.visible = false;
    this.live[kind]++;
  }

  private release(piece: Piece): void {
    piece.active = false;
    piece.view.visible = false;
    this.live[piece.kind]--;
    if (this.live[piece.kind] === 0) this.onEffect?.(piece.kind, 'end');
  }

  private track(target: object, animation: gsap.core.Animation, finish: () => void): void {
    const previous = this.tweens.get(target);
    if (previous) {
      previous.animation.kill();
      previous.finish();
    }
    this.tweens.set(target, { animation, finish });
    animation.eventCallback('onComplete', () => {
      if (this.tweens.get(target)?.animation === animation) this.tweens.delete(target);
    });
  }

  private between(min: number, max: number): number {
    return min + (max - min) * this.random();
  }
}
