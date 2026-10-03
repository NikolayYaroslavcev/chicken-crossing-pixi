import { Container, Graphics, Text, TextStyle, type Ticker } from 'pixi.js';
import {
  DIFFICULTY_LEVELS,
  getDifficultyConfig,
  getMultiplierTable,
  type Difficulty,
  type RoundState,
  type StepResult,
} from '@/engine';
import type { GameScene as RoundScene } from '@/store/scene';
import { FONT_FAMILY, type GameAssets } from './assets';
import { Camera } from './Camera';
import { Effects, type EffectKind, type EffectListener } from './Effects';
import {
  Chicken,
  type ChickenPlacement,
  type ChickenRestState,
  type ChickenState,
  JUMP_DURATION,
} from './Chicken';
import {
  BADGE_RADIUS,
  computeWorldLayout,
  ROAD_HEIGHT,
  ROAD_TOP,
  worldScale,
  type LaneLayout,
  type Point,
  type WorldLayout,
} from './layout';
import type { SoundCues } from './Sound';
import { Traffic } from './Traffic';

/** Bottom to top. */
export const LAYERS = [
  'background',
  'lanes',
  'obstacles',
  'badges',
  'chicken',
  'effects',
  'foreground',
] as const;
export type LayerName = (typeof LAYERS)[number];

export type LaneState = 'completed' | 'current' | 'next' | 'future';

export interface Viewport {
  width: number;
  height: number;
}

export interface GameSceneOptions {
  difficulty: Difficulty;
  viewport: Viewport;
  assets: GameAssets;
  /** Drives the traffic, frame animations and effects; without one they stand still. */
  ticker?: Ticker;
  reducedMotion?: boolean;
  /** Told when a kind of effect starts and when it has fully played out. */
  onEffect?: EffectListener;
  /** Hears the same moments the effects play: touchdown, crash, finish and cash out. */
  sound?: SoundCues;
}

const MAX_LANES = Math.max(
  ...DIFFICULTY_LEVELS.map((difficulty) => getDifficultyConfig(difficulty).steps),
);

const COLORS = {
  sky: 0x9ed7f0,
  hills: 0x7cc56f,
  sidewalk: 0xc9c2b6,
  curb: 0x8f877b,
  asphalt: 0x3b3f4a,
  marking: 0xf1f1f1,
  highlight: 0xffffff,
  badge: 0xffffff,
  badgeShadow: 0x161921,
  badgeRim: 0x1f2430,
  badgeCompleted: 0x535a6b,
  badgeCurrent: 0xffcf4a,
  badgeNext: 0xffffff,
  badgeFuture: 0xdfe3ea,
  label: 0x1f2430,
  labelCompleted: 0xc8cdd8,
  finish: 0x6fbf5e,
  flag: 0xf4f4f4,
  egg: 0xf5c518,
  eggShine: 0xfff2b0,
} as const;

const DASH_LENGTH = 26;
const DASH_GAP = 18;

/**
 * The lane the chicken stands on moves its badge down to a smaller plate at the chicken's
 * feet, so the chicken never hides its own multiplier. The lane geometry stays as it is.
 */
const CURRENT_BADGE_DROP = 18;
const CURRENT_BADGE_SCALE = 0.8;
/** Sky drawn above the world, so the crash jolt never shows the edge of the scene. */
const SCENERY_OVERSCAN = 8;

export function formatMultiplier(multiplier: number): string {
  return `x${multiplier.toFixed(2)}`;
}

interface LaneView {
  readonly layout: LaneLayout;
  readonly container: Container;
  readonly highlight: Graphics;
  /** Holds the badge above the traffic, aligned with the lane so passing cars never hide it. */
  readonly badgeSlot: Container;
  /** Holds the lane's cars and barrier. */
  readonly obstacles: Container;
  /** The multiplier badge as a whole, positioned at its centre so it can move and scale. */
  readonly badgeGroup: Container;
  readonly badgeHome: Point;
  readonly badge: Graphics;
  readonly ring: Graphics;
  readonly label: Text;
}

