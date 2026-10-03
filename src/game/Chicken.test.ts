import { gsap } from 'gsap';
import { type AnimatedSprite, Container, type Sprite, Ticker } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import { Chicken, type ChickenState } from './Chicken';
import { CHICKEN_ANCHOR, createTestAssets } from './testAssets';

const textures = createTestAssets().chicken;
const { animations } = textures;

const START = { lane: 0, at: { x: 84, y: 413 } };
const LANE_1 = { lane: 1, at: { x: 224, y: 413 } };
const LANE_2 = { lane: 2, at: { x: 336, y: 413 } };

/** Jumps every running animation to its end, firing completion callbacks synchronously. */
function finishAnimations() {
  for (const animation of gsap.globalTimeline.getChildren(false, true, true)) {
    animation.progress(1);
  }
}

function createChicken(ticker?: Ticker) {
  const parent = new Container();
  const chicken = new Chicken(parent, START, { textures, ticker });
  const root = parent.getChildByLabel('chicken') as Container;
  const body = root.getChildByLabel('chickenBody') as Container;
  const sprite = body.getChildByLabel('chickenSprite') as AnimatedSprite;
  const shadow = root.getChildByLabel('shadow') as Sprite;
  const tweening = () => gsap.getTweensOf([root, body, body.scale]).length > 0;
  return { parent, chicken, root, body, sprite, shadow, tweening };
}

/** A ticker that only moves when told to, one 60 fps frame at a time. */
function manualTicker() {
  const ticker = new Ticker();
  ticker.autoStart = false;
  let now = 0;
  const advance = (seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
      now += 1000 / 60;
      ticker.update(now);
    }
  };
  return { ticker, advance };
}

/** Records the state after each settled promise so transitions can be asserted in order. */
async function track(chicken: Chicken, run: () => Promise<void>) {
  const seen: ChickenState[] = [chicken.state];
  const done = run();
  seen.push(chicken.state);
  finishAnimations();
  await done;
  seen.push(chicken.state);
  return seen;
}

afterEach(() => {
  gsap.globalTimeline.clear();
});

