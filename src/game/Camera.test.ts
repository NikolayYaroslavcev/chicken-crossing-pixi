import { gsap } from 'gsap';
import { Container } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import { Camera, cameraBounds, cameraTarget, FOLLOW_FRACTION } from './Camera';

function finishAnimations() {
  for (const animation of gsap.globalTimeline.getChildren(false, true, true)) {
    animation.progress(1);
  }
}

function createCamera(worldWidth = 3000, viewWidth = 600) {
  const world = new Container();
  const camera = new Camera(world);
  camera.resize(worldWidth, viewWidth);
  return { world, camera };
}

afterEach(() => {
  gsap.globalTimeline.clear();
});

describe('cameraBounds', () => {
  it('keeps the view inside a world wider than it', () => {
    expect(cameraBounds(3000, 600)).toEqual({ min: 0, max: 2400 });
  });

  it('centres a world narrower than the view without scrolling', () => {
    expect(cameraBounds(400, 600)).toEqual({ min: -100, max: -100 });
    expect(cameraBounds(600, 600)).toEqual({ min: 0, max: 0 });
  });
});

describe('cameraTarget', () => {
  it('puts the followed point at a third of the view', () => {
    expect(cameraTarget(1000, 3000, 600)).toBe(1000 - 600 * FOLLOW_FRACTION);
  });

  it('stays at the start while the point is in the left third', () => {
    expect(cameraTarget(0, 3000, 600)).toBe(0);
    expect(cameraTarget(200, 3000, 600)).toBe(0);
  });

  it('stops at the end of the world', () => {
    expect(cameraTarget(2990, 3000, 600)).toBe(2400);
  });

  it('never moves a narrow world', () => {
    expect(cameraTarget(0, 400, 600)).toBe(-100);
    expect(cameraTarget(390, 400, 600)).toBe(-100);
  });
});

describe('Camera', () => {
  it('moves the world, not the view, and reports the visible left edge', () => {
    const { world, camera } = createCamera();

    camera.lookAt(1000);

    expect(world.x).toBe(-800);
    expect(camera.x).toBe(800);
    expect(gsap.getTweensOf(world)).toHaveLength(0);
  });

  it('pans to the followed point and resolves when the pan ends', async () => {
    const { world, camera } = createCamera();
    let done = false;
    const pan = camera.follow(1000).then(() => {
      done = true;
    });

    await Promise.resolve();
    expect(done).toBe(false);
    expect(gsap.getTweensOf(world)).toHaveLength(1);

    finishAnimations();
    await pan;
    expect(camera.x).toBe(800);
    expect(gsap.getTweensOf(world)).toHaveLength(0);
  });

  it('does not tween when the view is already in place', async () => {
    const { world, camera } = createCamera();

    await camera.follow(150);

    expect(camera.x).toBe(0);
    expect(gsap.getTweensOf(world)).toHaveLength(0);
  });

  it('replaces a running pan instead of stacking tweens', async () => {
    const { world, camera } = createCamera();
    const first = camera.follow(1000);
    gsap.getTweensOf(world)[0]?.progress(0.5);

    const second = camera.follow(1500);
    await first;

    expect(camera.x).toBe(800);
    expect(gsap.getTweensOf(world)).toHaveLength(1);
    finishAnimations();
    await second;
    expect(camera.x).toBe(1300);
  });

  it('snaps into the new bounds on resize, ending a running pan', async () => {
    const { world, camera } = createCamera();
    const pan = camera.follow(2900);

    camera.resize(3000, 1800);
    await pan;

    expect(gsap.getTweensOf(world)).toHaveLength(0);
    expect(camera.x).toBe(1200);
    expect(camera.bounds).toEqual({ min: 0, max: 1200 });

    camera.resize(1000, 1800);
    expect(camera.x).toBe(-400);
  });

  it('leaves no tween behind once destroyed', async () => {
    const { world, camera } = createCamera();
    const pan = camera.follow(1000);

    camera.destroy();
    await pan;

    expect(gsap.getTweensOf(world)).toHaveLength(0);
    expect(gsap.globalTimeline.getChildren()).toHaveLength(0);
  });
});
