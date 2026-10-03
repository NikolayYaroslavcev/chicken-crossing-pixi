import { gsap } from 'gsap';
import { type AnimatedSprite, Container, Graphics, type Sprite, Text, Ticker } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DIFFICULTIES,
  DIFFICULTY_LEVELS,
  getMultiplierTable,
  type Difficulty,
  type StepResult,
} from '@/engine';
import { formatMultiplier, GameScene, LAYERS, type LaneState } from './GameScene';
import { CAR_LENGTH } from './Car';
import { WORLD_HEIGHT } from './layout';
import { createTestAssets } from './testAssets';

const assets = createTestAssets();

function createScene(difficulty: Difficulty = 'easy', viewport = { width: 1024, height: 768 }) {
  const gameRoot = new Container({ label: 'gameRoot' });
  const scene = new GameScene(gameRoot, { difficulty, viewport, assets });
  const root = gameRoot.getChildByLabel('gameScene') as Container;
  const world = root.getChildByLabel('world') as Container;
  const layer = (name: string) => world.getChildByLabel(name) as Container;
  const lanes = () => layer('lanes').children.filter((child) => child.label.startsWith('lane-'));
  const labels = () =>
    layer('badges').children.map((slot) => (slot.getChildByLabel('multiplier', true) as Text).text);
  const chicken = () => layer('chicken').getChildByLabel('chicken') as Container;
  const slots = () =>
    layer('obstacles').children.filter((child) => child.label.startsWith('obstacles-'));
  return { gameRoot, scene, root, world, layer, lanes, labels, chicken, slots };
}

function finishAnimations() {
  for (const animation of gsap.globalTimeline.getChildren(false, true, true)) {
    animation.progress(1);
  }
}

/** Effect pieces that are drawn right now, on the ground and in the air. */
function visibleEffects(layer: (name: string) => Container): number {
  const pieces = [
    ...(layer('chicken').getChildByLabel('effectsBelow') as Container).children,
    ...(layer('effects').getChildByLabel('effects') as Container).children,
  ];
  return pieces.filter((piece) => piece.visible).length;
}

function stepResult(stepIndex: number, overrides: Partial<StepResult> = {}): StepResult {
  return {
    survived: true,
    stepIndex,
    multiplier: 1,
    status: 'playing',
    win: 0,
    balance: 100,
    ...overrides,
  };
}

afterEach(() => {
  gsap.globalTimeline.clear();
});

function states(scene: GameScene, count: number): LaneState[] {
  return Array.from({ length: count }, (_, i) => scene.laneState(i + 1));
}

