import { Container, Sprite } from 'pixi.js';
import type { CarTextures } from './assets';

export const CAR_LENGTH = 92;
export const CAR_WIDTH = 54;

/** +1 drives down the lane, -1 drives up it. */
export type CarDirection = 1 | -1;

export interface CarSpawn {
  lane: number;
  x: number;
  /** Length of the road the car drives along; distances are measured from where it enters. */
  roadLength: number;
  direction: CarDirection;
  /** Distance of the front bumper from the edge it entered at. */
  front: number;
  speed: number;
  color: number;
  /** Which of the car models to show; wraps around the available ones. */
  model: number;
}

/**
 * One vehicle seen from above. It knows where it is on its lane and how fast it goes; when to
 * move, brake or leave is decided by whoever drives it. Positions are kept as the distance the
 * front bumper has travelled along the lane, so both directions share the same arithmetic.
 */
export class Car {
  readonly view = new Container({ label: 'car' });
  private readonly base = new Sprite({ label: 'base', anchor: 0.5 });
  private readonly paint = new Sprite({ label: 'paint', anchor: 0.5 });
  private readonly details = new Sprite({ label: 'details', anchor: 0.5 });

  /** Speed it settles back to, in world units per second. */
  cruiseSpeed = 0;
  speed = 0;
  /** Driven by a scripted animation rather than by traffic rules. */
  scripted = false;

  private currentLane = 0;
  private currentDirection: CarDirection = 1;
  private roadLength = 0;
  private frontDistance = 0;
  private isActive = false;
  private isDestroyed = false;

  /** `models` are shared with every other car; the car only borrows them. */
  constructor(private readonly models: readonly CarTextures[]) {
    if (models.length === 0) throw new RangeError('A car needs at least one model');
    this.view.addChild(this.base, this.paint, this.details);
    this.view.visible = false;
  }

  get active(): boolean {
    return this.isActive;
  }

  get destroyed(): boolean {
    return this.isDestroyed;
  }

  get lane(): number {
    return this.currentLane;
  }

  get direction(): CarDirection {
    return this.currentDirection;
  }

  get color(): number {
    return this.paint.tint;
  }

  get front(): number {
    return this.frontDistance;
  }

  set front(value: number) {
    this.frontDistance = value;
    this.view.y =
      this.currentDirection === 1
        ? value - CAR_LENGTH / 2
        : this.roadLength - value + CAR_LENGTH / 2;
  }

  get rear(): number {
    return this.frontDistance - CAR_LENGTH;
  }

  activate({ lane, x, roadLength, direction, front, speed, color, model }: CarSpawn): void {
    if (this.isDestroyed) return;
    const textures = this.models[model % this.models.length] as CarTextures;
    this.base.texture = textures.base;
    this.paint.texture = textures.paint;
    this.details.texture = textures.details;
    this.currentLane = lane;
    this.currentDirection = direction;
    this.roadLength = roadLength;
    this.cruiseSpeed = speed;
    this.speed = speed;
    this.scripted = false;
    this.paint.tint = color;
    this.view.x = x;
    this.view.scale.y = direction;
    this.front = front;
    this.view.visible = true;
    this.isActive = true;
  }

  advance(seconds: number): void {
    if (this.isActive && seconds > 0) this.front = this.frontDistance + this.speed * seconds;
  }

  deactivate(): void {
    this.isActive = false;
    this.scripted = false;
    this.speed = 0;
    this.view.visible = false;
    this.view.removeFromParent();
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.deactivate();
    this.isDestroyed = true;
    // Textures stay: they belong to the shared atlas.
    this.view.destroy({ children: true });
  }
}
