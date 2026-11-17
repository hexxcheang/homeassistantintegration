/**
 * Types of the 3D house model. Metres throughout: x = plan x * scale, z = plan y * scale, y is up.
 * Types only, so the main bundle can share them without pulling in the 3D code.
 */
export type V2 = [number, number];
export type V3 = [number, number, number];

/** One straight piece of wall, from `y0` to `y1` above the floor, along the line `from` to `to`. */
export interface WallPiece {
  from: V2;
  to: V2;
  thickness: number;
  y0: number;
  y1: number;
  kind: 'wall' | 'glass';
}

/**
 * A box in the furniture's own frame: `size` is [width, height, depth] with the width along the
 * piece and the depth from its back (the side `rotation` names) to its front. `centre` is already
 * in house metres. `turn` is the plan rotation in degrees (0 back at the top of the plan, 90 right,
 * 180 bottom, 270 left); a renderer turns the box clockwise seen from above, which is
 * `rotation.y = -turn` in three.js.
 */
export interface Box3 {
  centre: V3;
  size: V3;
  turn: number;
  part: 'body' | 'screen';
}

export interface FurnitureBlock {
  id: string;
  type: string;
  roomId: string | null;
  boxes: Box3[];
}

export interface ThreeRoom {
  id: string;
  name: string;
  polygon: V2[];
  /** A point inside the polygon, for labels and for entering the room. */
  centre: V2;
  /** Id of the room this piece belongs to; absent for a room's main piece. */
  partOf?: string;
}

/** Declared as far as the model needs it; the device fields arrive with the device placement. */
export interface ThreeDevice {
  id: string;
}

export interface ThreeModel {
  /** Level id and plan revisions; a new key means rebuild. */
  key: string;
  wallHeight: number;
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  rooms: ThreeRoom[];
  walls: WallPiece[];
  furniture: FurnitureBlock[];
  devices: ThreeDevice[];
}
