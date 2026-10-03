import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, DIFFICULTY_LEVELS } from '@/engine';
import {
  computeWorldLayout,
  FINISH_WIDTH,
  LANE_WIDTH,
  START_WIDTH,
  WORLD_HEIGHT,
  worldScale,
} from './layout';

describe('computeWorldLayout', () => {
  it.each(DIFFICULTY_LEVELS)('lays out one lane per step on %s', (difficulty) => {
    const { steps } = DIFFICULTIES[difficulty];
    const layout = computeWorldLayout(steps);

    expect(layout.lanes).toHaveLength(steps);
    expect(layout.lanes.map((lane) => lane.index)).toEqual(
      Array.from({ length: steps }, (_, i) => i + 1),
    );
    expect(layout.height).toBe(WORLD_HEIGHT);
    expect(layout.width).toBe(START_WIDTH + steps * LANE_WIDTH + FINISH_WIDTH);
  });

  it('keeps lanes the same width and packs them edge to edge after the start', () => {
    const { lanes, start } = computeWorldLayout(24);

    expect(new Set(lanes.map((lane) => lane.width))).toEqual(new Set([LANE_WIDTH]));
    expect(lanes[0]?.x).toBe(start.x + start.width);
    lanes.slice(1).forEach((lane, i) => {
      const previous = lanes[i]!;
      expect(lane.x).toBe(previous.x + previous.width);
    });
  });

  it('places the finish right after the last lane', () => {
    for (const difficulty of DIFFICULTY_LEVELS) {
      const { lanes, finish } = computeWorldLayout(DIFFICULTIES[difficulty].steps);
      const last = lanes.at(-1)!;
      expect(finish.x).toBe(last.x + last.width);
    }
  });

  it('is deterministic and shares geometry across lane counts', () => {
    expect(computeWorldLayout(20)).toEqual(computeWorldLayout(20));
    expect(computeWorldLayout(15).lanes).toEqual(computeWorldLayout(24).lanes.slice(0, 15));
  });

  it('keeps anchors and obstacle areas inside their lane', () => {
    for (const lane of computeWorldLayout(15).lanes) {
      expect(lane.anchor.x).toBe(lane.x + lane.width / 2);
      expect(lane.anchor.y).toBeGreaterThan(lane.y);
      expect(lane.anchor.y).toBeLessThan(lane.y + lane.height);
      expect(lane.obstacleArea).toEqual({
        x: lane.x,
        y: lane.y,
        width: lane.width,
        height: lane.height,
      });
    }
  });

  it('rejects invalid lane counts', () => {
    expect(() => computeWorldLayout(0)).toThrow(RangeError);
    expect(() => computeWorldLayout(2.5)).toThrow(RangeError);
  });
});

describe('worldScale', () => {
  it('fits the fixed world height into the viewport', () => {
    expect(worldScale(WORLD_HEIGHT)).toBe(1);
    expect(worldScale(WORLD_HEIGHT / 2)).toBe(0.5);
  });

  it('falls back to 1 for unusable heights', () => {
    expect(worldScale(0)).toBe(1);
    expect(worldScale(Number.NaN)).toBe(1);
  });
});
