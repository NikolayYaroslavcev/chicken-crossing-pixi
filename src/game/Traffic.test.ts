import { gsap } from 'gsap';
import { Container } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import { DIFFICULTIES, DIFFICULTY_LEVELS, type Difficulty } from '@/engine';
import { CAR_LENGTH, type Car } from './Car';
import { JUMP_DURATION } from './Chicken';
import { computeWorldLayout, type LaneLayout } from './layout';
import { createTestAssets } from './testAssets';
import { laneTrafficConfig, MAX_CARS_PER_LANE, Traffic } from './Traffic';

const models = createTestAssets().cars;

const FRAME = 1 / 60;

function setup(difficulty: Difficulty = 'easy') {
  const world = computeWorldLayout(DIFFICULTIES[difficulty].steps);
  const slots = world.lanes.map((lane) => {
    const slot = new Container({ label: `obstacles-${lane.index}` });
    slot.position.set(lane.x, lane.y);
    return slot;
  });
  const traffic = new Traffic(world.lanes.length, models);
  traffic.build(world.lanes, slots, difficulty);
  const lane = (index: number) => world.lanes[index - 1] as LaneLayout;
  return { world, slots, traffic, lane };
}

function run(traffic: Traffic, seconds: number, each?: () => void) {
  for (let t = 0; t < seconds - 1e-9; t += FRAME) {
    traffic.update(FRAME);
    each?.();
  }
}

/** Whether the car covers the chicken standing on that lane (comb to shadow). */
function onChickenSpot(car: Car, lane: LaneLayout): boolean {
  const path = lane.anchor.y - lane.y;
  const top = car.view.y - CAR_LENGTH / 2;
  const bottom = car.view.y + CAR_LENGTH / 2;
  return car.active && bottom > path - 71 && top < path + 6;
}

function overlapping(traffic: Traffic, index: number): boolean {
  const cars = traffic.cars(index);
  return cars.some((car, i) => i > 0 && car.front > (cars[i - 1] as Car).rear + 1e-6);
}

function crashTimeline(): gsap.core.Timeline {
  const timelines = gsap.globalTimeline.getChildren(false, false, true);
  const timeline = timelines[timelines.length - 1] as gsap.core.Timeline;
  timeline.pause();
  return timeline;
}

afterEach(() => {
  gsap.globalTimeline.clear();
});

describe('laneTrafficConfig', () => {
  it('gives the same lane the same traffic every time', () => {
    for (const difficulty of DIFFICULTY_LEVELS) {
      for (let index = 1; index <= DIFFICULTIES[difficulty].steps; index++) {
        expect(laneTrafficConfig(index, difficulty)).toEqual(laneTrafficConfig(index, difficulty));
      }
    }
  });

  it('alternates directions and mixes speeds across lanes', () => {
    const configs = Array.from({ length: 8 }, (_, i) => laneTrafficConfig(i + 1, 'medium'));

    expect(configs.map((config) => config.direction)).toEqual([1, -1, 1, -1, 1, -1, 1, -1]);
    expect(new Set(configs.map((config) => config.speed)).size).toBeGreaterThanOrEqual(3);
  });

  it('packs cars closer on harder levels, never closer than a car length', () => {
    const shortest = (difficulty: Difficulty) =>
      Math.min(...laneTrafficConfig(1, difficulty).headways);

    expect(shortest('hardcore')).toBeLessThan(shortest('easy'));
    for (const difficulty of DIFFICULTY_LEVELS) {
      expect(shortest(difficulty)).toBeGreaterThan(CAR_LENGTH + 20);
    }
  });
});