/**
 * Draws the crossing. It is told what to show (difficulty, how far the chicken got) and never
 * decides anything about the round itself.
 */
export class GameScene implements RoundScene {
  private readonly root = new Container({ label: 'gameScene' });
  /** Everything that scrolls; the camera moves it, the root only scales it to the viewport. */
  private readonly worldView = new Container({ label: 'world' });
  private readonly camera = new Camera(this.worldView);
  private readonly layers: Readonly<Record<LayerName, Container>>;
  private readonly background = new Graphics({ label: 'background' });
  private readonly labelStyle = new TextStyle({
    fontFamily: `${FONT_FAMILY}, ui-rounded, 'SF Pro Rounded', 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif`,
    fontSize: 19,
    fontWeight: '700',
    fill: 0xffffff,
  });

  private readonly traffic: Traffic;
  private readonly ticker: Ticker | null;
  private readonly chicken: Chicken;
  private readonly effects: Effects;
  private readonly sound: SoundCues | null;
  private goldenEgg: Container | null = null;
  private lanes: LaneView[] = [];
  private world: WorldLayout;
  private currentDifficulty: Difficulty;
  private progress = 0;
  /** First and last lane drawn; the others are hidden while they are out of view. */
  private shownFrom = 0;
  private shownTo = 0;
  private viewport: Viewport;
  private destroyed = false;

  constructor(
    parent: Container,
    { difficulty, viewport, assets, ticker, reducedMotion, onEffect, sound }: GameSceneOptions,
  ) {
    this.layers = Object.fromEntries(
      LAYERS.map((name) => [name, new Container({ label: name })]),
    ) as Record<LayerName, Container>;
    for (const name of LAYERS) this.worldView.addChild(this.layers[name]);
    this.root.addChild(this.worldView);
    this.layers.background.addChild(this.background);

    this.ticker = ticker ?? null;
    this.sound = sound ?? null;
    this.traffic = new Traffic(MAX_LANES, assets.cars);
    this.currentDifficulty = difficulty;
    this.viewport = sanitize(viewport);
    this.world = this.build(difficulty);
    this.effects = new Effects(this.layers.chicken, this.layers.effects, {
      reducedMotion,
      onEffect,
    });
    this.chicken = new Chicken(this.layers.chicken, this.placement(0), {
      textures: assets.chicken,
      ticker: this.ticker ?? undefined,
    });
    this.applyScale();
    this.camera.lookAt(this.world.start.anchor.x);
    this.ticker?.add(this.tick);
    parent.addChild(this.root);
  }

  get difficulty(): Difficulty {
    return this.currentDifficulty;
  }

  get layout(): WorldLayout {
    return this.world;
  }

  get stepIndex(): number {
    return this.progress;
  }

  laneState(index: number): LaneState {
    const lane = this.lanes[index - 1];
    if (!lane) throw new RangeError(`No lane ${index} on ${this.currentDifficulty}`);
    return stateOf(index, this.progress);
  }

  get cameraX(): number {
    return this.camera.x;
  }

  get viewWidth(): number {
    return this.camera.viewportWidth;
  }

  get chickenState(): ChickenState {
    return this.chicken.state;
  }

  get activeEffects(): number {
    return this.effects.activeCount + this.effects.tweenCount;
  }

  isEffectPlaying(kind: EffectKind): boolean {
    return this.effects.isPlaying(kind);
  }

  /** Where the chicken stands on `stepIndex` (0 = start sidewalk), in world coordinates. */
  stepAnchor(stepIndex: number): Point {
    this.assertStep(stepIndex);
    return stepIndex === 0
      ? this.world.start.anchor
      : (this.lanes[stepIndex - 1] as LaneView).layout.anchor;
  }

