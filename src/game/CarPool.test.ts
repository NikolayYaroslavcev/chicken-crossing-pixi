import { Container, type Sprite } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { Car } from './Car';
import { CarPool } from './CarPool';
import { createTestAssets } from './testAssets';

const models = createTestAssets().cars;

function activate(car: Car) {
  car.activate({
    lane: 1,
    x: 0,
    roadLength: 500,
    direction: 1,
    front: 0,
    speed: 100,
    color: 0xffffff,
    model: 0,
  });
}

describe('CarPool', () => {
  it('rejects an invalid capacity', () => {
    expect(() => new CarPool(0, models)).toThrow(RangeError);
    expect(() => new CarPool(2.5, models)).toThrow(RangeError);
  });

  it('creates cars on demand and never more than its capacity', () => {
    const pool = new CarPool(3, models);
    expect(pool.size).toBe(0);

    const cars = [pool.acquire(), pool.acquire(), pool.acquire()];

    expect(cars.every((car) => car !== null)).toBe(true);
    expect(new Set(cars).size).toBe(3);
    expect(pool.acquire()).toBeNull();
    expect(pool.size).toBe(3);
    expect(pool.activeCount).toBe(3);
  });

  it('hands a released car out again instead of creating one', () => {
    const pool = new CarPool(2, models);
    const first = pool.acquire() as Car;
    activate(first);

    pool.release(first);
    expect(first.active).toBe(false);
    expect(pool.activeCount).toBe(0);

    expect(pool.acquire()).toBe(first);
    expect(pool.size).toBe(1);
  });

  it('ignores releasing the same car twice or a car it does not own', () => {
    const pool = new CarPool(2, models);
    const other = new CarPool(1, models).acquire() as Car;
    const car = pool.acquire() as Car;

    pool.release(car);
    pool.release(car);
    pool.release(other);

    expect(pool.acquire()).toBe(car);
    expect(pool.acquire()).not.toBe(car);
    expect(pool.acquire()).toBeNull();
  });

  it('takes every car off the road on releaseAll and keeps them for reuse', () => {
    const pool = new CarPool(4, models);
    const parent = new Container();
    const cars = [pool.acquire(), pool.acquire(), pool.acquire()] as Car[];
    for (const car of cars) {
      activate(car);
      parent.addChild(car.view);
    }

    pool.releaseAll();

    expect(pool.activeCount).toBe(0);
    expect(pool.size).toBe(3);
    expect(parent.children).toHaveLength(0);
    expect(cars.every((car) => !car.active && !car.destroyed)).toBe(true);
    const again = [pool.acquire(), pool.acquire(), pool.acquire()];
    expect(new Set(again)).toEqual(new Set(cars));
    expect(pool.size).toBe(3);
  });

  it('destroys every car it created and hands out nothing afterwards', () => {
    const pool = new CarPool(3, models);
    const parent = new Container();
    const active = pool.acquire() as Car;
    const idle = pool.acquire() as Car;
    activate(active);
    parent.addChild(active.view);
    pool.release(idle);

    pool.destroy();
    pool.destroy();

    expect(pool.destroyed).toBe(true);
    expect(active.destroyed && idle.destroyed).toBe(true);
    expect(parent.children).toHaveLength(0);
    expect(pool.size).toBe(0);
    expect(pool.acquire()).toBeNull();
  });

  it('shares the loaded textures between its cars and leaves them alive on destroy', () => {
    const pool = new CarPool(2, models);
    const cars = [pool.acquire(), pool.acquire()] as Car[];
    for (const car of cars) activate(car);
    const paints = cars.map((car) => (car.view.getChildByLabel('paint') as Sprite).texture);

    pool.destroy();

    expect(paints[0]).toBe(models[0]?.paint);
    expect(paints[1]).toBe(paints[0]);
    expect(models.every((model) => !model.paint.destroyed && !model.base.destroyed)).toBe(true);
  });
});
