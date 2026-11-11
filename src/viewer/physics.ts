import type { Vec2 } from '../schema/house';
import { add, distPointSegment, pointInPolygon, scale, stairLocal, sub, wallLength, wallsBBox, bboxPolygon } from '../schema/geometry';
import type { ResolvedHouse } from '../schema/resolve';

/** Pure walking physics in plan coordinates. No Three.js, so it is unit-testable. */

export const PLAYER_RADIUS = 0.25;
/** Highest ledge the player steps up without being blocked. */
export const STEP_UP = 0.35;
/** Drops smaller than this are followed instantly (walking down stairs). */
export const STEP_DOWN = 0.4;
export const BODY_HEIGHT = 1.75;

export interface Segment {
  a: Vec2;
  b: Vec2;
  /** Half thickness. */
  half: number;
}

export class HousePhysics {
  readonly segments: Segment[][];
  private outlines: Vec2[][];

  constructor(readonly house: ResolvedHouse) {
    this.segments = house.floors.map((f) => {
      const segs: Segment[] = [];
      for (const w of f.walls) {
        const L = wallLength(w);
        if (L < 1e-6) continue;
        const d = scale(sub(w.b, w.a), 1 / L);
        const at = (u: number): Vec2 => add(w.a, scale(d, u));
        // Doors and arches (and any opening starting near the floor) are passable.
        const gaps = f.openings
          .filter((o) => o.wallId === w.id && o.sill < STEP_UP && o.height > 1.5)
          .map((o) => [o.offset - o.width / 2, o.offset + o.width / 2] as const)
          .sort((p, q) => p[0] - q[0]);
        let cursor = -w.thickness / 2;
        for (const [u0, u1] of gaps) {
          if (u0 > cursor) segs.push({ a: at(cursor), b: at(u0), half: w.thickness / 2 });
          cursor = Math.max(cursor, u1);
        }
        const end = L + w.thickness / 2;
        if (end > cursor) segs.push({ a: at(cursor), b: at(end), half: w.thickness / 2 });
      }
      for (const r of f.rails) {
        for (let i = 0; i + 1 < r.points.length; i++) segs.push({ a: r.points[i], b: r.points[i + 1], half: 0.03 });
      }
      return segs;
    });
    this.outlines = house.floors.map((f) => (f.walls.length ? bboxPolygon(wallsBBox(f.walls)) : []));
  }

  /** The floor whose walls the player collides with at this foot height. */
  floorAt(feetY: number): number {
    let idx = 0;
    this.house.floors.forEach((f, i) => {
      if (f.elevation <= feetY + 0.5) idx = i;
    });
    return idx;
  }

  /** Height of the walkable surface under `p` that is reachable from `feetY`. */
  groundHeight(p: Vec2, feetY: number): number {
    let best = this.house.floors[0]?.elevation ?? 0; // terrain around the house
    const consider = (h: number) => {
      if (h <= feetY + STEP_UP && h > best) best = h;
    };
    this.house.floors.forEach((f, i) => {
      const outline = this.outlines[i];
      if (!outline.length || !pointInPolygon(p, outline)) return;
      if (f.voids.some((v) => pointInPolygon(p, v.polygon))) return;
      consider(f.elevation);
    });
    for (const s of this.house.stairs) {
      const { u, v } = stairLocal(s, p);
      const run = s.steps * s.going;
      if (u >= 0 && u <= run && Math.abs(v) <= s.width / 2) consider(s.base + (u / run) * s.rise);
    }
    return best;
  }

  /** True if a player standing at `p` with feet at `feetY` would overlap something solid. */
  blocked(p: Vec2, feetY: number): boolean {
    const segs = this.segments[this.floorAt(feetY)] ?? [];
    for (const s of segs) {
      if (distPointSegment(p, s.a, s.b) < PLAYER_RADIUS + s.half) return true;
    }
    // The body of a stair is solid where its surface is above step-up height.
    for (const s of this.house.stairs) {
      const { u, v } = stairLocal(s, p);
      const run = s.steps * s.going;
      const r = PLAYER_RADIUS;
      if (u < -r || u > run + r || Math.abs(v) > s.width / 2 + r) continue;
      const top = s.base + (Math.min(Math.max(u, 0), run) / run) * s.rise;
      if (top > feetY + STEP_UP && s.base < feetY + BODY_HEIGHT) return true;
    }
    return false;
  }
}

export interface PlayerState {
  pos: Vec2;
  feetY: number;
  vy: number;
}

/**
 * Advances the player by a plan-space displacement, sliding along walls,
 * then applies stepping and gravity.
 */
export function stepPlayer(phys: HousePhysics, st: PlayerState, move: Vec2, dt: number): void {
  // Sub-step so fast movement can't tunnel through thin walls.
  const dist = Math.hypot(move[0], move[1]);
  const n = Math.max(1, Math.ceil(dist / 0.05));
  const dx = move[0] / n;
  const dy = move[1] / n;
  for (let i = 0; i < n; i++) {
    const tx: Vec2 = [st.pos[0] + dx, st.pos[1]];
    if (!phys.blocked(tx, st.feetY)) st.pos = tx;
    const ty: Vec2 = [st.pos[0], st.pos[1] + dy];
    if (!phys.blocked(ty, st.feetY)) st.pos = ty;
    const g = phys.groundHeight(st.pos, st.feetY);
    if (g >= st.feetY - STEP_DOWN && st.vy <= 0) {
      st.feetY = g;
    }
  }

  const g = phys.groundHeight(st.pos, st.feetY);
  if (st.feetY > g + 1e-4) {
    st.vy -= 9.81 * dt;
    st.feetY += st.vy * dt;
    if (st.feetY <= g) {
      st.feetY = g;
      st.vy = 0;
    }
  } else {
    st.feetY = g;
    st.vy = 0;
  }
}
