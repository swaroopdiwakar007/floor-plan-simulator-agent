import type { Floor, House, Stair, Vec2, Wall } from './house';
import { add } from './geometry';

export const DEFAULT_SLAB = 0.2;

/** A floor with defaults filled and `origin` applied to every point. */
export interface ResolvedFloor extends Omit<Floor, 'height' | 'slabThickness' | 'origin' | 'walls'> {
  index: number;
  height: number;
  slabThickness: number;
  walls: Required<Wall>[];
}

export interface ResolvedStair extends Stair {
  floorIndex: number;
  toIndex: number;
  /** Elevation at the bottom. */
  base: number;
  /** Total rise (toFloor.elevation - base). */
  rise: number;
}

export interface ResolvedHouse {
  source: House;
  floors: ResolvedFloor[];
  stairs: ResolvedStair[];
}

/**
 * Produces the world-plan view of a house that the builder and viewer use.
 * Never mutates the input.
 */
export function resolveHouse(house: House): ResolvedHouse {
  const floors: ResolvedFloor[] = house.floors.map((f, index) => {
    const o: Vec2 = f.origin ?? [0, 0];
    const t = (p: Vec2): Vec2 => add(p, o);
    const height = f.height ?? house.house.defaultFloorHeight;
    return {
      id: f.id,
      name: f.name,
      elevation: f.elevation,
      index,
      height,
      slabThickness: f.slabThickness ?? DEFAULT_SLAB,
      walls: f.walls.map((w) => ({ ...w, a: t(w.a), b: t(w.b), height: w.height ?? height })),
      openings: f.openings.map((op) => ({ ...op })),
      rooms: f.rooms.map((r) => ({ ...r, polygon: r.polygon.map(t) })),
      voids: f.voids.map((v) => ({ ...v, polygon: v.polygon.map(t) })),
      stairs: f.stairs.map((s) => ({ ...s, start: t(s.start) })),
      rails: f.rails.map((r) => ({ ...r, points: r.points.map(t) })),
    };
  });

  const stairs: ResolvedStair[] = [];
  for (const f of floors) {
    for (const s of f.stairs) {
      const toIndex = floors.findIndex((g) => g.id === s.toFloor);
      if (toIndex < 0) continue; // reported by validate()
      stairs.push({ ...s, floorIndex: f.index, toIndex, base: f.elevation, rise: floors[toIndex].elevation - f.elevation });
    }
  }
  return { source: house, floors, stairs };
}
