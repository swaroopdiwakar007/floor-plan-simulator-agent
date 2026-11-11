/**
 * House JSON — the single source of truth.
 *
 * SCHEMA VERSION 1. Change only deliberately: bump `schemaVersion` and note
 * the change in README.md.
 *
 * Conventions
 * - All lengths are metres.
 * - Plan coordinates are [x, y]: x to the right (east), y up the page (north).
 * - All floors share one coordinate system. `floor.origin` is an optional
 *   offset added to every point on that floor (used to align floors).
 * - Angles are degrees, counter-clockwise, 0 = +x (east), 90 = +y (north).
 */

export type Vec2 = [number, number];

export interface House {
  schemaVersion: 1;
  house: HouseInfo;
  /** Ordered bottom to top. */
  floors: Floor[];
  roof?: Roof;
}

export interface HouseInfo {
  name: string;
  units: 'm';
  /** Floor-to-floor height used when a floor omits `height`. */
  defaultFloorHeight: number;
}

export interface Floor {
  id: string;
  name: string;
  /** Height of the finished floor surface (top of this floor's slab). */
  elevation: number;
  /** Floor-to-floor height. Walls default to this height. */
  height?: number;
  /** Slab thickness below `elevation`. Default 0.2. */
  slabThickness?: number;
  /** Offset added to every point on this floor. Default [0, 0]. */
  origin?: Vec2;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  voids: Void[];
  stairs: Stair[];
  rails: Rail[];
}

export interface Wall {
  id: string;
  /** Centreline start point. */
  a: Vec2;
  /** Centreline end point. */
  b: Vec2;
  thickness: number;
  /** Defaults to the floor's height. */
  height?: number;
}

export type OpeningType = 'door' | 'arch' | 'window';

export interface Opening {
  id: string;
  wallId: string;
  type: OpeningType;
  /** Distance along the wall from `wall.a` to the opening's centre. */
  offset: number;
  width: number;
  height: number;
  /** Height of the bottom of the opening above the floor. 0 for doors and arches. */
  sill: number;
}

export type RoomType =
  | 'living'
  | 'dining'
  | 'kitchen'
  | 'bedroom'
  | 'bathroom'
  | 'wc'
  | 'hall'
  | 'study'
  | 'utility'
  | 'garage'
  | 'other';

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  /** Closed polygon (last point is NOT repeated). */
  polygon: Vec2[];
}

/** A hole in this floor's slab (stairwell, double-height space). */
export interface Void {
  id: string;
  polygon: Vec2[];
}

/**
 * A straight flight. Starts on this floor and arrives at `toFloor`.
 * Rise per step = (toFloor.elevation - floor.elevation) / steps.
 * Footprint length = steps * going.
 */
export interface Stair {
  id: string;
  /** Centre of the bottom edge of the first step. */
  start: Vec2;
  /** Direction of travel going up, in degrees. */
  direction: number;
  width: number;
  /** Number of risers. */
  steps: number;
  /** Tread depth (horizontal distance per step). */
  going: number;
  /** Id of the floor this stair arrives at. */
  toFloor: string;
}

export interface Rail {
  id: string;
  /** Polyline. */
  points: Vec2[];
  height: number;
}

export interface Roof {
  type: 'gable' | 'flat' | 'none';
  /** Pitch in degrees (gable only). */
  pitch?: number;
  overhang?: number;
  /** Ridge runs along this plan axis. Default: the longer side. */
  ridgeAxis?: 'x' | 'y';
  /** Override the outline. Default: derived from the top floor. */
  outline?: Vec2[];
}
