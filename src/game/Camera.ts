import { gsap } from 'gsap';
import type { Container } from 'pixi.js';

/** Share of the visible width kept to the left of the followed point. */
export const FOLLOW_FRACTION = 1 / 3;
const PAN_DURATION = 0.42;

export interface CameraBounds {
  /** Smallest allowed left edge of the view, in world units. */
  readonly min: number;
  /** Largest allowed left edge of the view, in world units. */
  readonly max: number;
}

/**
 * Where the left edge of the view may go so it never leaves the world. A world narrower than
 * the view is centred and never scrolls.
 */
export function cameraBounds(worldWidth: number, viewWidth: number): CameraBounds {
  if (worldWidth >= viewWidth) return { min: 0, max: worldWidth - viewWidth };
  const centred = (worldWidth - viewWidth) / 2;
  return { min: centred, max: centred };
}

export function cameraTarget(focusX: number, worldWidth: number, viewWidth: number): number {
  const { min, max } = cameraBounds(worldWidth, viewWidth);
  return Math.min(max, Math.max(min, focusX - viewWidth * FOLLOW_FRACTION));
}

/**
 * Horizontal camera over the world container. It only ever changes `world.x`; what it follows
 * and when is decided by the scene. All values are in world units.
 */
export class Camera {
  private worldWidth = 0;
  private viewWidth = 0;
  private focusX = 0;
  private pan: gsap.core.Tween | null = null;
  private settle: (() => void) | null = null;

  constructor(private readonly world: Container) {}

  get x(): number {
    return 0 - this.world.x;
  }

  get viewportWidth(): number {
    return this.viewWidth;
  }

  get bounds(): CameraBounds {
    return cameraBounds(this.worldWidth, this.viewWidth);
  }

  /**
   * Updates the world and view widths and snaps to the point being followed, so a resize or a
   * rebuilt world never leaves the view outside the new bounds.
   */
  resize(worldWidth: number, viewWidth: number): void {
    this.worldWidth = worldWidth;
    this.viewWidth = viewWidth;
    this.lookAt(this.focusX);
  }

  lookAt(focusX: number): void {
    this.stop();
    this.focusX = focusX;
    this.world.x = 0 - cameraTarget(focusX, this.worldWidth, this.viewWidth);
  }

  /**
   * Pans to follow `focusX`. Resolves when the pan ends, right away when the view is already
   * there, or early when another command interrupts it; it never rejects.
   */
  follow(focusX: number, duration = PAN_DURATION): Promise<void> {
    this.stop();
    this.focusX = focusX;
    const x = 0 - cameraTarget(focusX, this.worldWidth, this.viewWidth);
    if (Math.abs(this.world.x - x) < 0.5) {
      this.world.x = x;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.settle = () => {
        this.world.x = x;
        resolve();
      };
      this.pan = gsap.to(this.world, {
        x,
        duration,
        ease: 'power2.inOut',
        onComplete: () => {
          this.pan = null;
          this.settle = null;
          resolve();
        },
      });
    });
  }

  stop(): void {
    const settle = this.settle;
    this.pan?.kill();
    this.pan = null;
    this.settle = null;
    settle?.();
  }

  destroy(): void {
    this.stop();
  }
}