describe('Traffic', () => {
  it.each(DIFFICULTY_LEVELS)('fills every lane on %s with cars in its slot', (difficulty) => {
    const { traffic, slots, world } = setup(difficulty);

    for (const lane of world.lanes) {
      const cars = traffic.cars(lane.index);
      expect(cars.length).toBeGreaterThan(0);
      expect(cars.every((car) => car.view.parent === slots[lane.index - 1])).toBe(true);
      expect(
        cars.every((car) => car.direction === laneTrafficConfig(lane.index, difficulty).direction),
      ).toBe(true);
      expect(traffic.mode(lane.index)).toBe('open');
      expect(traffic.barrierVisible(lane.index)).toBe(false);
    }
    expect(traffic.activeCount).toBeLessThanOrEqual(traffic.capacity);
  });

  it('staggers cars instead of lining them up across lanes', () => {
    const { traffic } = setup('easy');
    const fronts = [1, 3, 5, 7].map((index) => traffic.cars(index)[0]?.front);

    expect(new Set(fronts).size).toBe(4);
  });

  it('moves cars forward at their lane speed on every update', () => {
    const { traffic } = setup('hard');
    const car = traffic.cars(2).at(-1) as Car;
    const front = car.front;

    traffic.update(0.5);

    expect(car.front).toBeCloseTo(front + 0.1 * car.speed, 5);
    traffic.update(0);
    traffic.update(Number.NaN);
    expect(car.front).toBeCloseTo(front + 0.1 * car.speed, 5);
  });

  it('caps a long frame so a stalled tab does not teleport cars', () => {
    const { traffic } = setup('easy');
    const car = traffic.cars(1).at(-1) as Car;
    const front = car.front;

    traffic.update(5);

    expect(car.front - front).toBeCloseTo(car.cruiseSpeed * 0.1, 5);
  });

  it.each(DIFFICULTY_LEVELS)('keeps running on %s with a bounded set of cars', (difficulty) => {
    const { traffic, world } = setup(difficulty);
    const seen = new Set<Car>();
    let frame = 0;

    run(traffic, 90, () => {
      if (frame++ % 30 !== 0) return;
      for (const lane of world.lanes) {
        for (const car of traffic.cars(lane.index)) seen.add(car);
        expect(traffic.cars(lane.index).length).toBeLessThanOrEqual(MAX_CARS_PER_LANE);
        expect(overlapping(traffic, lane.index)).toBe(false);
      }
    });

    expect(traffic.poolSize).toBeLessThanOrEqual(traffic.capacity);
    expect(seen.size).toBeLessThanOrEqual(traffic.capacity);
    expect(world.lanes.every((lane) => traffic.cars(lane.index).length > 0)).toBe(true);
  });

  it('recycles a car that leaves the road and reuses it later', () => {
    const { traffic, world } = setup('hardcore');
    const leaving = traffic.cars(1)[0] as Car;

    run(traffic, 3);
    expect(traffic.cars(1)).not.toContain(leaving);

    let reused = false;
    run(traffic, 30, () => {
      reused ||= world.lanes.some((lane) => traffic.cars(lane.index).includes(leaving));
    });
    expect(reused).toBe(true);
  });

  it('drives open lanes straight through the spot where the chicken would stand', () => {
    const { traffic, lane } = setup('easy');
    let crossed = false;

    run(traffic, 10, () => {
      crossed ||= traffic.cars(1).some((car) => onChickenSpot(car, lane(1)));
    });

    expect(crossed).toBe(true);
  });

  it('refills the road the same way after a reset', () => {
    const { traffic, world } = setup('medium');
    const snapshot = () =>
      world.lanes.map((lane) => traffic.cars(lane.index).map((car) => [car.front, car.color]));
    const initial = snapshot();

    run(traffic, 7);
    traffic.setProgress(4);
    traffic.reset();

    expect(snapshot()).toEqual(initial);
    expect(world.lanes.every((lane) => traffic.mode(lane.index) === 'open')).toBe(true);
    expect(world.lanes.every((lane) => !traffic.barrierVisible(lane.index))).toBe(true);
  });

  // Whatever the traffic looks like when the hop starts, the lane is clear when it ends.
  it.each([0, 0.37, 0.81, 1.3, 2.05, 2.9, 3.6, 4.45])(
    'clears the landing lane in time and keeps it clear (traffic after %ss)',
    (warmUp) => {
      const { traffic, lane } = setup('hardcore');
      run(traffic, warmUp);

      traffic.clearFor(3, JUMP_DURATION);
      expect(traffic.barrierVisible(3)).toBe(false);
      run(traffic, JUMP_DURATION);
      expect(traffic.cars(3).some((car) => onChickenSpot(car, lane(3)))).toBe(false);

      traffic.showBarrier(3);
      expect(traffic.barrierVisible(3)).toBe(true);
      run(traffic, 20, () => {
        expect(traffic.cars(3).some((car) => onChickenSpot(car, lane(3)))).toBe(false);
        expect(overlapping(traffic, 3)).toBe(false);
      });
      // Arriving cars wait at the barrier instead of vanishing.
      expect(traffic.cars(3).some((car) => car.speed === 0)).toBe(true);
    },
  );

  it('places the chicken instantly with closed lanes behind it and open ones ahead', () => {
    const { traffic, world, lane } = setup('easy');
    run(traffic, 1.7);

    traffic.setProgress(5);

    for (const { index } of world.lanes) {
      expect(traffic.mode(index)).toBe(index <= 5 ? 'closed' : 'open');
      expect(traffic.barrierVisible(index)).toBe(index <= 5);
    }
    run(traffic, 15, () => {
      for (let index = 1; index <= 5; index++) {
        expect(traffic.cars(index).some((car) => onChickenSpot(car, lane(index)))).toBe(false);
      }
    });

    traffic.setProgress(0);
    expect(world.lanes.every(({ index }) => traffic.mode(index) === 'open')).toBe(true);
    expect(world.lanes.every(({ index }) => !traffic.barrierVisible(index))).toBe(true);
  });

  it.each([0, 0.45, 1.1, 1.9, 2.6, 3.3])(
    'sends exactly one car into the crash lane as the hop ends (traffic after %ss)',
    async (warmUp) => {
      const { traffic, world, lane } = setup('hardcore');
      traffic.setProgress(2);
      run(traffic, warmUp);

      let hit = false;
      const impact = traffic.crash(3, JUMP_DURATION).then(() => {
        hit = true;
      });
      const timeline = crashTimeline();
      const scripted = traffic.cars(3).filter((car) => car.scripted);
      expect(scripted).toHaveLength(1);
      const striker = scripted[0] as Car;
      expect(onChickenSpot(striker, lane(3))).toBe(false);

      // Traffic and the scripted car share the hop's clock.
      for (let t = FRAME; t < JUMP_DURATION - FRAME / 2; t += FRAME) {
        traffic.update(FRAME);
        timeline.time(t);
      }
      timeline.time(JUMP_DURATION);
      await impact;

      expect(hit).toBe(true);
      expect(traffic.cars(3).filter((car) => onChickenSpot(car, lane(3)))).toEqual([striker]);
      expect(traffic.mode(3)).toBe('crash');
      expect(traffic.barrierVisible(3)).toBe(false);
      // Lanes the chicken already crossed stay clear.
      expect(
        [1, 2].some((index) => traffic.cars(index).some((car) => onChickenSpot(car, lane(index)))),
      ).toBe(false);

      timeline.progress(1);
      const front = striker.front;
      run(traffic, 5);
      expect(striker.front).toBe(front);
      expect(world.lanes.every(({ index }) => !overlapping(traffic, index))).toBe(true);
    },
  );

  it('lets the crashed car drive off once a new round starts', async () => {
    const { traffic } = setup('hardcore');
    const impact = traffic.crash(1, JUMP_DURATION);
    gsap.globalTimeline.getChildren().forEach((animation) => animation.progress(1));
    await impact;
    const striker = traffic.cars(1).find((car) => car.scripted) as Car;
    const front = striker.front;

    traffic.setProgress(0);
    run(traffic, 1);

    expect(striker.scripted).toBe(false);
    expect(striker.active ? striker.front : Infinity).toBeGreaterThan(front);
    expect(traffic.mode(1)).toBe('open');
  });

  it('settles a crash cut short by a reset and removes the scripted car', async () => {
    const { traffic } = setup('medium');
    const impact = traffic.crash(2, JUMP_DURATION);

    traffic.reset();
    await impact;

    expect(traffic.cars(2).some((car) => car.scripted)).toBe(false);
    expect(gsap.globalTimeline.getChildren()).toHaveLength(0);
  });

  it('rejects lanes that do not exist', () => {
    const { traffic } = setup('hardcore');

    expect(() => traffic.cars(0)).toThrow(RangeError);
    expect(() => traffic.clearFor(16, 0.4)).toThrow(RangeError);
  });

  it('reuses the same pool when rebuilt for another difficulty', () => {
    const easy = computeWorldLayout(DIFFICULTIES.easy.steps);
    const hardcore = computeWorldLayout(DIFFICULTIES.hardcore.steps);
    const slotsFor = (lanes: readonly LaneLayout[]) => lanes.map(() => new Container());
    const traffic = new Traffic(easy.lanes.length, models);
    const capacity = traffic.capacity;

    traffic.build(easy.lanes, slotsFor(easy.lanes), 'easy');
    const created = traffic.poolSize;
    traffic.build(hardcore.lanes, slotsFor(hardcore.lanes), 'hardcore');
    traffic.build(easy.lanes, slotsFor(easy.lanes), 'easy');

    expect(traffic.capacity).toBe(capacity);
    expect(traffic.poolSize).toBe(created);
  });

  it('destroys its cars and barriers and ignores calls afterwards', async () => {
    const { traffic, slots } = setup('hard');
    const cars = [...traffic.cars(1), ...traffic.cars(2)];
    const impact = traffic.crash(1, JUMP_DURATION);

    traffic.destroy();
    traffic.destroy();
    await impact;

    expect(cars.every((car) => car.destroyed)).toBe(true);
    expect(slots.every((slot) => slot.children.length === 0)).toBe(true);
    expect(traffic.activeCount).toBe(0);
    expect(gsap.globalTimeline.getChildren()).toHaveLength(0);
    expect(() => traffic.update(FRAME)).not.toThrow();
    await expect(traffic.crash(1, JUMP_DURATION)).resolves.toBeUndefined();
  });
});
