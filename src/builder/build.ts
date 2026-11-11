import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vec2 } from '../schema/house';
import { add, bboxPolygon, deg2rad, pointInPolygon, scale, stairFrame, sub, wallLength, wallsBBox } from '../schema/geometry';
import type { ResolvedFloor, ResolvedHouse } from '../schema/resolve';
import { createMaterials, type Materials } from './materials';

/**
 * Plan [x, y] -> world (x, h, -y). Three.js is right-handed with y up, so plan
 * north (+y) maps to world -z; this keeps the top-down view un-mirrored.
 */
export const toWorld = (p: Vec2, h = 0) => new THREE.Vector3(p[0], h, -p[1]);

export interface BuiltHouse {
  root: THREE.Group;
  /** One group per floor (slab, rooms, walls, stairs leaving it, rails). */
  floorGroups: THREE.Group[];
  /** Roof plus the top floor's ceiling. */
  roofGroup: THREE.Group;
  materials: Materials;
}

/** A box centred on plan point `c`, rotated `rotY` radians, spanning heights y0..y1. */
function box(c: Vec2, sx: number, sz: number, y0: number, y1: number, rotY: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, y1 - y0, sz);
  const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(toWorld(c, (y0 + y1) / 2));
  g.applyMatrix4(m);
  return g;
}

/** Collects geometries per material and merges them into a single mesh each. */
class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(mat: THREE.Material, g: THREE.BufferGeometry) {
    // mergeGeometries needs matching attribute sets; ensure non-indexed + same attrs.
    const ng = g.index ? g.toNonIndexed() : g;
    if (!ng.attributes.uv) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((ng.attributes.position.count) * 2), 2));
    ng.clearGroups();
    (this.parts.get(mat) ?? this.parts.set(mat, []).get(mat)!).push(ng);
  }
  flush(into: THREE.Group, name: string) {
    for (const [mat, geos] of this.parts) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = name;
      into.add(mesh);
    }
    this.parts.clear();
  }
}

function shapeFrom(poly: Vec2[], holes: Vec2[][] = []): THREE.Shape {
  const s = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return s;
}

/** Horizontal geometry from a plan shape: XY plane -> world XZ (plan y -> -z), at height h. */
function flatShape(shape: THREE.Shape, h: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, h, 0);
  return g;
}

function slabGeometry(shape: THREE.Shape, top: number, thickness: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, top - thickness, 0);
  return g;
}

/** Slab outline: for now the outer bounding box of the floor's walls. */
export function floorOutline(f: ResolvedFloor): Vec2[] {
  return bboxPolygon(wallsBBox(f.walls));
}

function buildFloor(house: ResolvedHouse, f: ResolvedFloor, mats: Materials): THREE.Group {
  const g = new THREE.Group();
  g.name = `floor:${f.id}`;
  const batch = new Batch();
  const E = f.elevation;
  const voids = f.voids.map((v) => v.polygon);

  // Slab with holes for voids.
  if (f.walls.length) {
    batch.add(mats.slab, slabGeometry(shapeFrom(floorOutline(f), voids), E, f.slabThickness));
  }

  // Room floor finishes, slightly above the slab. Voids fully inside a room become holes.
  for (const r of f.rooms) {
    const holes = voids.filter((v) => v.every((p) => pointInPolygon(p, r.polygon) || onPolygonEdge(p, r.polygon)));
    batch.add(mats.roomFloors.get(r.type) ?? mats.slab, flatShape(shapeFrom(r.polygon, holes), E + 0.005));
  }

  // Walls, cut around openings.
  for (const w of f.walls) {
    const L = wallLength(w);
    const d = scale(sub(w.b, w.a), 1 / L);
    const rot = Math.atan2(d[1], d[0]);
    const H = w.height;
    const t = w.thickness;
    const at = (u: number): Vec2 => add(w.a, scale(d, u));
    const piece = (u0: number, u1: number, y0: number, y1: number) => {
      if (u1 - u0 < 1e-4 || y1 - y0 < 1e-4) return;
      batch.add(mats.wall, box(at((u0 + u1) / 2), u1 - u0, t, E + y0, E + y1, rot));
    };
    const ops = f.openings.filter((o) => o.wallId === w.id).sort((a, b) => a.offset - b.offset);
    // Extend each wall by half its thickness so corners close.
    let cursor = -t / 2;
    for (const o of ops) {
      const u0 = o.offset - o.width / 2;
      const u1 = o.offset + o.width / 2;
      piece(cursor, u0, 0, H);
      piece(u0, u1, o.sill + o.height, H); // lintel
      if (o.sill > 0) piece(u0, u1, 0, o.sill);
      if (o.type === 'window') {
        batch.add(mats.glass, box(at(o.offset), o.width, 0.02, E + o.sill, E + o.sill + o.height, rot));
      }
      cursor = u1;
    }
    piece(cursor, L + t / 2, 0, H);
  }

  // Stairs leaving this floor: solid steps.
  for (const s of house.stairs.filter((st) => st.floorIndex === f.index)) {
    const fr = stairFrame(s);
    const rot = deg2rad(s.direction);
    const riser = s.rise / s.steps;
    for (let i = 0; i < s.steps; i++) {
      const c = add(s.start, scale(fr.d, (i + 0.5) * s.going));
      batch.add(mats.stair, box(c, s.going, s.width, s.base, s.base + (i + 1) * riser, rot));
    }
  }

  // Railings: top rail, end posts and balusters.
  for (const rail of f.rails) {
    for (let i = 0; i + 1 < rail.points.length; i++) {
      const a = rail.points[i];
      const b = rail.points[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-6) continue;
      const d = scale(sub(b, a), 1 / L);
      const rot = Math.atan2(d[1], d[0]);
      batch.add(mats.rail, box(add(a, scale(d, L / 2)), L + 0.05, 0.05, E + rail.height - 0.05, E + rail.height, rot));
      const n = Math.max(1, Math.round(L / 0.12));
      for (let k = 0; k <= n; k++) {
        const end = k === 0 || k === n;
        const sz = end ? 0.06 : 0.02;
        batch.add(mats.rail, box(add(a, scale(d, (L * k) / n)), sz, sz, E, E + rail.height, rot));
      }
    }
  }

  batch.flush(g, g.name);
  g.userData.floorIndex = f.index;
  return g;
}

