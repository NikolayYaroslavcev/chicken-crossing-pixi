import { gsap } from 'gsap';
import { AnimatedSprite, Container, Sprite, type Ticker } from 'pixi.js';
import type { ChickenTextures } from './assets';
import type { Point } from './layout';

export type ChickenState = 'idle' | 'jump' | 'dead' | 'win';
/** States the chicken can be left in; `jump` only exists while it is moving. */
export type ChickenRestState = Exclude<ChickenState, 'jump'>;

export interface ChickenPlacement {
  lane: number;
  /** Where its feet touch the ground, in world coordinates. */
  at: Point;
}

export interface ChickenOptions {
  textures: ChickenTextures;
  /** Advances the frame animations; without one the chicken keeps its first frame. */
  ticker?: Ticker;
}

interface Clip {
  fps: number;
  loop: boolean;
}

const CLIPS: Record<ChickenState, Clip> = {
  idle: { fps: 5, loop: true },
  jump: { fps: 14, loop: true },
  dead: { fps: 10, loop: false },
  win: { fps: 9, loop: true },
};

export const JUMP_DURATION = 0.42;
const JUMP_HEIGHT = 46;

/**
 * The chicken only shows what it is told: which lane to hop to and which pose to end in.
 * Positions come from the scene, outcomes from the engine. GSAP moves it through the world;
 * the sprite's frame animation only changes how it looks while doing so.
 */
export class Chicken {
  private readonly root = new Container({ label: 'chicken' });
  private readonly shadow: Sprite;
  /** Moved by the hop and the pose tweens; the sprite inside it only flips frames. */
  private readonly body = new Container({ label: 'chickenBody' });
  private readonly sprite: AnimatedSprite;
  private readonly textures: ChickenTextures;
  private readonly ticker: Ticker | null;

  private currentLane: number;
  private currentState: ChickenState = 'idle';
  private animation: gsap.core.Timeline | null = null;
  private settle: (() => void) | null = null;
  private destroyed = false;

  constructor(parent: Container, { lane, at }: ChickenPlacement, options: ChickenOptions) {
    this.textures = options.textures;
    this.shadow = new Sprite({ texture: this.textures.shadow, label: 'shadow' });
    this.sprite = new AnimatedSprite({
      textures: this.textures.animations.idle,
      autoUpdate: false,
      updateAnchor: true,
      label: 'chickenSprite',
    });
    this.body.addChild(this.sprite);
    this.root.addChild(this.shadow, this.body);
    this.root.position.set(at.x, at.y);
    this.currentLane = lane;
    this.showClip('idle');

    this.ticker = options.ticker ?? null;
    this.ticker?.add(this.animateFrames);
    parent.addChild(this.root);
  }

  get lane(): number {
    return this.currentLane;
  }

  get state(): ChickenState {
    return this.currentState;
  }

  placeAt({ lane, at }: ChickenPlacement): void {
    if (this.destroyed) return;
    this.stop();
    this.resetPose();
    this.root.position.set(at.x, at.y);
    this.currentLane = lane;
    this.currentState = 'idle';
    this.showClip('idle');
  }

  /**
   * Hops to `at` and ends in `rest`. Resolves once the landing pose has played, or early if
   * the hop is cut short by another command or by destroy; it never rejects. `onLand` runs at
   * the moment the feet touch down, and not at all when the hop is cut short.
   */
  moveToLane(
    { lane, at }: ChickenPlacement,
    rest: ChickenRestState = 'idle',
    onLand?: () => void,
  ): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.stop();
    this.resetPose();
    this.currentState = 'jump';
    this.showClip('jump');

