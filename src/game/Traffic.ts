import { gsap } from 'gsap';
import { Container, Graphics } from 'pixi.js';
import type { Difficulty } from '@/engine';
import type { CarTextures } from './assets';
import { CAR_LENGTH, type Car, type CarDirection } from './Car';
import { CarPool } from './CarPool';
import type { LaneLayout } from './layout';

/** Most cars a single lane holds at once: a full stream, or a queue behind its barrier. */
export const MAX_CARS_PER_LANE = 5;

const LANE_SPEEDS = [150, 230, 190, 280, 170, 250, 210, 300] as const;
const HEADWAYS = [210, 300, 250, 360, 230, 330] as const;
const CAR_COLORS = [0xe5483b, 0x3d8bfd, 0xf5a524, 0x5cc8a8, 0x9b6bd6, 0xf2f2f2] as const;
/** Busier roads on harder levels; the round itself does not change. */
const DENSITY: Readonly<Record<Difficulty, number>> = {
  easy: 1.2,
  medium: 1.05,
  hard: 0.95,
  hardcore: 0.85,
};

/** Bumper to bumper distance kept in a queue. */
const QUEUE_GAP = 12;
const ACCELERATION = 420;
const BRAKING = 1400;
/** New cars are placed this far before the road edge so they never pop in on screen. */
const ENTRY_SLACK = 40;
/** Cars already past the stop line must be clear of the chicken by this share of the hop. */
const CLEAR_SHARE = 0.7;
const IMPACT_PUSH = 14;
const IMPACT_PUSH_DURATION = 0.16;
const FALLBACK_CRASH_SPEED = 640;
/** Longest frame the traffic accepts, so a stalled tab does not teleport cars. */
const MAX_FRAME = 0.1;

export type LaneMode = 'open' | 'closed' | 'crash';

export interface LaneTrafficConfig {
  direction: CarDirection;
  speed: number;
  /** Front to front distances between consecutive cars, cycled in order. */
  headways: readonly number[];
}

/** How traffic behaves on a lane. The same lane always gets the same answer. */
export function laneTrafficConfig(index: number, difficulty: Difficulty): LaneTrafficConfig {
  const density = DENSITY[difficulty];
  return {
    direction: index % 2 === 1 ? 1 : -1,
    speed: LANE_SPEEDS[(index * 3) % LANE_SPEEDS.length] as number,
    headways: HEADWAYS.map((headway) => Math.round(headway * density)),
  };
}

interface LaneTraffic extends LaneTrafficConfig {
  readonly index: number;
  readonly slot: Container;
  readonly barrier: Graphics;
  readonly x: number;
  readonly roadLength: number;
  /** Where waiting cars stop, as distance from the entry edge. */
  readonly stopLine: number;
  /** Past this distance a car's rear has left the chicken behind. */
  readonly clearLine: number;
  readonly impact: number;
  readonly cars: Car[];
  mode: LaneMode;
  headwayCursor: number;
  colorCursor: number;
}

/**
 * Decorative cars on the lanes. Traffic never decides anything about the round: the scene
 * tells it which lanes the chicken has reached, and on a crash the engine has already chosen
 * the lane before a single car is scripted to hit it. Cars only ever drive through the
 * chicken's spot on a lane it has not reached, or when told to by `crash`.
 */
export class Traffic {
  private readonly pool: CarPool;
  private lanes: LaneTraffic[] = [];
  private readonly scripts = new Set<gsap.core.Animation>();
  private isDestroyed = false;

  constructor(maxLanes: number, models: readonly CarTextures[]) {
    this.pool = new CarPool(maxLanes * MAX_CARS_PER_LANE, models);
  }

  get activeCount(): number {
    return this.pool.activeCount;
  }

  get poolSize(): number {
    return this.pool.size;
  }

  get capacity(): number {
    return this.pool.capacity;
  }

  cars(index: number): readonly Car[] {
    return this.lane(index).cars;
  }

  mode(index: number): LaneMode {
    return this.lane(index).mode;
  }

  barrierVisible(index: number): boolean {
    return this.lane(index).barrier.visible;
  }

  /** Lays traffic over a new set of lanes; `slots` hold each lane's cars and barrier. */
  build(layouts: readonly LaneLayout[], slots: readonly Container[], difficulty: Difficulty): void {
    if (this.isDestroyed) return;
    this.clear();
    this.lanes = layouts.map((layout, i) => {
      const slot = slots[i] as Container;
      const config = laneTrafficConfig(layout.index, difficulty);
      const path = layout.anchor.y - layout.y;
      const along = (y: number) => (config.direction === 1 ? y : layout.height - y);
      const barrierY = config.direction === 1 ? path - 104 : path + 54;
      const barrier = drawBarrier(layout.width, barrierY);
      slot.addChild(barrier);
      return {
        ...config,
        index: layout.index,
        slot,
        barrier,
        x: layout.width / 2,
        roadLength: layout.height,
        stopLine:
          config.direction === 1
            ? barrierY - BARRIER_HEIGHT / 2 - 8
            : along(barrierY + BARRIER_HEIGHT / 2 + 8),
        clearLine: config.direction === 1 ? path + 12 : along(path - 76),
        impact: along(config.direction === 1 ? path - 26 : path - 20),
        cars: [],
        mode: 'open',
        headwayCursor: 0,
        colorCursor: 0,
      };
    });
    this.reset();
  }