describe('GameScene', () => {
  it('attaches to the game root with layers in a fixed order', () => {
    const { gameRoot, root, world } = createScene();

    expect(gameRoot.children).toEqual([root]);
    expect(root.children).toEqual([world]);
    expect(world.children.map((child) => child.label)).toEqual([...LAYERS]);
  });

  it('draws each multiplier badge above the traffic and below the chicken', () => {
    const { world, layer, scene } = createScene();
    const depth = (name: string) => world.getChildIndex(layer(name));

    expect(depth('badges')).toBeGreaterThan(depth('obstacles'));
    expect(depth('badges')).toBeLessThan(depth('chicken'));
    const slots = layer('badges').children;
    expect(slots).toHaveLength(scene.layout.lanes.length);
    scene.layout.lanes.forEach((lane, i) => {
      expect(slots[i]?.label).toBe(`badge-${lane.index}`);
      expect(slots[i]?.position.x).toBe(lane.x);
    });
  });

  it('builds the start, finish, golden egg and the chicken', () => {
    const { layer } = createScene();

    expect(layer('lanes').getChildByLabel('start')).toBeInstanceOf(Graphics);
    expect(layer('lanes').getChildByLabel('finish')).toBeInstanceOf(Graphics);
    expect(layer('foreground').getChildByLabel('goldenEgg')).not.toBeNull();
    // Ground effects sit under the chicken; everything else plays in the effects layer.
    expect(layer('chicken').children.map((child) => child.label)).toEqual([
      'effectsBelow',
      'chicken',
    ]);
    expect(layer('effects').children.map((child) => child.label)).toEqual(['effects']);
    expect(visibleEffects(layer)).toBe(0);
  });

  it.each(DIFFICULTY_LEVELS)('draws one lane and obstacle slot per step on %s', (difficulty) => {
    const { lanes, slots } = createScene(difficulty);
    const { steps } = DIFFICULTIES[difficulty];

    expect(lanes()).toHaveLength(steps);
    expect(lanes().map((lane) => lane.label)).toEqual(
      Array.from({ length: steps }, (_, i) => `lane-${i + 1}`),
    );
    expect(slots()).toHaveLength(steps);
    // Each slot only ever holds its lane's barrier and the cars driving on it.
    expect(
      slots().every((slot) =>
        slot.children.every((child) => child.label === 'barrier' || child.label === 'car'),
      ),
    ).toBe(true);
  });

  it.each(DIFFICULTY_LEVELS)('labels lanes with the engine multipliers on %s', (difficulty) => {
    const { labels } = createScene(difficulty);

    expect(labels()).toEqual(getMultiplierTable(difficulty).map(formatMultiplier));
  });

  it('positions lanes and the finish from the layout', () => {
    const { scene, lanes, layer } = createScene('hard');
    const { lanes: geometry, finish } = scene.layout;

    lanes().forEach((lane, i) => {
      expect(lane.position.x).toBe(geometry[i]?.x);
      expect(lane.position.y).toBe(geometry[i]?.y);
    });
    expect(layer('foreground').getChildByLabel('goldenEgg')?.position.x).toBe(finish.anchor.x);
  });

  it('rebuilds lanes on a difficulty change and destroys the old ones', () => {
    const { scene, lanes, labels, layer, slots } = createScene('easy');
    const oldLanes = lanes();
    const oldSlots = slots();
    const oldEgg = layer('foreground').getChildByLabel('goldenEgg');

    scene.setDifficulty('hardcore');

    expect(lanes()).toHaveLength(DIFFICULTIES.hardcore.steps);
    expect(slots()).toHaveLength(DIFFICULTIES.hardcore.steps);
    expect(layer('foreground').children).toHaveLength(1);
    expect(labels()).toEqual(getMultiplierTable('hardcore').map(formatMultiplier));
    expect(oldLanes.every((lane) => lane.destroyed && !lanes().includes(lane))).toBe(true);
    expect(oldSlots.every((slot) => slot.destroyed)).toBe(true);
    expect(oldEgg?.destroyed).toBe(true);

    scene.setDifficulty('easy');
    expect(lanes()).toHaveLength(DIFFICULTIES.easy.steps);
    expect(layer('lanes').children).toHaveLength(DIFFICULTIES.easy.steps + 2);
  });

  it('moves the finish with the lane count', () => {
    const { scene, layer } = createScene('easy');
    const egg = () => layer('foreground').getChildByLabel('goldenEgg');
    const easyFinish = egg()?.position.x;

    scene.setDifficulty('hardcore');

    expect(egg()?.position.x).toBe(scene.layout.finish.anchor.x);
    expect(egg()?.position.x).toBeLessThan(easyFinish ?? 0);
  });

  it('highlights the next lane and marks the progress', () => {
    const { scene, lanes } = createScene('hardcore');
    const highlighted = () =>
      lanes()
        .filter((lane) => lane.getChildByLabel('highlight')?.visible)
        .map((lane) => lane.label);

    expect(states(scene, 3)).toEqual(['next', 'future', 'future']);
    expect(highlighted()).toEqual(['lane-1']);

    scene.setProgress(2);

    expect(states(scene, 4)).toEqual(['completed', 'current', 'next', 'future']);
    expect(highlighted()).toEqual(['lane-3']);

    scene.setProgress(DIFFICULTIES.hardcore.steps);
    expect(scene.laneState(DIFFICULTIES.hardcore.steps)).toBe('current');
    expect(highlighted()).toEqual([]);
  });

  it('rejects progress outside the crossing', () => {
    const { scene } = createScene('hardcore');

    expect(() => scene.setProgress(-1)).toThrow(RangeError);
    expect(() => scene.setProgress(DIFFICULTIES.hardcore.steps + 1)).toThrow(RangeError);
    expect(() => scene.laneState(DIFFICULTIES.hardcore.steps + 1)).toThrow(RangeError);
  });

  it('starts over from the start lane after a difficulty change', () => {
    const { scene } = createScene('medium');
    scene.setProgress(5);

    scene.setDifficulty('hard');

    expect(scene.stepIndex).toBe(0);
    expect(scene.laneState(1)).toBe('next');
  });

  it('plays round updates as visual progress only', async () => {
    const { scene } = createScene('easy');

    await scene.startRound({
      status: 'playing',
      difficulty: 'hard',
      bet: 1,
      stepIndex: 0,
      multiplier: 1,
      balance: 100,
    });
    expect(scene.difficulty).toBe('hard');

    const step = scene.step(stepResult(1, { multiplier: 1.23, balance: 99 }));
    finishAnimations();
    await step;
    expect(scene.stepIndex).toBe(1);

    await scene.cashOut();
    expect(scene.stepIndex).toBe(1);

    scene.reset();
    expect(scene.stepIndex).toBe(0);
  });

  it('stands the chicken idle on the start sidewalk', () => {
    const { scene, chicken } = createScene('medium');

    expect(chicken().position).toMatchObject(scene.layout.start.anchor);
    expect(scene.stepAnchor(0)).toEqual(scene.layout.start.anchor);
    expect(scene.chickenState).toBe('idle');
  });

  it('hops the chicken through every lane, resolving each step after it lands', async () => {
    const { scene, chicken } = createScene('easy');
    const { steps } = DIFFICULTIES.easy;

    for (let index = 1; index <= steps; index++) {
      let landed = false;
      const step = scene.step(stepResult(index)).then(() => {
        landed = true;
      });
      await Promise.resolve();
      expect(landed).toBe(false);
      expect(scene.chickenState).toBe('jump');

      finishAnimations();
      await step;
      expect(chicken().position).toMatchObject(scene.layout.lanes[index - 1]?.anchor ?? {});
      expect(scene.stepIndex).toBe(index);
    }
  });

  it.each([
    ['dead', stepResult(1, { survived: false, status: 'crashed' })],
    ['win', stepResult(1, { status: 'finished' })],
    ['idle', stepResult(1)],
  ] as const)('lands the chicken as %s from the step outcome', async (state, result) => {
    const { scene } = createScene('easy');

    const step = scene.step(result);
    finishAnimations();
    await step;

    expect(scene.chickenState).toBe(state);
  });

  it('plays explicit chicken states on the current lane', async () => {
    const { scene, chicken } = createScene('easy');
    scene.setProgress(2);

    const dead = scene.setChickenState('dead');
    finishAnimations();
    await dead;

    expect(scene.chickenState).toBe('dead');
    expect(chicken().position).toMatchObject(scene.stepAnchor(2));
  });

  it('stops a running hop and returns the chicken to the start on reset', async () => {
    const { scene, chicken } = createScene('easy');
    const step = scene.step(stepResult(1, { survived: false, status: 'crashed' }));
    gsap.globalTimeline.getChildren(false, false, true)[0]?.progress(0.5);

    scene.reset();
    await step;

    expect(gsap.getTweensOf(chicken()).length).toBe(0);
    expect(scene.stepIndex).toBe(0);
    expect(scene.chickenState).toBe('idle');
    expect(chicken().position).toMatchObject(scene.layout.start.anchor);
    expect(scene.laneState(1)).toBe('next');
  });

  it('keeps the chicken on the rebuilt start across difficulty changes', () => {
    const { scene, chicken } = createScene('easy');
    const original = chicken();

    for (const difficulty of ['hard', 'hardcore'] as const) {
      scene.setDifficulty(difficulty);

      expect(chicken()).toBe(original);
      expect(chicken().position).toMatchObject(scene.layout.start.anchor);
      expect(scene.stepIndex).toBe(0);
      expect(scene.chickenState).toBe('idle');
      expect(gsap.getTweensOf(chicken()).length).toBe(0);
    }
  });

  it.each([
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1440, 900],
  ])('fits the world height into a %ix%i viewport', (width, height) => {
    const { scene, root, lanes } = createScene('easy', { width: 320, height: 480 });

    scene.resize({ width, height });

    expect(root.scale.x).toBeCloseTo(height / WORLD_HEIGHT);
    expect(root.scale.y).toBeCloseTo(height / WORLD_HEIGHT);
    expect(lanes()).toHaveLength(DIFFICULTIES.easy.steps);
    expect(scene.layout.lanes[0]?.width).toBe(scene.layout.lanes.at(-1)?.width);
  });

  it('keeps a valid scale for an empty viewport', () => {
    const { scene, root } = createScene();

    scene.resize({ width: 0, height: 0 });

    expect(Number.isFinite(root.scale.x)).toBe(true);
    expect(root.scale.x).toBeGreaterThan(0);
  });

  it('destroys its display objects and ignores calls afterwards', async () => {
    const { gameRoot, scene, root, lanes, chicken } = createScene();
    const laneViews = lanes();
    const chickenView = chicken();
    const step = scene.step(stepResult(1));

    scene.destroy();
    scene.destroy();
    await step;

    expect(chickenView.destroyed).toBe(true);
    expect(gsap.globalTimeline.getChildren()).toHaveLength(0);
    await expect(scene.step(stepResult(1))).resolves.toBeUndefined();
    await expect(scene.setChickenState('win')).resolves.toBeUndefined();

    expect(gameRoot.children).toHaveLength(0);
    expect(root.destroyed).toBe(true);
    expect(laneViews.every((lane) => lane.destroyed)).toBe(true);
    expect(() => {
      scene.setDifficulty('hard');
      scene.setProgress(1);
      scene.resize({ width: 800, height: 600 });
      scene.reset();
    }).not.toThrow();
  });
});

