import { gsap } from 'gsap';
import { Container } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effects, MAX_PARTICLES, MAX_RINGS, type EffectKind } from './Effects';

const AT = { x: 300, y: 413 };
const EGG = { x: 600, y: 413 };

function setup(options: ConstructorParameters<typeof Effects>[2] = {}) {
  const ground = new Container({ label: 'chicken' });
  ground.addChild(new Container({ label: 'chicken-sprite' }));
  const air = new Container({ label: 'effectsLayer' });
  const onEffect = vi.fn<(kind: EffectKind, phase: 'start' | 'end') => void>();
  const effects = new Effects(ground, air, { onEffect, ...options });
  const below = ground.getChildByLabel('effectsBelow') as Container;
  const above = air.getChildByLabel('effects') as Container;
  const visible = () =>
    [...below.children, ...above.children].filter((piece) => piece.visible).length;
  /** Runs the effects for `seconds` in 60 fps frames. */
  const run = (seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += 1 / 60) effects.update(1 / 60);
  };
  return { ground, air, below, above, effects, onEffect, visible, run };
}

function finishTweens() {
  for (const animation of gsap.globalTimeline.getChildren(false, true, true)) {
    animation.progress(1);
  }
}

afterEach(() => {
  gsap.globalTimeline.clear();
});