  setDifficulty(difficulty: Difficulty): void {
    if (this.destroyed || difficulty === this.currentDifficulty) return;
    this.currentDifficulty = difficulty;
    this.progress = 0;
    this.effects.clear();
    this.world = this.build(difficulty);
    this.chicken.placeAt(this.placement(0));
    this.applyScale();
    this.camera.lookAt(this.world.start.anchor.x);
  }

  /**
   * Shows the chicken as standing on `stepIndex` (0 = start): lanes before it are completed and
   * the lane after it is highlighted as the next one. The chicken is put there without a hop.
   */
  setProgress(stepIndex: number): void {
    if (this.destroyed) return;
    this.effects.clear();
    this.paintProgress(stepIndex);
    this.traffic.setProgress(stepIndex);
    this.chicken.placeAt(this.placement(stepIndex));
    this.camera.lookAt(this.stepAnchor(stepIndex).x);
  }

  /**
   * Marks `stepIndex` as reached and hops the chicken there, ending in `rest`, while the camera
   * pans along. Traffic on that lane makes way, or for `dead` one car is sent to hit the chicken
   * as it lands. Resolves when the chicken has landed and played that pose and the pan is over.
   * The landing effect for `rest` starts at touchdown and may outlast the promise.
   */
  moveChickenToStep(stepIndex: number, rest: ChickenRestState = 'idle'): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.paintProgress(stepIndex, true);
    const placement = this.placement(stepIndex);
    const onLane = stepIndex > 0;
    const hit = onLane && rest === 'dead' ? this.traffic.crash(stepIndex, JUMP_DURATION) : null;
    if (onLane && !hit) this.traffic.clearFor(stepIndex, JUMP_DURATION);
    return Promise.all([
      this.chicken.moveToLane(placement, rest, () => this.landed(stepIndex, rest)),
      this.camera.follow(placement.at.x),
      hit,
    ]).then(() => {
      if (onLane && !hit) this.traffic.showBarrier(stepIndex);
    });
  }

  setChickenState(state: ChickenRestState): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    return this.chicken.setState(state);
  }

  setReducedMotion(reducedMotion: boolean): void {
    if (this.destroyed) return;
    this.effects.setReducedMotion(reducedMotion);
  }

  resize(viewport: Viewport): void {
    if (this.destroyed) return;
    this.viewport = sanitize(viewport);
    this.applyScale();
  }

  startRound(round: RoundState): Promise<void> {
    this.setDifficulty(round.difficulty);
    this.setProgress(round.stepIndex);
    return Promise.resolve();
  }

  step(result: StepResult): Promise<void> {
    const rest: ChickenRestState = !result.survived
      ? 'dead'
      : result.status === 'finished'
        ? 'win'
        : 'idle';
    return this.moveChickenToStep(result.stepIndex, rest);
  }

  /** Celebrates on the spot; the round is already settled, so nothing waits for it. */
  cashOut(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.effects.cashOut(this.stepAnchor(this.progress));
    this.sound?.play('cashOut');
    const lane = this.lanes[this.progress - 1];
    if (lane) this.effects.pop(lane.badgeGroup, CURRENT_BADGE_SCALE, CURRENT_BADGE_SCALE * 1.18);
    return Promise.resolve();
  }

  reset(): void {
    if (this.destroyed) return;
    this.traffic.reset();
    this.setProgress(0);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ticker?.remove(this.tick);
    this.effects.destroy();
    this.traffic.destroy();
    this.camera.destroy();
    this.chicken.destroy();
    this.lanes = [];
    this.root.destroy({ children: true });
    this.labelStyle.destroy();
  }

  private build(difficulty: Difficulty): WorldLayout {
    const { steps } = getDifficultyConfig(difficulty);
    const multipliers = getMultiplierTable(difficulty);
    const world = computeWorldLayout(steps);

    this.traffic.clear();
    this.layers.obstacles.mask = null;
    clear(this.layers.lanes);
    clear(this.layers.obstacles);
    clear(this.layers.badges);
    clear(this.layers.foreground);

    this.layers.lanes.addChild(drawStart(world));
    this.lanes = world.lanes.map((layout) =>
      this.createLane(layout, multipliers[layout.index - 1] as number, layout.index === steps),
    );
    const slots = this.lanes.map((lane) => {
      this.layers.lanes.addChild(lane.container);
      this.layers.badges.addChild(lane.badgeSlot);
      this.layers.obstacles.addChild(lane.obstacles);
      paintLane(lane, stateOf(lane.layout.index, this.progress));
      return lane.obstacles;
    });
    // Every lane starts shown; the next frame hides the ones out of view.
    this.shownFrom = 1;
    this.shownTo = this.lanes.length;
    // Cars enter and leave past the road edges; the mask hides them over the scenery.
    const roadMask = new Graphics({ label: 'roadMask' })
      .rect(world.start.width, ROAD_TOP, world.finish.x - world.start.width, ROAD_HEIGHT)
      .fill(0xffffff);
    this.layers.obstacles.addChild(roadMask);
    this.layers.obstacles.mask = roadMask;
    this.traffic.build(world.lanes, slots, difficulty);
    this.layers.lanes.addChild(drawFinishGround(world));
    this.goldenEgg = drawGoldenEgg(world);
    this.layers.foreground.addChild(this.goldenEgg);
    return world;
  }

  private readonly tick = (ticker: Ticker): void => {
    const seconds = ticker.deltaMS / 1000;
    this.traffic.update(seconds);
    this.effects.update(seconds);
    this.cullLanes();
  };

  /**
   * Hides the lanes outside the view. Moving cars make Pixi upload the whole scene's vertices
   * every frame, so lanes nobody can see would otherwise cost as much as the visible ones.
   * Everything a lane draws stays within its width, and the visibility only changes when the
   * camera brings another lane into view.
   */
  private cullLanes(): void {
    const first = this.lanes[0];
    if (!first) return;
    const left = this.camera.x - first.layout.x;
    const right = left + this.camera.viewportWidth;
    const width = first.layout.width;
    const from = Math.max(1, Math.floor(left / width) + 1);
    const to = Math.min(this.lanes.length, Math.ceil(right / width));
    if (from === this.shownFrom && to === this.shownTo) return;
    this.shownFrom = from;
    this.shownTo = to;
    for (const lane of this.lanes) {
      const shown = lane.layout.index >= from && lane.layout.index <= to;
      lane.container.visible = shown;
      lane.badgeSlot.visible = shown;
      lane.obstacles.visible = shown;
    }
  }

  /** Touchdown on `stepIndex`: the badge settles under the chicken and the outcome shows and sounds. */
  private landed(stepIndex: number, rest: ChickenRestState): void {
    const lane = this.lanes[stepIndex - 1];
    if (lane) {
      const { x, y, scale } = badgePlacement(lane, 'current');
      this.effects.settle(lane.badgeGroup, x, y, scale);
    }
    const at = this.stepAnchor(stepIndex);
    if (rest === 'dead') {
      this.effects.crash(at, this.worldView);
      this.sound?.play('crash');
      return;
    }
    this.effects.land(at);
    if (rest === 'win') {
      this.effects.finish(at, this.world.finish.anchor);
      if (this.goldenEgg) this.effects.pop(this.goldenEgg, 1, 1.22, 0.5);
    }
    // The finish has its own fanfare in place of the ordinary landing sound.
    this.sound?.play(rest === 'win' ? 'finish' : 'step');
  }

  private createLane(layout: LaneLayout, multiplier: number, last: boolean): LaneView {
    const container = new Container({ label: `lane-${layout.index}` });
    container.position.set(layout.x, layout.y);

    const surface = new Graphics({ label: 'surface' })
      .rect(0, 0, layout.width, layout.height)
      .fill(COLORS.asphalt);
    if (!last) {
      for (let y = DASH_GAP / 2; y < layout.height; y += DASH_LENGTH + DASH_GAP) {
        surface.rect(layout.width - 2, y, 4, Math.min(DASH_LENGTH, layout.height - y));
      }
      surface.fill(COLORS.marking);
    }

    const highlight = new Graphics({ label: 'highlight' })
      .rect(0, 0, layout.width, layout.height)
      .fill({ color: COLORS.highlight, alpha: 0.14 });

    const badgeX = layout.anchor.x - layout.x;
    const badgeY = layout.anchor.y - layout.y;
    const shadow = new Graphics({ label: 'badgeShadow' })
      .circle(0, 5, BADGE_RADIUS)
      .fill({ color: COLORS.badgeShadow, alpha: 0.45 });
    // White so the lane state can tint it; the rim stays untinted to keep the outline crisp.
    const badge = new Graphics({ label: 'badge' })
      .circle(0, 0, BADGE_RADIUS)
      .fill(COLORS.badge)
      .circle(0, 3, BADGE_RADIUS - 6)
      .fill({ color: COLORS.badgeShadow, alpha: 0.06 });
    const rim = new Graphics({ label: 'badgeRim' })
      .circle(0, 0, BADGE_RADIUS)
      .stroke({ width: 3, color: COLORS.badgeRim, alpha: 0.85 });
    const ring = new Graphics({ label: 'badgeRing' })
      .circle(0, 0, BADGE_RADIUS + 6)
      .stroke({ width: 4, color: COLORS.badgeCurrent });

    const label = new Text({
      label: 'multiplier',
      text: formatMultiplier(multiplier),
      style: this.labelStyle,
      anchor: 0.5,
    });

    const badgeGroup = new Container({ label: 'badgeGroup' });
    badgeGroup.position.set(badgeX, badgeY);
    badgeGroup.addChild(shadow, ring, badge, rim, label);
    container.addChild(surface, highlight);
    const badgeSlot = new Container({ label: `badge-${layout.index}` });
    badgeSlot.position.set(layout.x, layout.y);
    badgeSlot.addChild(badgeGroup);
    const obstacles = new Container({ label: `obstacles-${layout.index}` });
    obstacles.position.set(layout.obstacleArea.x, layout.obstacleArea.y);
    return {
      layout,
      container,
      highlight,
      badgeSlot,
      obstacles,
      badgeGroup,
      badgeHome: { x: badgeX, y: badgeY },
      badge,
      ring,
      label,
    };
  }

  private placement(stepIndex: number): ChickenPlacement {
    return { lane: stepIndex, at: this.stepAnchor(stepIndex) };
  }

  /**
   * Colours every lane for the chicken standing on `stepIndex`. A hop eases the badges it
   * leaves behind back into place and keeps the target's badge for touchdown.
   */
  private paintProgress(stepIndex: number, hop = false): void {
    this.assertStep(stepIndex);
    this.progress = stepIndex;
    for (const lane of this.lanes) {
      const state = stateOf(lane.layout.index, stepIndex);
      paintLane(lane, state);
      if (!hop) placeBadge(lane, state);
      else if (lane.layout.index !== stepIndex && !badgeIsAt(lane, state)) {
        const { x, y, scale } = badgePlacement(lane, state);
        this.effects.settle(lane.badgeGroup, x, y, scale, 0.2);
      }
    }
  }

  private assertStep(stepIndex: number): void {
    if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex > this.lanes.length) {
      throw new RangeError(`Step index must be from 0 to ${this.lanes.length}, got ${stepIndex}`);
    }
  }

  private applyScale(): void {
    const scale = worldScale(this.viewport.height);
    const viewWidth = this.viewport.width / scale;
    this.root.scale.set(scale);
    this.camera.resize(this.world.width, viewWidth);

    // Scenery spans the whole view even when the crossing is narrower and centred in it.
    const { min, max } = this.camera.bounds;
    const left = Math.min(0, min);
    const right = Math.max(this.world.width, max + viewWidth);
    const roadHeight = this.world.height - ROAD_TOP;
    this.background
      .clear()
      .rect(left, -SCENERY_OVERSCAN, right - left, ROAD_TOP + SCENERY_OVERSCAN)
      .fill(COLORS.sky)
      .rect(left, ROAD_TOP - 28, right - left, 28)
      .fill(COLORS.hills);
    if (left < 0) this.background.rect(left, ROAD_TOP, -left, roadHeight).fill(COLORS.sidewalk);
    if (right > this.world.width) {
      this.background
        .rect(this.world.width, ROAD_TOP, right - this.world.width, roadHeight)
        .fill(COLORS.finish);
    }
  }
}

