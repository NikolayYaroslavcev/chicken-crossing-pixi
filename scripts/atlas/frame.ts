/** One picture in the atlas, described as SVG in world units. */
export interface Frame {
  name: string;
  width: number;
  height: number;
  /** Point the sprite is positioned by, as a fraction of the frame. */
  anchor: { x: number; y: number };
  /** SVG markup drawn inside a `0 0 width height` view box. */
  svg: string;
}
