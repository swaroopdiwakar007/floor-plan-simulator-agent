import type { Stair, Vec2, Wall } from './house';

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
export const len = (a: Vec2): number => Math.hypot(a[0], a[1]);
export const deg2rad = (d: number): number => (d * Math.PI) / 180;

export function wallLength(w: Wall): number {
  return len(sub(w.b, w.a));
}

/** Signed area; positive when counter-clockwise. */
export function polygonArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  const a = polygonArea(poly);
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

/** Even-odd ray cast. Points exactly on an edge may go either way. */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function distPointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return len(sub(p, add(a, scale(ab, t))));
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bboxOf(points: Vec2[], pad = 0): BBox {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of points) {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
  }
  b.minX -= pad;
  b.minY -= pad;
  b.maxX += pad;
  b.maxY += pad;
  return b;
}

export function bboxPolygon(b: BBox): Vec2[] {
  return [
    [b.minX, b.minY],
    [b.maxX, b.minY],
    [b.maxX, b.maxY],
    [b.minX, b.maxY],
  ];
}

/** Outer bounding box of a set of walls, including their thickness. */
export function wallsBBox(walls: Wall[]): BBox {
  const pts: Vec2[] = [];
  let maxT = 0;
  for (const w of walls) {
    pts.push(w.a, w.b);
    maxT = Math.max(maxT, w.thickness);
  }
  return bboxOf(pts, maxT / 2);
}

/* ---------- Stairs ---------- */

export interface StairFrame {
  /** Unit vector in the direction of travel (up). */
  d: Vec2;
  /** Unit vector to the left of travel. */
  n: Vec2;
  run: number;
}

export function stairFrame(s: Stair): StairFrame {
  const r = deg2rad(s.direction);
  return { d: [Math.cos(r), Math.sin(r)], n: [-Math.sin(r), Math.cos(r)], run: s.steps * s.going };
}

/** Local (u along travel, v across) coordinates of a plan point. */
export function stairLocal(s: Stair, p: Vec2): { u: number; v: number } {
  const f = stairFrame(s);
  const rel = sub(p, s.start);
  return { u: dot(rel, f.d), v: dot(rel, f.n) };
}

export function stairPoint(s: Stair, u: number, v: number): Vec2 {
  const f = stairFrame(s);
  return add(s.start, add(scale(f.d, u), scale(f.n, v)));
}

export function stairFootprint(s: Stair): Vec2[] {
  const { run } = stairFrame(s);
  const h = s.width / 2;
  return [stairPoint(s, 0, -h), stairPoint(s, run, -h), stairPoint(s, run, h), stairPoint(s, 0, h)];
}
