import type { House } from './house';
import { pointInPolygon, polygonArea, stairPoint, wallLength } from './geometry';
import { resolveHouse } from './resolve';

export interface Issue {
  level: 'error' | 'warning';
  /** Id of the floor, and of the element if any. */
  floorId?: string;
  ref?: string;
  message: string;
}

/** Clear height needed above a stair's treads. */
export const STAIR_HEADROOM = 2.0;

export function validateHouse(house: House): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string, floorId?: string, ref?: string) => issues.push({ level: 'error', message, floorId, ref });
  const warn = (message: string, floorId?: string, ref?: string) => issues.push({ level: 'warning', message, floorId, ref });

  if (house.schemaVersion !== 1) err(`Unsupported schemaVersion ${String(house.schemaVersion)}`);
  if (!house.floors.length) err('House has no floors');

  const floorIds = new Set<string>();
  house.floors.forEach((f, i) => {
    if (floorIds.has(f.id)) err(`Duplicate floor id "${f.id}"`, f.id);
    floorIds.add(f.id);
    if (i > 0 && f.elevation <= house.floors[i - 1].elevation) {
      err(`Floor "${f.name}" must be above "${house.floors[i - 1].name}" (floors are ordered bottom to top)`, f.id);
    }
  });

  const r = resolveHouse(house);

  for (const f of r.floors) {
    const ids = new Set<string>();
    const all = [...f.walls, ...f.openings, ...f.rooms, ...f.voids, ...f.stairs, ...f.rails];
    for (const el of all) {
      if (ids.has(el.id)) err(`Duplicate id "${el.id}"`, f.id, el.id);
      ids.add(el.id);
    }

    const walls = new Map(f.walls.map((w) => [w.id, w]));
    for (const w of f.walls) {
      if (wallLength(w) < 1e-6) err(`Wall ${w.id} has zero length`, f.id, w.id);
      if (w.thickness <= 0) err(`Wall ${w.id} has no thickness`, f.id, w.id);
    }

    const byWall = new Map<string, typeof f.openings>();
    for (const op of f.openings) {
      const w = walls.get(op.wallId);
      if (!w) {
        err(`Opening ${op.id} refers to missing wall "${op.wallId}"`, f.id, op.id);
        continue;
      }
      const L = wallLength(w);
      if (op.offset - op.width / 2 < -1e-6 || op.offset + op.width / 2 > L + 1e-6) {
        err(`Opening ${op.id} runs past the end of wall ${w.id}`, f.id, op.id);
      }
      if (op.sill + op.height > w.height + 1e-6) err(`Opening ${op.id} is taller than wall ${w.id}`, f.id, op.id);
      if (op.type !== 'window' && op.sill !== 0) warn(`${op.type} ${op.id} has a sill above the floor`, f.id, op.id);
      byWall.set(w.id, [...(byWall.get(w.id) ?? []), op]);
    }
    for (const [wid, ops] of byWall) {
      const sorted = [...ops].sort((a, b) => a.offset - b.offset);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].offset - sorted[i].width / 2 < sorted[i - 1].offset + sorted[i - 1].width / 2) {
          err(`Openings ${sorted[i - 1].id} and ${sorted[i].id} overlap on wall ${wid}`, f.id, sorted[i].id);
        }
      }
    }

    for (const room of f.rooms) {
      if (room.polygon.length < 3 || Math.abs(polygonArea(room.polygon)) < 1e-4) {
        err(`Room "${room.name}" is not a closed polygon with area`, f.id, room.id);
      }
    }
    for (const v of f.voids) {
      if (v.polygon.length < 3 || Math.abs(polygonArea(v.polygon)) < 1e-4) err(`Void ${v.id} has no area`, f.id, v.id);
    }
    for (const rail of f.rails) {
      if (rail.points.length < 2) err(`Rail ${rail.id} needs at least 2 points`, f.id, rail.id);
    }
  }

  // Stairs: must arrive at a higher floor, and that floor needs a slab hole over the flight.
  for (const f of r.floors) {
    for (const s of f.stairs) {
      const to = r.floors.find((g) => g.id === s.toFloor);
      if (!to) {
        err(`Stair ${s.id} connects to missing floor "${s.toFloor}"`, f.id, s.id);
        continue;
      }
      if (to.elevation <= f.elevation) {
        err(`Stair ${s.id} must connect to a floor above "${f.name}"`, f.id, s.id);
        continue;
      }
      if (to.index !== f.index + 1) warn(`Stair ${s.id} skips a floor`, f.id, s.id);
      if (s.steps < 1 || s.going <= 0 || s.width <= 0) {
        err(`Stair ${s.id} has invalid steps/going/width`, f.id, s.id);
        continue;
      }
      const rise = to.elevation - f.elevation;
      const perStep = rise / s.steps;
      if (perStep > 0.22) warn(`Stair ${s.id} rise per step is ${(perStep * 100).toFixed(1)} cm (steep)`, f.id, s.id);

      // Every point over the flight where headroom would hit the slab above must be in a void.
      const underside = to.elevation - to.slabThickness;
      const run = s.steps * s.going;
      const missing: string[] = [];
      for (let u = 0.05; u < run - 0.02; u += 0.1) {
        const tread = f.elevation + (u / run) * rise;
        if (tread + STAIR_HEADROOM <= underside) continue;
        for (const v of [-s.width / 2 + 0.05, 0, s.width / 2 - 0.05]) {
          const p = stairPoint(s, u, v);
          if (!to.voids.some((vd) => pointInPolygon(p, vd.polygon))) {
            missing.push(`(${p[0].toFixed(2)}, ${p[1].toFixed(2)})`);
          }
        }
      }
      if (missing.length) {
        err(
          `Stair ${s.id} on "${f.name}" has no matching void in "${to.name}"'s slab ` +
            `(${missing.length} points blocked, e.g. ${missing[0]})`,
          f.id,
          s.id,
        );
      }
    }
  }

  return issues;
}