function stateOf(index: number, progress: number): LaneState {
  if (index < progress) return 'completed';
  if (index === progress) return 'current';
  if (index === progress + 1) return 'next';
  return 'future';
}

function paintLane(lane: LaneView, state: LaneState): void {
  lane.highlight.visible = state === 'next';
  lane.ring.visible = state === 'next';
  lane.badge.tint =
    state === 'completed'
      ? COLORS.badgeCompleted
      : state === 'current'
        ? COLORS.badgeCurrent
        : state === 'next'
          ? COLORS.badgeNext
          : COLORS.badgeFuture;
  lane.label.tint = state === 'completed' ? COLORS.labelCompleted : COLORS.label;
  lane.label.alpha = state === 'future' ? 0.75 : 1;
}

function badgePlacement(lane: LaneView, state: LaneState): Point & { scale: number } {
  const { x, y } = lane.badgeHome;
  return state === 'current'
    ? { x, y: y + CURRENT_BADGE_DROP, scale: CURRENT_BADGE_SCALE }
    : { x, y, scale: 1 };
}

function badgeIsAt(lane: LaneView, state: LaneState): boolean {
  const { x, y, scale } = badgePlacement(lane, state);
  const group = lane.badgeGroup;
  return group.x === x && group.y === y && group.scale.x === scale && group.scale.y === scale;
}

