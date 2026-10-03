/**
 * World geometry in logical pixels. The world has a fixed height and grows to the right:
 * start sidewalk, one lane per playable step, then the finish. Lane width never depends on
 * the difficulty, so only the number of lanes and the finish position change between levels.
 */
export const WORLD_HEIGHT = 640;
export const LANE_WIDTH = 112;
export const START_WIDTH = 168;
export const FINISH_WIDTH = 208;

export const ROAD_TOP = 136;
export const ROAD_HEIGHT = WORLD_HEIGHT - ROAD_TOP;
/** The line the chicken walks along, also where each lane shows its multiplier. */
export const PATH_Y = ROAD_TOP + Math.round(ROAD_HEIGHT * 0.55);
export const BADGE_RADIUS = 34;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface LaneLayout extends Rect {
  readonly index: number;
  /** Centre of the multiplier badge; the chicken stands here on this lane. */
  readonly anchor: Point;
  readonly obstacleArea: Rect;
}

export interface WorldLayout {
  readonly width: number;
  readonly height: number;
  readonly start: Rect & { readonly anchor: Point };
  readonly lanes: readonly LaneLayout[];
  readonly finish: Rect & { readonly anchor: Point };
}

export function computeWorldLayout(laneCount: number): WorldLayout {
  if (!Number.isInteger(laneCount) || laneCount < 1) {
    throw new RangeError(`Lane count must be a positive integer, got ${laneCount}`);
  }

  const lanes: LaneLayout[] = [];
  for (let index = 1; index <= laneCount; index++) {
    const x = START_WIDTH + (index - 1) * LANE_WIDTH;
    lanes.push({
      index,
      x,
      y: ROAD_TOP,
      width: LANE_WIDTH,
      height: ROAD_HEIGHT,
      anchor: { x: x + LANE_WIDTH / 2, y: PATH_Y },
      obstacleArea: { x, y: ROAD_TOP, width: LANE_WIDTH, height: ROAD_HEIGHT },
    });
  }

  const finishX = START_WIDTH + laneCount * LANE_WIDTH;
  return {
    width: finishX + FINISH_WIDTH,
    height: WORLD_HEIGHT,
    start: {
      x: 0,
      y: ROAD_TOP,
      width: START_WIDTH,
      height: ROAD_HEIGHT,
      anchor: { x: START_WIDTH / 2, y: PATH_Y },
    },
    lanes,
    finish: {
      x: finishX,
      y: ROAD_TOP,
      width: FINISH_WIDTH,
      height: ROAD_HEIGHT,
      anchor: { x: finishX + FINISH_WIDTH / 2, y: PATH_Y },
    },
  };
}

export function worldScale(viewportHeight: number): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 1;
  return viewportHeight / WORLD_HEIGHT;
}