describe('Chicken', () => {
  it('starts idle on the given lane and position', () => {
    const { parent, chicken, root, sprite, shadow, tweening } = createChicken();

    expect(parent.children).toEqual([root]);
    expect(chicken.state).toBe('idle');
    expect(chicken.lane).toBe(0);
    expect(root.position).toMatchObject(START.at);
    expect(tweening()).toBe(false);
    expect(sprite.textures).toBe(animations.idle);
    expect(sprite.playing).toBe(true);
    expect(shadow.texture).toBe(textures.shadow);
  });

  it('stands on the ground point the atlas gives its frames', () => {
    const { root, body, sprite } = createChicken();

    expect(sprite.anchor.x).toBe(CHICKEN_ANCHOR.x);
    expect(sprite.anchor.y).toBe(CHICKEN_ANCHOR.y);
    expect(sprite.position).toMatchObject({ x: 0, y: 0 });
    expect(body.position).toMatchObject({ x: 0, y: 0 });
    expect(root.position).toMatchObject(START.at);
  });

  it('flips frames only when its ticker runs, looping idle', () => {
    const { ticker, advance } = manualTicker();
    const still = createChicken();
    const { sprite } = createChicken(ticker);
    const frameTime = 1 / 5;

    advance(frameTime * 1.5);
    expect(sprite.currentFrame).toBe(1);
    expect(still.sprite.currentFrame).toBe(0);

    advance(frameTime * animations.idle.length);
    expect(sprite.currentFrame).toBe(1);
    expect(sprite.playing).toBe(true);
  });

  it('hops lane by lane and resolves only after landing', async () => {
    const { chicken, root, body } = createChicken();
    let settled = false;

    const first = chicken.moveToLane(LANE_1).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(chicken.state).toBe('jump');
    expect(chicken.lane).toBe(0);

    finishAnimations();
    await first;
    expect(settled).toBe(true);
    expect(chicken.lane).toBe(1);
    expect(root.position).toMatchObject(LANE_1.at);
    expect(body.position.y).toBe(0);

    const second = chicken.moveToLane(LANE_2);
    finishAnimations();
    await second;
    expect(chicken.lane).toBe(2);
    expect(root.position).toMatchObject(LANE_2.at);
  });

  it('leaves the ground on an arc while jumping', () => {
    const { chicken, root, body } = createChicken();

    void chicken.moveToLane(LANE_1);
    gsap.globalTimeline.getChildren(false, false, true)[0]?.progress(0.25);

    expect(body.position.y).toBeLessThan(0);
    expect(root.position.x).toBeGreaterThan(START.at.x);
    expect(root.position.x).toBeLessThan(LANE_1.at.x);
  });

  it.each([
    ['idle', ['idle', 'jump', 'idle']],
    ['dead', ['idle', 'jump', 'dead']],
    ['win', ['idle', 'jump', 'win']],
  ] as const)('goes idle → jump → %s', async (rest, expected) => {
    const { chicken } = createChicken();

    expect(await track(chicken, () => chicken.moveToLane(LANE_1, rest))).toEqual(expected);
  });

  it.each(['idle', 'dead', 'win'] as const)(
    'plays the jump frames while hopping and the %s frames after landing',
    async (rest) => {
      const { chicken, sprite } = createChicken();

      const hop = chicken.moveToLane(LANE_1, rest);
      expect(sprite.textures).toBe(animations.jump);
      expect(sprite.loop).toBe(true);

      finishAnimations();
      await hop;
      expect(sprite.textures).toBe(animations[rest]);
    },
  );

  it('plays the fall once and waits for its last frame before resolving', async () => {
    const { ticker, advance } = manualTicker();
    const { chicken, sprite } = createChicken(ticker);
    let settled = false;

    const dead = chicken.setState('dead').then(() => {
      settled = true;
    });
    gsap.globalTimeline.getChildren(false, false, true)[0]?.progress(0.5);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(sprite.textures).toBe(animations.dead);
    expect(sprite.loop).toBe(false);

    advance(2);
    expect(sprite.currentFrame).toBe(animations.dead.length - 1);
    expect(sprite.playing).toBe(false);

    finishAnimations();
    await dead;
    expect(chicken.state).toBe('dead');
    expect(sprite.currentFrame).toBe(animations.dead.length - 1);
  });

  it('lands on the last fall frame even without a ticker', async () => {
    const { chicken, sprite } = createChicken();

    const dead = chicken.setState('dead');
    finishAnimations();
    await dead;

    expect(sprite.textures).toBe(animations.dead);
    expect(sprite.currentFrame).toBe(animations.dead.length - 1);
  });

  it('celebrates with looping win frames and a bounce', async () => {
    const { chicken, body, sprite } = createChicken();

    const win = chicken.setState('win');
    gsap.globalTimeline.getChildren(false, false, true)[0]?.progress(0.3);
    expect(body.position.y).toBeLessThan(0);

    finishAnimations();
    await win;
    expect(chicken.state).toBe('win');
    expect(sprite.textures).toBe(animations.win);
    expect(sprite.loop).toBe(true);
    expect(body.position.y).toBe(0);
  });

  it('replaces a running hop instead of stacking tweens', async () => {
    const { chicken, root } = createChicken();

    const first = chicken.moveToLane(LANE_1);
    gsap.globalTimeline.getChildren(false, false, true)[0]?.progress(0.5);
    const second = chicken.moveToLane(LANE_2);

    await first;
    expect(chicken.lane).toBe(1);
    expect(gsap.globalTimeline.getChildren(false, false, true)).toHaveLength(1);

    finishAnimations();
    await second;
    expect(chicken.lane).toBe(2);
    expect(root.position).toMatchObject(LANE_2.at);
  });

  it('snaps back to the start, idle, when placed mid-hop', async () => {
    const { chicken, root, body, sprite, tweening } = createChicken();
    const hop = chicken.moveToLane(LANE_1, 'dead');
    gsap.globalTimeline.getChildren(false, false, true)[0]?.progress(0.5);

    chicken.placeAt(START);
    await hop;

    expect(tweening()).toBe(false);
    expect(chicken.state).toBe('idle');
    expect(chicken.lane).toBe(0);
    expect(root.position).toMatchObject(START.at);
    expect(body.position.y).toBe(0);
    expect(body.rotation).toBe(0);
    expect(body.scale.x).toBe(1);
    expect(sprite.textures).toBe(animations.idle);
    expect(sprite.currentFrame).toBe(0);
  });

  it('switches to the new pose when a hop is cut short by another command', async () => {
    const { chicken, sprite } = createChicken();
    const hop = chicken.moveToLane(LANE_1, 'win');
    gsap.globalTimeline.getChildren(false, false, true)[0]?.progress(0.5);

    const dead = chicken.setState('dead');
    await hop;
    expect(chicken.lane).toBe(1);
    expect(sprite.textures).toBe(animations.dead);

    finishAnimations();
    await dead;
    expect(chicken.state).toBe('dead');
  });

  it('kills its tweens, settles a pending hop and frees display objects on destroy', async () => {
    const { ticker } = manualTicker();
    const listeners = ticker.count;
    const { parent, chicken, root, body, sprite, tweening } = createChicken(ticker);
    expect(ticker.count).toBe(listeners + 1);
    const hop = chicken.moveToLane(LANE_1);
    expect(tweening()).toBe(true);

    chicken.destroy();
    chicken.destroy();
    await hop;

    expect(tweening()).toBe(false);
    expect(gsap.globalTimeline.getChildren()).toHaveLength(0);
    expect(root.destroyed).toBe(true);
    expect(body.destroyed).toBe(true);
    expect(sprite.destroyed).toBe(true);
    expect(ticker.count).toBe(listeners);
    expect(parent.children).toHaveLength(0);
    // The frames belong to the shared atlas and outlive the chicken.
    expect(
      Object.values(animations)
        .flat()
        .some((texture) => texture.destroyed),
    ).toBe(false);
    expect(textures.shadow.destroyed).toBe(false);
    await expect(chicken.moveToLane(LANE_2)).resolves.toBeUndefined();
    await expect(chicken.setState('win')).resolves.toBeUndefined();
    expect(() => chicken.placeAt(START)).not.toThrow();
    expect(tweening()).toBe(false);
  });
});