function placeBadge(lane: LaneView, state: LaneState): void {
  const { x, y, scale } = badgePlacement(lane, state);
  lane.badgeGroup.position.set(x, y);
  lane.badgeGroup.scale.set(scale);
}

function drawStart({ start }: WorldLayout): Graphics {
  return new Graphics({ label: 'start' })
    .rect(start.x, start.y, start.width, start.height)
    .fill(COLORS.sidewalk)
    .rect(start.x + start.width - 8, start.y, 8, start.height)
    .fill(COLORS.curb);
}

function drawFinishGround({ finish }: WorldLayout): Graphics {
  return new Graphics({ label: 'finish' })
    .rect(finish.x, finish.y, finish.width, finish.height)
    .fill(COLORS.finish)
    .rect(finish.x, finish.y, 8, finish.height)
    .fill(COLORS.curb);
}

function drawGoldenEgg({ finish }: WorldLayout): Container {
  const group = new Container({ label: 'goldenEgg' });
  group.position.set(finish.anchor.x, finish.anchor.y);

  const flag = new Graphics()
    .rect(-58, -150, 4, 150)
    .fill(COLORS.curb)
    .poly([-54, -150, -10, -134, -54, -118])
    .fill(COLORS.flag);
  const egg = new Graphics()
    .ellipse(0, -34, 26, 34)
    .fill(COLORS.egg)
    .stroke({ width: 3, color: 0xc99a06 })
    .ellipse(-9, -46, 6, 10)
    .fill(COLORS.eggShine);

  group.addChild(flag, egg);
  return group;
}

function clear(container: Container): void {
  for (const child of container.removeChildren()) child.destroy({ children: true });
}

function sanitize({ width, height }: Viewport): Viewport {
  const safe = (value: number) => (Number.isFinite(value) && value > 0 ? value : 1);
  return { width: safe(width), height: safe(height) };
}
