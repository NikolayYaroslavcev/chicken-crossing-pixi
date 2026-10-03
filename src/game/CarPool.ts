import type { CarTextures } from './assets';
import { Car } from './Car';

/**
 * A fixed number of cars handed out and taken back. Cars are created on first use and kept for
 * reuse; once all of them are on the road, `acquire` returns null rather than making more.
 */
export class CarPool {
  private readonly cars: Car[] = [];
  private readonly idle: Car[] = [];
  private isDestroyed = false;

  constructor(
    readonly capacity: number,
    private readonly models: readonly CarTextures[],
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`Pool capacity must be a positive integer, got ${capacity}`);
    }
  }

  get size(): number {
    return this.cars.length;
  }

  get activeCount(): number {
    return this.cars.length - this.idle.length;
  }

  get destroyed(): boolean {
    return this.isDestroyed;
  }

  acquire(): Car | null {
    if (this.isDestroyed) return null;
    const reused = this.idle.pop();
    if (reused) return reused;
    if (this.cars.length >= this.capacity) return null;
    const car = new Car(this.models);
    this.cars.push(car);
    return car;
  }

  release(car: Car): void {
    if (this.isDestroyed || !this.cars.includes(car) || this.idle.includes(car)) return;
    car.deactivate();
    this.idle.push(car);
  }

  releaseAll(): void {
    if (this.isDestroyed) return;
    this.idle.length = 0;
    for (const car of this.cars) {
      car.deactivate();
      this.idle.push(car);
    }
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    for (const car of this.cars) car.destroy();
    this.cars.length = 0;
    this.idle.length = 0;
  }
}