    const timeline = gsap
      .timeline()
      .to(this.root, { x: at.x, y: at.y, duration: JUMP_DURATION, ease: 'power1.inOut' }, 0)
      .to(this.body, { y: -JUMP_HEIGHT, duration: JUMP_DURATION / 2, ease: 'power2.out' }, 0)
      .to(this.body, { y: 0, duration: JUMP_DURATION / 2, ease: 'power2.in' }, '>')
      .to(this.body, { rotation: 0.1, duration: JUMP_DURATION / 2, yoyo: true, repeat: 1 }, 0)
      .to(
        this.body.scale,
        { x: 0.94, y: 1.06, duration: JUMP_DURATION / 2, yoyo: true, repeat: 1 },
        0,
      )
      .to(
        this.shadow.scale,
        { x: 0.55, y: 0.55, duration: JUMP_DURATION / 2, yoyo: true, repeat: 1 },
        0,
      )
      .call(() => {
        this.currentLane = lane;
        this.currentState = rest;
        this.showClip(rest);
        onLand?.();
      });
    this.addPose(timeline, rest);
    return this.play(timeline, () => {
      this.root.position.set(at.x, at.y);
      this.currentLane = lane;
    });
  }

  setState(state: ChickenRestState): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.stop();
    this.resetPose();
    this.currentState = state;
    this.showClip(state);
    return this.play(this.addPose(gsap.timeline(), state));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
    this.ticker?.remove(this.animateFrames);
    this.sprite.stop();
    // The textures belong to the shared atlas; only the display objects go.
    this.root.destroy({ children: true });
  }

  private readonly animateFrames = (ticker: Ticker): void => {
    this.sprite.update(ticker);
  };

  private play(timeline: gsap.core.Timeline, onInterrupt?: () => void): Promise<void> {
    return new Promise((resolve) => {
      this.animation = timeline;
      // Interrupted moves still land, so the chicken is never left between lanes.
      this.settle = () => {
        onInterrupt?.();
        resolve();
      };
      timeline.eventCallback('onComplete', () => {
        this.animation = null;
        this.settle = null;
        resolve();
      });
    });
  }

  private stop(): void {
    const settle = this.settle;
    this.animation?.kill();
    this.animation = null;
    this.settle = null;
    if (settle) {
      settle();
      if (this.currentState === 'jump') {
        this.currentState = 'idle';
        this.showClip('idle');
      }
    }
  }

  private showClip(state: ChickenState): void {
    const { fps, loop } = CLIPS[state];
    this.sprite.textures = this.textures.animations[state];
    this.sprite.loop = loop;
    this.sprite.animationSpeed = fps / 60;
    this.sprite.gotoAndPlay(0);
  }

  private clipDuration(state: ChickenState): number {
    return this.textures.animations[state].length / CLIPS[state].fps;
  }

  private addPose(timeline: gsap.core.Timeline, state: ChickenRestState): gsap.core.Timeline {
    const { body } = this;
    switch (state) {
      case 'idle':
        return timeline
          .to(body.scale, { x: 1.1, y: 0.9, duration: 0.08, ease: 'power1.out' })
          .to(body.scale, { x: 1, y: 1, duration: 0.16, ease: 'back.out(3)' });
      case 'dead': {
        const start = timeline.duration();
        return (
          timeline
            .to(body.scale, { x: 1.12, y: 0.86, duration: 0.08, ease: 'power2.out' })
            .to(body.scale, { x: 1, y: 1, duration: 0.2, ease: 'back.out(2)' })
            // Holds until the fall has played through, so callers wait for the final frame.
            .call(
              () => this.sprite.gotoAndStop(this.sprite.totalFrames - 1),
              [],
              start + this.clipDuration('dead'),
            )
        );
      }
      case 'win':
        return timeline
          .to(body.scale, { x: 1.1, y: 1.1, duration: 0.18, ease: 'back.out(2)' })
          .to(body, { y: -18, duration: 0.16, ease: 'power2.out', yoyo: true, repeat: 3 }, '<');
    }
  }

  private resetPose(): void {
    this.body.position.set(0, 0);
    this.body.rotation = 0;
    this.body.scale.set(1);
    this.shadow.scale.set(1);
  }
}