  /** Every lane open, the scripted car gone and the road refilled the same way as last time. */
  reset(): void {
    if (this.isDestroyed) return;
    this.stopScripts();
    this.pool.releaseAll();
    for (const lane of this.lanes) {
      lane.cars.length = 0;
      lane.mode = 'open';
      lane.barrier.visible = false;
      lane.headwayCursor = (lane.index * 2) % lane.headways.length;
      lane.colorCursor = lane.index % CAR_COLORS.length;
      this.prefill(lane);
    }
  }

  /**
   * Shows the chicken standing on `stepIndex` without a hop: lanes up to it are closed behind
   * barriers, the rest flow freely. Cars caught on the chicken's spot are taken away.
   */
  setProgress(stepIndex: number): void {
    if (this.isDestroyed) return;
    this.stopScripts();
    for (const lane of this.lanes) {
      for (const car of lane.cars) car.scripted = false;
      const closed = lane.index <= stepIndex;
      lane.mode = closed ? 'closed' : 'open';
      lane.barrier.visible = closed;
      if (!closed) continue;
      for (let i = lane.cars.length - 1; i >= 0; i--) {
        const car = lane.cars[i] as Car;
        if (car.front > lane.stopLine && car.rear < lane.clearLine) {
          lane.cars.splice(i, 1);
          this.pool.release(car);
        }
      }
    }
  }

  /**
   * The chicken is about to land on `index` safely within `seconds`: waiting cars stop at the
   * stop line and cars already past it hurry out of the way. The barrier goes up separately,
   * once the chicken is there.
   */
  clearFor(index: number, seconds: number): void {
    if (this.isDestroyed) return;
    const lane = this.lane(index);
    lane.mode = 'closed';
    this.hurryPast(lane, seconds);
  }

  showBarrier(index: number): void {
    if (this.isDestroyed) return;
    const lane = this.lane(index);
    if (lane.mode === 'closed') lane.barrier.visible = true;
  }

  /**
   * Plays the hit on the lane the engine reported as lost: the nearest car that has not reached
   * the chicken yet drives into its spot exactly when the hop ends. Resolves at the moment of
   * impact.
   */
  crash(index: number, seconds: number): Promise<void> {
    if (this.isDestroyed) return Promise.resolve();
    const lane = this.lane(index);
    lane.mode = 'crash';
    lane.barrier.visible = false;
    this.hurryPast(lane, seconds);

    let car = lane.cars.find((candidate) => candidate.front <= lane.stopLine) ?? null;
    if (!car) {
      car = this.spawn(lane, Math.min(-ENTRY_SLACK, lane.impact - FALLBACK_CRASH_SPEED * seconds));
    }
    if (!car) return Promise.resolve();

    const target = car;
    target.scripted = true;
    target.speed = 0;
    return new Promise((resolve) => {
      const timeline = gsap
        .timeline({
          onComplete: () => {
            this.scripts.delete(timeline);
          },
        })
        .to(target, { front: lane.impact, duration: Math.max(seconds, 0.01), ease: 'none' })
        .call(resolve)
        .to(target, {
          front: lane.impact + IMPACT_PUSH,
          duration: IMPACT_PUSH_DURATION,
          ease: 'power2.out',
        });
      // Ending early (reset, destroy) still settles whoever waits for the hit.
      timeline.eventCallback('onInterrupt', resolve);
      this.scripts.add(timeline);
    });
  }

  update(seconds: number): void {
    if (this.isDestroyed || !(seconds > 0)) return;
    const dt = Math.min(seconds, MAX_FRAME);
    for (const lane of this.lanes) {
      let leaderRear = Infinity;
      for (const car of lane.cars) {
        if (!car.scripted) drive(lane, car, leaderRear, dt);
        leaderRear = car.rear;
      }
      this.recycle(lane);
      this.refill(lane);
    }
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.stopScripts();
    this.clear();
    this.pool.destroy();
    this.isDestroyed = true;
  }

  private lane(index: number): LaneTraffic {
    const lane = this.lanes[index - 1];
    if (!lane) throw new RangeError(`No traffic lane ${index}`);
    return lane;
  }

