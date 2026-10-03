import { Container, type Sprite } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { Car, CAR_LENGTH, type CarSpawn } from './Car';
import { createTestAssets } from './testAssets';

const models = createTestAssets().cars;

function spawn(overrides: Partial<CarSpawn> = {}): CarSpawn {
  return {
    lane: 2,
    x: 56,
    roadLength: 500,
    direction: 1,
    front: 0,
    speed: 200,
    color: 0x3d8bfd,
    model: 0,
    ...overrides,
  };
}

describe('Car', () => {
  it('starts inactive and hidden', () => {
    const car = new Car(models);

    expect(car.active).toBe(false);
    expect(car.view.visible).toBe(false);
    expect(car.view.label).toBe('car');
  });

  it('takes its lane, position, speed and colour on activation', () => {
    const car = new Car(models);
    car.activate(spawn({ lane: 3, front: 120, speed: 180, color: 0xe5483b }));

    expect(car.active).toBe(true);
    expect(car.view.visible).toBe(true);
    expect(car.lane).toBe(3);
    expect(car.front).toBe(120);
    expect(car.rear).toBe(120 - CAR_LENGTH);
    expect(car.speed).toBe(180);
    expect(car.cruiseSpeed).toBe(180);
    expect(car.color).toBe(0xe5483b);
    expect(car.view.x).toBe(56);
  });

  it('moves down the lane at its speed when driving down', () => {
    const car = new Car(models);
    car.activate(spawn({ direction: 1, front: 100, speed: 200 }));
    const y = car.view.y;

    car.advance(0.5);

    expect(car.front).toBe(200);
    expect(car.view.y).toBe(y + 100);
    expect(car.view.scale.y).toBe(1);
  });

  it('moves up the lane and faces up when driving up', () => {
    const car = new Car(models);
    car.activate(spawn({ direction: -1, front: 100, speed: 200 }));
    const y = car.view.y;

    car.advance(0.5);

    expect(car.front).toBe(200);
    expect(car.view.y).toBe(y - 100);
    expect(car.view.scale.y).toBe(-1);
  });

  it('measures both directions from the edge the car entered at', () => {
    const down = new Car(models);
    const up = new Car(models);
    down.activate(spawn({ direction: 1, front: 0 }));
    up.activate(spawn({ direction: -1, front: 0 }));

    // Front bumper exactly on the road edge, body still outside it.
    expect(down.view.y + CAR_LENGTH / 2).toBe(0);
    expect(up.view.y - CAR_LENGTH / 2).toBe(500);
  });

  it('does not move while inactive or for non-positive time', () => {
    const car = new Car(models);
    car.advance(1);
    expect(car.front).toBe(0);

    car.activate(spawn({ front: 50 }));
    car.advance(0);
    car.advance(-1);
    expect(car.front).toBe(50);
  });

  it('deactivates by hiding, leaving its parent and resetting script state', () => {
    const parent = new Container();
    const car = new Car(models);
    car.activate(spawn());
    car.scripted = true;
    parent.addChild(car.view);

    car.deactivate();

    expect(car.active).toBe(false);
    expect(car.scripted).toBe(false);
    expect(car.speed).toBe(0);
    expect(car.view.visible).toBe(false);
    expect(car.view.parent).toBeNull();
  });

  it('can be activated again with new values after deactivation', () => {
    const car = new Car(models);
    car.activate(spawn({ lane: 1, direction: 1, speed: 150 }));
    car.deactivate();

    car.activate(spawn({ lane: 4, direction: -1, speed: 300, front: 10 }));

    expect(car.active).toBe(true);
    expect(car.lane).toBe(4);
    expect(car.direction).toBe(-1);
    expect(car.speed).toBe(300);
    expect(car.front).toBe(10);
  });

  it('shows the requested model from the shared textures, wrapping past the last one', () => {
    const car = new Car(models);
    const sprite = (label: string) => car.view.getChildByLabel(label) as Sprite;

    car.activate(spawn({ model: 1 }));
    expect(sprite('base').texture).toBe(models[1]?.base);
    expect(sprite('paint').texture).toBe(models[1]?.paint);
    expect(sprite('details').texture).toBe(models[1]?.details);

    car.deactivate();
    car.activate(spawn({ model: models.length + 2 }));
    expect(sprite('paint').texture).toBe(models[2]?.paint);
    expect(sprite('paint').tint).toBe(0x3d8bfd);
  });

  it('keeps every layer centred so flipping it keeps the car on its spot', () => {
    const car = new Car(models);
    car.activate(spawn({ direction: -1 }));

    for (const layer of car.view.children as Sprite[]) {
      expect(layer.anchor.x).toBe(0.5);
      expect(layer.anchor.y).toBe(0.5);
    }
  });

  it('needs at least one model', () => {
    expect(() => new Car([])).toThrow(RangeError);
  });

  it('destroys its display objects but not the shared textures', () => {
    const shared = createTestAssets().cars;
    const car = new Car(shared);
    car.activate(spawn());

    car.destroy();
    car.destroy();
    car.activate(spawn());

    expect(car.destroyed).toBe(true);
    expect(car.active).toBe(false);
    expect(car.view.destroyed).toBe(true);
    for (const model of shared) {
      expect(model.base.destroyed).toBe(false);
      expect(model.paint.destroyed).toBe(false);
      expect(model.details.destroyed).toBe(false);
    }
  });
});