/** Canvas sizes the app gets at 390x844, 768x1024, 1024x768 and 1440x900 browser windows. */
const CANVAS = {
  390: { width: 364, height: 457 },
  768: { width: 734, height: 729 },
  1024: { width: 982, height: 505 },
  1440: { width: 1238, height: 637 },
} as const;

describe('GameScene camera', () => {
  // GSAP rounds tweened values to four decimals.
  const EPSILON = 1e-3;

  /** Visible part of the world, in world units. */
  function view(scene: GameScene) {
    return { left: scene.cameraX, right: scene.cameraX + scene.viewWidth };
  }

  function expectInsideWorld(scene: GameScene) {
    const { left, right } = view(scene);
    expect(left).toBeGreaterThanOrEqual(-EPSILON);
    expect(right).toBeLessThanOrEqual(scene.layout.width + EPSILON);
  }

  async function walk(scene: GameScene, to: number) {
    const step = scene.step(stepResult(to));
    finishAnimations();
    await step;
  }

  it('moves the world container and leaves the scaled root in place', async () => {
    const { scene, root, world, chicken } = createScene('easy', CANVAS[390]);

    await walk(scene, 1);
    await walk(scene, 2);

    expect(root.x).toBe(0);
    expect(world.x).toBe(-scene.cameraX);
    expect(scene.cameraX).toBeGreaterThan(0);
    expect(chicken().position).toMatchObject(scene.layout.lanes[1]?.anchor ?? {});
  });

  it.each(Object.entries(CANVAS))(
    'starts on the sidewalk with the first lanes in view at %spx',
    (_, viewport) => {
      const { scene } = createScene('easy', viewport);
      const { start, lanes } = scene.layout;

      expect(scene.cameraX).toBe(0);
      expect(view(scene).right).toBeGreaterThan(lanes[1]?.x ?? Infinity);
      expect(start.anchor.x).toBeLessThan(view(scene).right);
    },
  );

  it('keeps the current and the next two lanes in view at 390px', async () => {
    const { scene } = createScene('easy', CANVAS[390]);
    const { lanes } = scene.layout;
    let previous = scene.cameraX;

    for (let index = 1; index <= DIFFICULTIES.easy.steps; index++) {
      await walk(scene, index);
      const { left, right } = view(scene);
      const anchor = scene.stepAnchor(index).x;

      expect(scene.cameraX).toBeGreaterThanOrEqual(previous - EPSILON);
      expectInsideWorld(scene);
      // Until the camera reaches the end of the world, the chicken stays at a third of the view.
      if (right < scene.layout.width - EPSILON) {
        expect(anchor - left).toBeLessThanOrEqual(scene.viewWidth / 3 + EPSILON);
      }
      expect(lanes[index - 1]?.x ?? -1).toBeGreaterThanOrEqual(left);
      const ahead = lanes[Math.min(index + 1, lanes.length - 1)];
      expect((ahead?.x ?? Infinity) + (ahead?.width ?? 0)).toBeLessThanOrEqual(right);
      previous = scene.cameraX;
    }
    expect(view(scene).right).toBeCloseTo(scene.layout.width);
  });

  it('only pans once the chicken leaves the left third', async () => {
    const { scene, world } = createScene('easy', CANVAS[1440]);
    const third = scene.viewWidth / 3;
    const tweening = () => gsap.getTweensOf(world).length > 0;

    for (let index = 1; scene.stepAnchor(index).x <= third; index++) {
      const step = scene.step(stepResult(index));
      expect(tweening()).toBe(false);
      finishAnimations();
      await step;
      expect(scene.cameraX).toBe(0);
    }

    const next = scene.layout.lanes.findIndex((lane) => lane.anchor.x > third) + 1;
    const step = scene.step(stepResult(next));
    expect(tweening()).toBe(true);
    finishAnimations();
    await step;
    expect(scene.stepAnchor(next).x - scene.cameraX).toBeCloseTo(third);
  });

  it('waits for the pan before resolving a step', async () => {
    const { scene, world } = createScene('easy', CANVAS[390]);
    await walk(scene, 1);
    let done = false;
    const step = scene.step(stepResult(2)).then(() => {
      done = true;
    });

    // Finish only the chicken's hop; the pan is still on its way.
    for (const animation of gsap.globalTimeline.getChildren(false, true, true)) {
      if (!gsap.getTweensOf(world).includes(animation as gsap.core.Tween)) animation.progress(1);
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(false);

    finishAnimations();
    await step;
    expect(done).toBe(true);
  });

  it.each([768, 1024, 1440] as const)(
    'stays within the world through a whole crossing at %ipx',
    async (width) => {
      const { scene } = createScene('hardcore', CANVAS[width]);

      for (let index = 1; index <= DIFFICULTIES.hardcore.steps; index++) {
        await walk(scene, index);
        expectInsideWorld(scene);
        expect(scene.stepAnchor(index).x).toBeLessThan(view(scene).right);
      }
      expect(view(scene).right).toBeCloseTo(scene.layout.width);
    },
  );

  it('centres a world narrower than the view and keeps it still', async () => {
    const { scene } = createScene('hardcore', { width: 4000, height: 640 });
    const centred = (scene.layout.width - 4000) / 2;

    expect(scene.cameraX).toBe(centred);
    await walk(scene, DIFFICULTIES.hardcore.steps);
    expect(scene.cameraX).toBe(centred);
  });

  it('returns to the start on reset, even mid-pan', async () => {
    const { scene, world } = createScene('easy', CANVAS[390]);
    for (let index = 1; index <= 6; index++) await walk(scene, index);
    const step = scene.step(stepResult(7));
    gsap.getTweensOf(world)[0]?.progress(0.5);

    scene.reset();
    await step;

    expect(gsap.getTweensOf(world)).toHaveLength(0);
    expect(scene.cameraX).toBe(0);
    expect(world.x).toBe(0);
  });

  it('recalculates the bounds on difficulty changes and starts over', async () => {
    const { scene } = createScene('easy', CANVAS[390]);
    for (let index = 1; index <= DIFFICULTIES.easy.steps; index++) await walk(scene, index);
    const easyEnd = scene.cameraX;

    scene.setDifficulty('hardcore');
    expect(scene.cameraX).toBe(0);
    for (let index = 1; index <= DIFFICULTIES.hardcore.steps; index++) await walk(scene, index);
    const hardcoreEnd = scene.cameraX;
    expect(hardcoreEnd).toBeCloseTo(scene.layout.width - scene.viewWidth);
    expect(hardcoreEnd).toBeLessThan(easyEnd);

    scene.setDifficulty('easy');
    expect(scene.cameraX).toBe(0);
    await walk(scene, 1);
    expectInsideWorld(scene);
  });

  it.each([
    [CANVAS[390], CANVAS[1440]],
    [CANVAS[1440], CANVAS[390]],
  ])('keeps a valid view when resized from %o to %o', async (from, to) => {
    const { scene, world } = createScene('easy', from);
    for (let index = 1; index <= 10; index++) await walk(scene, index);
    const step = scene.step(stepResult(11));

    scene.resize(to);

    expect(gsap.getTweensOf(world)).toHaveLength(0);
    expectInsideWorld(scene);
    finishAnimations();
    await step;
    const anchor = scene.stepAnchor(11).x;
    expect(anchor - scene.cameraX).toBeCloseTo(scene.viewWidth / 3);

    scene.setProgress(DIFFICULTIES.easy.steps);
    scene.resize(from);
    expectInsideWorld(scene);
    expect(view(scene).right).toBeCloseTo(scene.layout.width);
  });

  it('stops the pan when destroyed', async () => {
    const { scene, world } = createScene('easy', CANVAS[390]);
    await walk(scene, 1);
    const step = scene.step(stepResult(2));
    expect(gsap.getTweensOf(world)).toHaveLength(1);

    scene.destroy();
    await step;

    expect(gsap.getTweensOf(world)).toHaveLength(0);
    expect(gsap.globalTimeline.getChildren()).toHaveLength(0);
  });
});

describe('GameScene traffic', () => {
  function trafficScene(difficulty: Difficulty = 'hardcore') {
    const ticker = new Ticker();
    ticker.autoStart = false;
    const gameRoot = new Container({ label: 'gameRoot' });
    const scene = new GameScene(gameRoot, {
      difficulty,
      viewport: { width: 1024, height: 768 },
      assets,
      ticker,
    });
    const world = gameRoot.getChildByLabel('world', true) as Container;
    const obstacles = () => world.getChildByLabel('obstacles') as Container;
    const slot = (index: number) => obstacles().getChildByLabel(`obstacles-${index}`) as Container;
    const cars = (index: number) =>
      slot(index).children.filter((child) => child.label === 'car' && child.visible);
    const barrier = (index: number) => slot(index).getChildByLabel('barrier') as Graphics;
    /** Cars covering the spot where the chicken stands on that lane. */
    const onChickenSpot = (index: number) => {
      const lane = scene.layout.lanes[index - 1];
      if (!lane) throw new RangeError(`No lane ${index}`);
      const path = lane.anchor.y - lane.y;
      return cars(index).filter(
        (car) => car.y + CAR_LENGTH / 2 > path - 71 && car.y - CAR_LENGTH / 2 < path + 6,
      );
    };
    let now = 0;
    const tick = (seconds: number) => {
      for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
        now += 1000 / 60;
        ticker.update(now);
      }
    };
    return { scene, ticker, world, obstacles, slot, cars, barrier, onChickenSpot, tick };
  }

  it('puts moving cars on every lane, driven by the ticker it is given', () => {
    const { scene, cars, tick } = trafficScene('medium');
    const lanes = scene.layout.lanes.map((lane) => lane.index);

    expect(lanes.every((index) => cars(index).length > 0)).toBe(true);
    const down = cars(1).at(-1) as Container;
    const downY = down.y;
    const up = cars(2).at(-1) as Container;
    const upY = up.y;
    tick(0.25);
    expect(down.y).toBeGreaterThan(downY);
    expect(up.y).toBeLessThan(upY);
  });

  it('keeps cars still without a ticker', () => {
    const { layer } = createScene('easy');
    const slot = layer('obstacles').getChildByLabel('obstacles-1') as Container;
    const car = slot.getChildByLabel('car') as Container;
    const y = car.y;

    finishAnimations();

    expect(car.y).toBe(y);
  });

  it('clips cars to the road so they never show over the scenery', () => {
    const { obstacles, scene } = trafficScene();
    const mask = obstacles().mask as Graphics;

    expect(mask).toBeInstanceOf(Graphics);
    expect(mask.parent).toBe(obstacles());
    const bounds = mask.getLocalBounds();
    expect(bounds.y).toBe(scene.layout.lanes[0]?.y);
    expect(bounds.x).toBe(scene.layout.lanes[0]?.x);
    expect(bounds.x + bounds.width).toBe(scene.layout.finish.x);
  });

  it('moves cars inside the world, so the camera carries them without extra offsets', async () => {
    const { scene, slot, world } = trafficScene('easy');
    const x = slot(3).x;

    for (let index = 1; index <= 6; index++) {
      const step = scene.step(stepResult(index));
      finishAnimations();
      await step;
    }

    expect(scene.cameraX).toBeGreaterThan(0);
    expect(world.x).toBe(-scene.cameraX);
    expect(slot(3).x).toBe(x);
    expect(slot(3).parent?.parent).toBe(world);
  });

  it('clears the lane before a safe landing and closes it behind a barrier', async () => {
    const { scene, barrier, onChickenSpot, tick } = trafficScene();
    scene.setProgress(2);

    const step = scene.step(stepResult(3));
    expect(barrier(3).visible).toBe(false);
    tick(0.42);
    finishAnimations();
    await step;

    expect(scene.chickenState).toBe('idle');
    expect(barrier(3).visible).toBe(true);
    expect(onChickenSpot(3)).toHaveLength(0);
    tick(10);
    expect([1, 2, 3].flatMap(onChickenSpot)).toHaveLength(0);
  });

  it('stages the crash on the lane the engine reported and nowhere else', async () => {
    const { scene, barrier, onChickenSpot, tick } = trafficScene();
    scene.setProgress(4);
    tick(1.3);

    const step = scene.step(stepResult(5, { survived: false, status: 'crashed', multiplier: 0 }));
    finishAnimations();
    await step;

    expect(scene.chickenState).toBe('dead');
    expect(onChickenSpot(5)).toHaveLength(1);
    expect(barrier(5).visible).toBe(false);
    expect([1, 2, 3, 4].flatMap(onChickenSpot)).toHaveLength(0);
    // The car that hit stays put while the rest of the road keeps moving.
    const striker = onChickenSpot(5)[0] as Container;
    const y = striker.y;
    tick(3);
    expect(striker.y).toBe(y);
    expect(onChickenSpot(5)).toEqual([striker]);
  });

  it('never stages a crash for a surviving or finishing step', async () => {
    const { scene, onChickenSpot, barrier, tick } = trafficScene();
    const steps = DIFFICULTIES.hardcore.steps;

    for (let index = 1; index <= steps; index++) {
      const last = index === steps;
      const step = scene.step(stepResult(index, last ? { status: 'finished', win: 10 } : {}));
      tick(0.42);
      finishAnimations();
      await step;
      expect(onChickenSpot(index)).toHaveLength(0);
      expect(barrier(index).visible).toBe(true);
    }

    expect(scene.chickenState).toBe('win');
    tick(5);
    expect(scene.layout.lanes.flatMap((lane) => onChickenSpot(lane.index))).toHaveLength(0);
  });

  it('leaves traffic alone on cash out and reopens the road for the next round', async () => {
    const { scene, barrier, tick } = trafficScene();
    for (let index = 1; index <= 3; index++) {
      const step = scene.step(stepResult(index));
      finishAnimations();
      await step;
    }

    await scene.cashOut();
    expect([1, 2, 3].every((index) => barrier(index).visible)).toBe(true);

    await scene.startRound({
      status: 'playing',
      difficulty: 'hardcore',
      bet: 1,
      stepIndex: 0,
      multiplier: 1,
      balance: 100,
    });
    tick(0.5);
    expect([1, 2, 3].some((index) => barrier(index).visible)).toBe(false);
  });

  it('refills the road the same way on reset after a crash', async () => {
    const { scene, cars, tick } = trafficScene();
    const snapshot = () => scene.layout.lanes.map((lane) => cars(lane.index).map((car) => car.y));
    const initial = snapshot();
    tick(2);
    const step = scene.step(stepResult(1, { survived: false, status: 'crashed' }));
    finishAnimations();
    await step;

    scene.reset();

    expect(snapshot()).toEqual(initial);
  });

  it('rebuilds traffic for a new difficulty without leaving old cars behind', () => {
    const { scene, obstacles } = trafficScene('easy');

    scene.setDifficulty('hardcore');

    const slots = obstacles().children.filter((child) => child.label.startsWith('obstacles-'));
    expect(slots).toHaveLength(DIFFICULTIES.hardcore.steps);
    expect(slots.every((slot) => slot.children.some((child) => child.label === 'car'))).toBe(true);
    expect(obstacles().children.filter((child) => child.label === 'car')).toHaveLength(0);
  });

  it('hides the lanes outside the view and shows them as the camera reaches them', async () => {
    const { scene, slot, world, tick } = trafficScene('easy');
    const part = (layer: string, label: string) =>
      (world.getChildByLabel(layer) as Container).getChildByLabel(label) as Container;
    const shown = () =>
      scene.layout.lanes
        .filter(({ index }) => {
          const visible = slot(index).visible;
          expect(part('lanes', `lane-${index}`).visible).toBe(visible);
          expect(part('badges', `badge-${index}`).visible).toBe(visible);
          return visible;
        })
        .map(({ index }) => index);
    const inView = () =>
      scene.layout.lanes
        .filter(({ x, width }) => x < scene.cameraX + scene.viewWidth && x + width > scene.cameraX)
        .map(({ index }) => index);

    tick(1 / 60);
    expect(shown()).toEqual(inView());
    expect(shown().length).toBeLessThan(scene.layout.lanes.length);

    for (let index = 1; index <= 12; index++) {
      const step = scene.step(stepResult(index));
      finishAnimations();
      await step;
    }
    tick(1 / 60);
    expect(scene.cameraX).toBeGreaterThan(0);
    expect(shown()).toEqual(inView());

    scene.setDifficulty('hardcore');
    tick(1 / 60);
    expect(shown()).toEqual(inView());

    // A resize changes how many lanes fit, with the camera left where it was.
    scene.resize({ width: 390, height: 844 });
    tick(1 / 60);
    const narrow = shown();
    expect(narrow).toEqual(inView());

    scene.resize({ width: 1440, height: 900 });
    tick(1 / 60);
    expect(shown()).toEqual(inView());
    expect(shown().length).toBeGreaterThan(narrow.length);
  });

  it('comes back to the same scene after every round, however it ended', async () => {
    const { scene, ticker, world, tick } = trafficScene('easy');
    const census = () => {
      let objects = 0;
      const visit = (node: Container) => {
        objects++;
        for (const child of node.children) visit(child);
      };
      visit(world);
      return {
        objects,
        listeners: ticker.count,
        tweens: gsap.globalTimeline.getChildren().length,
        effects: scene.activeEffects,
      };
    };
    const hop = async (result: StepResult) => {
      const step = scene.step(result);
      finishAnimations();
      await step;
      tick(1.5);
    };

    scene.reset();
    const settled = census();
    for (let round = 0; round < 25; round++) {
      for (let index = 1; index <= 3; index++) await hop(stepResult(index));
      if (round % 3 === 0) {
        await hop(stepResult(4, { survived: false, status: 'crashed' }));
      } else if (round % 3 === 1) {
        await scene.cashOut();
        finishAnimations();
        tick(1.5);
      } else {
        scene.setDifficulty('hardcore');
        const steps = DIFFICULTIES.hardcore.steps;
        for (let index = 1; index <= steps; index++) {
          await hop(stepResult(index, { status: index === steps ? 'finished' : 'playing' }));
        }
        scene.setDifficulty('easy');
      }
      scene.reset();
      expect(census()).toEqual(settled);
    }
  });

  it('stops listening to the ticker and destroys every car on destroy', async () => {
    const { scene, ticker, cars, tick } = trafficScene();
    // Traffic and the chicken's frame animation each listen to the ticker.
    expect(ticker.count).toBe(2);
    const views = [...cars(1), ...cars(2)];
    const step = scene.step(stepResult(1, { survived: false, status: 'crashed' }));

    scene.destroy();
    await step;

    expect(ticker.count).toBe(0);
    expect(views.every((view) => view.destroyed)).toBe(true);
    expect(gsap.globalTimeline.getChildren()).toHaveLength(0);
    expect(() => tick(1)).not.toThrow();
  });
});