function onPolygonEdge(p: Vec2, poly: Vec2[], eps = 1e-6): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(cross) > eps) continue;
    if (p[0] >= Math.min(a[0], b[0]) - eps && p[0] <= Math.max(a[0], b[0]) + eps && p[1] >= Math.min(a[1], b[1]) - eps && p[1] <= Math.max(a[1], b[1]) + eps) return true;
  }
  return false;
}

function buildRoof(house: ResolvedHouse, mats: Materials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'roof';
  const top = house.floors[house.floors.length - 1];
  const roof = house.source.roof ?? { type: 'gable' as const };
  if (!top || !top.walls.length) return g;

  const eave = top.elevation + top.height;
  const outline = roof.outline ?? floorOutline(top);
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const batch = new Batch();

  // Ceiling of the top floor.
  batch.add(mats.slab, slabGeometry(shapeFrom(outline), eave + 0.15, 0.15));

  const oh = roof.overhang ?? 0.4;
  if (roof.type === 'flat') {
    batch.add(mats.roof, slabGeometry(shapeFrom(bboxPolygon({ minX: minX - oh, minY: minY - oh, maxX: maxX + oh, maxY: maxY + oh })), eave + 0.35, 0.2));
  } else if (roof.type === 'gable') {
    // Work in (along, across) relative to the ridge, then map back to plan.
    const axis = roof.ridgeAxis ?? (maxX - minX >= maxY - minY ? 'x' : 'y');
    const [a0, a1, c0, c1] = axis === 'x' ? [minX, maxX, minY, maxY] : [minY, maxY, minX, maxX];
    const toPlan = (along: number, across: number): Vec2 => (axis === 'x' ? [along, across] : [across, along]);
    const tan = Math.tan(deg2rad(roof.pitch ?? 35));
    const half = (c1 - c0) / 2;
    const cm = (c0 + c1) / 2;
    const base = eave + 0.15;
    const ridge = base + half * tan;
    const low = base - oh * tan;
    const v = (along: number, across: number, h: number) => toWorld(toPlan(along, across), h);

    const slope = (edge: number) => {
      const geo = new THREE.BufferGeometry().setFromPoints([
        v(a0 - oh, edge, low), v(a1 + oh, edge, low), v(a1 + oh, cm, ridge),
        v(a0 - oh, edge, low), v(a1 + oh, cm, ridge), v(a0 - oh, cm, ridge),
      ]);
      geo.computeVertexNormals();
      batch.add(mats.roof, geo);
    };
    slope(c0 - oh);
    slope(c1 + oh);

    for (const end of [a0, a1]) {
      const geo = new THREE.BufferGeometry().setFromPoints([v(end, c0, eave), v(end, c1, eave), v(end, cm, ridge)]);
      geo.computeVertexNormals();
      batch.add(mats.exterior, geo);
    }
  }
  batch.flush(g, 'roof');
  return g;
}

export function buildHouse(house: ResolvedHouse): BuiltHouse {
  const materials = createMaterials();
  const root = new THREE.Group();
  root.name = 'house';

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), materials.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = (house.floors[0]?.elevation ?? 0) - 0.02;
  ground.name = 'ground';
  root.add(ground);

  const floorGroups = house.floors.map((f) => buildFloor(house, f, materials));
  floorGroups.forEach((fg) => root.add(fg));
  const roofGroup = buildRoof(house, materials);
  root.add(roofGroup);
  return { root, floorGroups, roofGroup, materials };
}