  /** Lets go of the current lanes before the scene destroys their slots. */
  clear(): void {
    this.stopScripts();
    this.pool.releaseAll();
    for (const lane of this.lanes) lane.barrier.destroy();
    this.lanes = [];
  }

  private stopScripts(): void {
    for (const script of this.scripts) script.kill();
    this.scripts.clear();
  }

  /** Every car past the stop line goes fast enough for the slowest to clear the spot in time. */
  private hurryPast(lane: LaneTraffic, seconds: number): void {
    const budget = Math.max(seconds * CLEAR_SHARE, 0.01);
    let required = 0;
    for (const car of lane.cars) {
      if (car.front > lane.stopLine && car.rear < lane.clearLine) {
        required = Math.max(required, (lane.clearLine - car.rear) / budget);
      }
    }
    if (required === 0) return;
    for (const car of lane.cars) {
      if (car.front <= lane.stopLine) break;
      car.scripted = false;
      car.cruiseSpeed = Math.max(car.cruiseSpeed, required);
      car.speed = car.cruiseSpeed;
    }
  }

  private prefill(lane: LaneTraffic): void {
    let front = lane.roadLength + CAR_LENGTH - ((lane.index * 97) % nextHeadway(lane, false));
    while (front > -ENTRY_SLACK && lane.cars.length < MAX_CARS_PER_LANE) {
      if (!this.spawn(lane, front)) return;
      front -= nextHeadway(lane, true);
    }
  }

  private recycle(lane: LaneTraffic): void {
    while (lane.cars.length > 0) {
      const first = lane.cars[0] as Car;
      if (first.rear <= lane.roadLength) return;
      lane.cars.shift();
      this.pool.release(first);
    }
  }

  private refill(lane: LaneTraffic): void {
    if (lane.cars.length >= MAX_CARS_PER_LANE) return;
    const last = lane.cars[lane.cars.length - 1];
    if (!last) {
      this.spawn(lane, -ENTRY_SLACK);
      return;
    }
    const front = last.front - nextHeadway(lane, false);
    if (front >= -ENTRY_SLACK) {
      nextHeadway(lane, true);
      this.spawn(lane, Math.min(front, 0));
    }
  }

  private spawn(lane: LaneTraffic, front: number): Car | null {
    const car = this.pool.acquire();
    if (!car) return null;
    car.activate({
      lane: lane.index,
      x: lane.x,
      roadLength: lane.roadLength,
      direction: lane.direction,
      front,
      speed: lane.speed,
      color: CAR_COLORS[lane.colorCursor] as number,
      // Paired with the colour, so a lane repeats the same cars after every reset.
      model: lane.colorCursor,
    });
    lane.colorCursor = (lane.colorCursor + 1) % CAR_COLORS.length;
    lane.slot.addChild(car.view);
    lane.cars.push(car);
    return car;
  }
}

function nextHeadway(lane: LaneTraffic, consume: boolean): number {
  const headway = lane.headways[lane.headwayCursor] as number;
  if (consume) lane.headwayCursor = (lane.headwayCursor + 1) % lane.headways.length;
  return headway;
}

function drive(lane: LaneTraffic, car: Car, leaderRear: number, dt: number): void {
  let limit = leaderRear - QUEUE_GAP;
  if (lane.mode === 'closed' && car.front <= lane.stopLine + 1e-6) {
    limit = Math.min(limit, lane.stopLine);
  }
  let target = car.cruiseSpeed;
  if (limit !== Infinity) {
    target = Math.min(target, Math.sqrt(2 * BRAKING * Math.max(0, limit - car.front)));
  }
  car.speed = target > car.speed ? Math.min(target, car.speed + ACCELERATION * dt) : target;
  car.advance(dt);
  if (car.front > limit) car.front = limit;
}

const BARRIER_HEIGHT = 14;

function drawBarrier(laneWidth: number, centerY: number): Graphics {
  const left = 10;
  const width = laneWidth - 20;
  const top = centerY - BARRIER_HEIGHT / 2;
  const barrier = new Graphics({ label: 'barrier' })
    .rect(left + 4, top + 4, 6, BARRIER_HEIGHT + 8)
    .rect(left + width - 10, top + 4, 6, BARRIER_HEIGHT + 8)
    .fill(0x8f877b)
    .roundRect(left, top, width, BARRIER_HEIGHT, 4)
    .fill(0xf4f4f4);
  for (let x = left + 6; x < left + width - 8; x += 22) {
    barrier.poly([x, top + BARRIER_HEIGHT, x + 8, top, x + 18, top, x + 10, top + BARRIER_HEIGHT]);
  }
  barrier.fill(0xe5483b).roundRect(left, top, width, BARRIER_HEIGHT, 4).stroke({
    width: 2,
    color: 0x1f2430,
    alpha: 0.6,
  });
  barrier.visible = false;
  return barrier;
}