describe('GameScene assets', () => {
  it('draws the chicken and cars from the loaded textures and leaves them alive on destroy', () => {
    const ticker = new Ticker();
    ticker.autoStart = false;
    const gameRoot = new Container();
    const scene = new GameScene(gameRoot, {
      difficulty: 'easy',
      viewport: { width: 1024, height: 768 },
      assets,
      ticker,
    });
    const world = gameRoot.getChildByLabel('world', true) as Container;
    const sprite = world.getChildByLabel('chickenSprite', true) as AnimatedSprite;
    const car = world.getChildByLabel('car', true) as Container;
    const paint = car.getChildByLabel('paint') as Sprite;
    const frame = sprite.currentFrame;

    ticker.update(1000);
    ticker.update(1400);

    expect(sprite.textures).toBe(assets.chicken.animations.idle);
    expect(sprite.currentFrame).not.toBe(frame);
    expect(assets.cars.map((model) => model.paint)).toContain(paint.texture);

    scene.destroy();

    expect(sprite.destroyed).toBe(true);
    expect(paint.destroyed).toBe(true);
    expect(assets.chicken.animations.idle.some((texture) => texture.destroyed)).toBe(false);
    expect(assets.cars.some((model) => model.paint.destroyed)).toBe(false);
  });
});

describe('GameScene effects', () => {
  function effectsScene(difficulty: Difficulty = 'easy') {
    const ticker = new Ticker();
    ticker.autoStart = false;
    const gameRoot = new Container({ label: 'gameRoot' });
    const events: string[] = [];
    const scene = new GameScene(gameRoot, {
      difficulty,
      viewport: { width: 1024, height: 768 },
      assets,
      ticker,
      onEffect: (kind, phase) => events.push(`${kind}:${phase}`),
    });
    const world = gameRoot.getChildByLabel('world', true) as Container;
    const layer = (name: string) => world.getChildByLabel(name) as Container;
    const badge = (index: number) =>
      layer('badges').getChildByLabel(`badge-${index}`)?.getChildByLabel('badgeGroup') as Container;
    let now = 0;
    const tick = (seconds: number) => {
      for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
        now += 1000 / 60;
        ticker.update(now);
      }
    };
    return { scene, ticker, world, layer, badge, events, tick };
  }

  /** Lets the hop reach touchdown without finishing the landing pose. */
  function toTouchdown() {
    for (const animation of gsap.globalTimeline.getChildren(false, true, true)) {
      if (animation.duration() > 0.4) animation.progress(0.42 / animation.duration());
    }
  }

  it('starts nothing before the outcome is played', () => {
    const { scene, events } = effectsScene();

    scene.setProgress(3);
    void scene.startRound({ ...stepResult(0), difficulty: 'easy', bet: 1 });

    expect(events).toEqual([]);
    expect(scene.activeEffects).toBe(0);
  });

  it('plays the landing at touchdown of a safe step, not when the hop starts', async () => {
    const { scene, events, tick } = effectsScene();

    const step = scene.step(stepResult(1));
    expect(events).toEqual([]);
    finishAnimations();
    await step;
    // Touchdown starts the badge settling; let that finish too.
    finishAnimations();

    expect(events).toEqual(['land:start']);
    tick(1);
    expect(events).toEqual(['land:start', 'land:end']);
    expect(scene.activeEffects).toBe(0);
  });

  it('plays the impact instead of the landing on a crash and jolts the world vertically', async () => {
    const { scene, world, events, tick } = effectsScene();

    const step = scene.step(stepResult(1, { survived: false, status: 'crashed' }));
    toTouchdown();
    expect(events).toEqual(['crash:start']);
    const jolt = gsap.getTweensOf(world).filter((tween) => 'y' in tween.vars);
    expect(jolt.length).toBeGreaterThan(0);
    // The camera owns x; the jolt never touches it.
    expect(jolt.every((tween) => !('x' in tween.vars))).toBe(true);
    jolt[0]?.progress(0.5);
    expect(world.y).toBeGreaterThan(0);
    expect(world.y).toBeLessThanOrEqual(3);

    finishAnimations();
    await step;
    expect(world.y).toBe(0);
    tick(2);
    expect(events).toEqual(['crash:start', 'crash:end']);
    expect(scene.chickenState).toBe('dead');
  });

  it('celebrates the finish around the chicken and the golden egg', async () => {
    const { scene, layer, events } = effectsScene('hardcore');
    const { steps } = DIFFICULTIES.hardcore;
    scene.setProgress(steps - 1);
    const egg = layer('foreground').getChildByLabel('goldenEgg') as Container;

    const step = scene.step(stepResult(steps, { status: 'finished' }));
    toTouchdown();

    expect(events).toEqual(['land:start', 'finish:start']);
    expect(gsap.getTweensOf(egg.scale).length).toBeGreaterThan(0);
    finishAnimations();
    await step;
    expect(egg.scale.x).toBe(1);
  });

  it('adds a sparkle on cash out without holding up the round', async () => {
    const { scene, badge, events } = effectsScene();
    scene.setProgress(2);
    const rest = badge(2).scale.x;

    await scene.cashOut();

    expect(events).toEqual(['cashout:start']);
    expect(gsap.getTweensOf(badge(2).scale).length).toBeGreaterThan(0);
    finishAnimations();
    expect(badge(2).scale.x).toBe(rest);
  });

  it('moves the current badge to a smaller plate at the chicken feet, clear of the chicken', async () => {
    const { scene, badge } = effectsScene();
    const anchor = scene.stepAnchor(1);
    const home = { x: badge(1).x, y: badge(1).y };
    const step = scene.step(stepResult(1));

    // Until touchdown the target badge stays where it is.
    expect([badge(1).x, badge(1).y, badge(1).scale.x]).toEqual([home.x, home.y, 1]);
    finishAnimations();
    await step;
    finishAnimations();

    expect(badge(1).x).toBe(home.x);
    expect(badge(1).y).toBeGreaterThan(home.y);
    expect(badge(1).scale.x).toBeLessThan(1);
    // The chicken stands where the lane says; only the badge moved.
    expect(scene.stepAnchor(1)).toEqual(anchor);

    const next = scene.step(stepResult(2));
    finishAnimations();
    await next;
    finishAnimations();
    expect([badge(1).x, badge(1).y, badge(1).scale.x]).toEqual([home.x, home.y, 1]);
  });

  it('places badges without animation when progress is set directly', () => {
    const { scene, badge } = effectsScene();
    const home = badge(4).y;

    scene.setProgress(4);

    expect(badge(4).y).toBeGreaterThan(home);
    expect(scene.activeEffects).toBe(0);
    scene.setProgress(0);
    expect(badge(4).y).toBe(home);
  });

  it('clears running effects on reset and on a new round', async () => {
    const { scene, world, layer, events } = effectsScene();
    const step = scene.step(stepResult(1, { survived: false, status: 'crashed' }));
    toTouchdown();
    expect(scene.activeEffects).toBeGreaterThan(0);

    scene.reset();
    await step;

    expect(scene.activeEffects).toBe(0);
    expect(world.y).toBe(0);
    expect(events).toEqual(['crash:start', 'crash:end']);
    expect(visibleEffects(layer)).toBe(0);
  });

  it('drops a landing that a reset cut short', async () => {
    const { scene, events } = effectsScene();
    const step = scene.step(stepResult(1));

    scene.reset();
    await step;
    finishAnimations();

    expect(events).toEqual([]);
  });

  it('clears effects when the difficulty changes', () => {
    const { scene, layer } = effectsScene();
    void scene.cashOut();

    scene.setDifficulty('hard');

    expect(scene.activeEffects).toBe(0);
    expect(visibleEffects(layer)).toBe(0);
  });

  it('removes the effects and their ticker work on destroy', async () => {
    const { scene, ticker, world } = effectsScene();
    const step = scene.step(stepResult(1, { survived: false, status: 'crashed' }));
    toTouchdown();

    scene.destroy();
    await step;

    expect(ticker.count).toBe(0);
    expect(world.destroyed).toBe(true);
    expect(gsap.globalTimeline.getChildren()).toHaveLength(0);
  });
});