describe('Effects', () => {
  it('creates every piece up front, hidden, under and over the chicken', () => {
    const { ground, below, above, visible } = setup();

    expect(ground.children[0]).toBe(below);
    expect(below.children).toHaveLength(MAX_RINGS);
    expect(above.children).toHaveLength(MAX_PARTICLES);
    expect(visible()).toBe(0);
  });

  it.each([
    ['land', (effects: Effects) => effects.land(AT)],
    ['crash', (effects: Effects) => effects.crash(AT)],
    ['cashout', (effects: Effects) => effects.cashOut(AT)],
    ['finish', (effects: Effects) => effects.finish(AT, EGG)],
  ] as const)('plays %s and cleans up after itself', (kind, play) => {
    const { effects, onEffect, visible, run } = setup();

    play(effects);
    expect(onEffect).toHaveBeenCalledExactlyOnceWith(kind, 'start');
    expect(effects.isPlaying(kind)).toBe(true);
    expect(effects.activeCount).toBeGreaterThan(0);

    run(0.25);
    expect(visible()).toBeGreaterThan(0);

    run(2);
    expect(effects.activeCount).toBe(0);
    expect(visible()).toBe(0);
    expect(effects.isPlaying(kind)).toBe(false);
    expect(onEffect).toHaveBeenLastCalledWith(kind, 'end');
    expect(onEffect).toHaveBeenCalledTimes(2);
  });

  it('keeps every effect short', () => {
    const { effects, run } = setup();

    effects.finish(AT, EGG);
    effects.crash(AT);
    run(1.6);

    expect(effects.activeCount).toBe(0);
  });

  it('keeps the finish bigger than a cash out', () => {
    const cashOut = setup();
    const finish = setup();

    cashOut.effects.cashOut(AT);
    finish.effects.finish(AT, EGG);

    expect(finish.effects.activeCount).toBeGreaterThan(cashOut.effects.activeCount * 2);
  });

  it('never holds more pieces than the pool, however many bursts start', () => {
    const { effects, below, above, run } = setup();

    for (let i = 0; i < 40; i++) {
      effects.finish(AT, EGG);
      effects.crash(AT);
    }

    expect(effects.activeCount).toBe(MAX_PARTICLES + MAX_RINGS);
    expect(below.children).toHaveLength(MAX_RINGS);
    expect(above.children).toHaveLength(MAX_PARTICLES);
    run(2);
    expect(effects.activeCount).toBe(0);
  });

  it('reports one start and one end for overlapping bursts of a kind', () => {
    const { effects, onEffect, run } = setup();

    effects.land(AT);
    run(0.1);
    effects.land({ x: AT.x + 112, y: AT.y });
    run(2);

    expect(onEffect.mock.calls).toEqual([
      ['land', 'start'],
      ['land', 'end'],
    ]);
  });

  it('plays the same way every time', () => {
    const positions = () => {
      const { effects, above, run } = setup();
      effects.crash(AT);
      run(0.2);
      return above.children.filter((piece) => piece.visible).map(({ x, y }) => [x, y]);
    };

    expect(positions()).toEqual(positions());
  });

  it('plays fewer pieces and no jolt with reduced motion', () => {
    const full = setup();
    const reduced = setup({ reducedMotion: true });
    const world = new Container();

    full.effects.crash(AT, world);
    reduced.effects.crash(AT, world);

    expect(reduced.effects.activeCount).toBeLessThan(full.effects.activeCount);
    expect(full.effects.tweenCount).toBe(1);
    expect(reduced.effects.tweenCount).toBe(0);
  });

  it('follows a change of the motion preference from the next effect on', () => {
    const { effects } = setup();
    const world = new Container();

    effects.setReducedMotion(true);
    effects.crash(AT, world);
    expect(effects.tweenCount).toBe(0);

    effects.clear();
    effects.setReducedMotion(false);
    effects.crash(AT, world);
    expect(effects.tweenCount).toBe(1);
  });

  describe('crash jolt', () => {
    it('moves the target down a little and brings it back to rest', () => {
      const { effects } = setup();
      const world = new Container();

      effects.crash(AT, world);
      gsap.globalTimeline.getChildren(false, false, true)[0]?.progress(0.2);
      expect(world.y).toBeGreaterThan(0);
      expect(world.y).toBeLessThanOrEqual(3);
      expect(world.x).toBe(0);

      finishTweens();
      expect(world.y).toBe(0);
      expect(effects.tweenCount).toBe(0);
    });

    it('restarts from rest when a second crash cuts in', () => {
      const { effects } = setup();
      const world = new Container();

      effects.crash(AT, world);
      gsap.globalTimeline.getChildren(false, false, true)[0]?.progress(0.3);
      effects.crash(AT, world);

      expect(world.y).toBe(0);
      expect(effects.tweenCount).toBe(1);
      finishTweens();
      expect(world.y).toBe(0);
      expect(effects.tweenCount).toBe(0);
    });
  });

  describe('tweens', () => {
    it('pops a target and leaves it at its rest scale', () => {
      const { effects } = setup();
      const badge = new Container();
      badge.scale.set(0.8);

      effects.pop(badge, 0.8, 1);
      gsap.globalTimeline.getChildren(false, false, true)[0]?.progress(0.4);
      expect(badge.scale.x).toBeGreaterThan(0.8);

      finishTweens();
      expect(badge.scale.x).toBe(0.8);
      expect(effects.tweenCount).toBe(0);
    });

    it('settles a target at its new place', () => {
      const { effects } = setup();
      const badge = new Container();

      effects.settle(badge, 10, 20, 0.8);
      finishTweens();

      expect([badge.x, badge.y, badge.scale.x]).toEqual([10, 20, 0.8]);
      expect(effects.tweenCount).toBe(0);
    });

    it('keeps one tween per target, finishing the one it replaces', () => {
      const { effects } = setup();
      const badge = new Container();

      effects.settle(badge, 10, 20, 0.8);
      effects.pop(badge, 0.8, 1);

      expect(effects.tweenCount).toBe(1);
      expect([badge.x, badge.y]).toEqual([10, 20]);
    });
  });

  describe('clear', () => {
    it('removes every piece and ends every tween at its rest state', () => {
      const { effects, onEffect, visible, run } = setup();
      const world = new Container();
      const badge = new Container();
      effects.finish(AT, EGG);
      effects.crash(AT, world);
      effects.settle(badge, 10, 20, 0.8);
      run(0.1);
      gsap.globalTimeline.getChildren(false, false, true)[0]?.progress(0.2);

      effects.clear();

      expect(effects.activeCount).toBe(0);
      expect(effects.tweenCount).toBe(0);
      expect(visible()).toBe(0);
      expect(world.y).toBe(0);
      expect([badge.x, badge.y, badge.scale.x]).toEqual([10, 20, 0.8]);
      expect(gsap.getTweensOf([world, badge.position, badge.scale])).toHaveLength(0);
      expect(onEffect).toHaveBeenCalledWith('finish', 'end');
      expect(onEffect).toHaveBeenCalledWith('crash', 'end');
    });

    it('leaves the pool ready for the next effect', () => {
      const { effects, run } = setup();
      effects.finish(AT, EGG);
      effects.clear();

      effects.land(AT);
      run(0.1);

      expect(effects.isPlaying('land')).toBe(true);
    });
  });

  describe('destroy', () => {
    it('removes the pieces, stops the tweens and ignores later calls', () => {
      const { effects, ground, air, onEffect } = setup();
      const world = new Container();
      effects.crash(AT, world);

      effects.destroy();

      expect(ground.getChildByLabel('effectsBelow')).toBeNull();
      expect(air.children).toHaveLength(0);
      expect(effects.tweenCount).toBe(0);
      expect(gsap.getTweensOf(world)).toHaveLength(0);
      expect(world.y).toBe(0);

      onEffect.mockClear();
      effects.land(AT);
      effects.pop(world, 1, 1.2);
      effects.update(0.1);
      effects.clear();
      effects.destroy();
      expect(onEffect).not.toHaveBeenCalled();
      expect(effects.activeCount).toBe(0);
      expect(gsap.globalTimeline.getChildren()).toHaveLength(0);
    });
  });
});