describe('GameScene sound', () => {
  /** Effects and sounds go into one log, so the test sees which came with which. */
  function soundScene(difficulty: Difficulty = 'easy') {
    const ticker = new Ticker();
    ticker.autoStart = false;
    const gameRoot = new Container({ label: 'gameRoot' });
    const log: string[] = [];
    const scene = new GameScene(gameRoot, {
      difficulty,
      viewport: { width: 1024, height: 768 },
      assets,
      ticker,
      onEffect: (kind, phase) => {
        if (phase === 'start') log.push(kind);
      },
      sound: { play: (cue) => log.push(`sound:${cue}`) },
    });
    const sounds = () => log.filter((entry) => entry.startsWith('sound:'));
    return { scene, log, sounds };
  }

  function toTouchdown() {
    for (const animation of gsap.globalTimeline.getChildren(false, true, true)) {
      if (animation.duration() > 0.4) animation.progress(0.42 / animation.duration());
    }
  }

  it('plays one step sound at touchdown of a safe step, together with the landing', async () => {
    const { scene, log, sounds } = soundScene();

    const step = scene.step(stepResult(1));
    expect(sounds()).toEqual([]);
    toTouchdown();
    expect(log).toEqual(['land', 'sound:step']);
    finishAnimations();
    await step;
    finishAnimations();

    expect(sounds()).toEqual(['sound:step']);
  });

  it('plays one crash sound with the impact and no step sound', async () => {
    const { scene, log, sounds } = soundScene();

    const step = scene.step(stepResult(1, { survived: false, status: 'crashed' }));
    expect(sounds()).toEqual([]);
    toTouchdown();
    expect(log).toEqual(['crash', 'sound:crash']);
    finishAnimations();
    await step;

    expect(sounds()).toEqual(['sound:crash']);
  });

  it('plays the finish sound in place of the step sound on the last lane', async () => {
    const { scene, log, sounds } = soundScene('hardcore');
    const { steps } = DIFFICULTIES.hardcore;
    scene.setProgress(steps - 1);

    const step = scene.step(stepResult(steps, { status: 'finished' }));
    toTouchdown();
    finishAnimations();
    await step;

    expect(log).toEqual(['land', 'finish', 'sound:finish']);
    expect(sounds()).toEqual(['sound:finish']);
  });

  it('plays one cash-out sound with the cash-out sparkle', async () => {
    const { scene, log } = soundScene();
    scene.setProgress(2);

    await scene.cashOut();

    expect(log).toEqual(['cashout', 'sound:cashOut']);
  });

  it('stays silent when progress is set, on a new round, on reset and on a cut-short hop', async () => {
    const { scene, sounds } = soundScene();

    scene.setProgress(3);
    await scene.startRound({ ...stepResult(0), difficulty: 'easy', bet: 1 });
    const step = scene.step(stepResult(1));
    scene.reset();
    await step;
    finishAnimations();
    scene.setDifficulty('hard');

    expect(sounds()).toEqual([]);
  });

  it('plays one sound per step, never two', async () => {
    const { scene, sounds } = soundScene();

    for (let index = 1; index <= 3; index++) {
      const step = scene.step(stepResult(index));
      finishAnimations();
      await step;
      finishAnimations();
    }

    expect(sounds()).toEqual(['sound:step', 'sound:step', 'sound:step']);
  });
});
