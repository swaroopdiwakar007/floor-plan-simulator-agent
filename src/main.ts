import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import sample from './data/sample-house.json';
import type { House, Vec2 } from './schema/house';
import { resolveHouse } from './schema/resolve';
import { validateHouse } from './schema/validate';
import { polygonArea, polygonCentroid, pointInPolygon, wallsBBox } from './schema/geometry';
import { buildHouse } from './builder/build';
import { HousePhysics } from './viewer/physics';
import { Walker } from './viewer/walker';
import { Minimap } from './viewer/minimap';
import { Lighting } from './viewer/lighting';

const house = sample as unknown as House; // JSON tuples widen to number[]; validateHouse checks at runtime

// ---------- Validate ----------
const issues = validateHouse(house);
const warnList = document.getElementById('warnings')!;
for (const i of issues) {
  const li = document.createElement('li');
  li.className = i.level;
  li.textContent = `${i.level.toUpperCase()}: ${i.message}`;
  warnList.appendChild(li);
  (i.level === 'error' ? console.error : console.warn)('[house]', i.message);
}

// ---------- Scene ----------
const resolved = resolveHouse(house);
const built = buildHouse(resolved);
const phys = new HousePhysics(resolved);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.add(built.root);
const lighting = new Lighting(scene, renderer, resolved, built);

const fpCam = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 500);
const walker = new Walker(fpCam, renderer.domElement, phys, built.root);
scene.add(walker.avatar);

// Overview: orbit camera looking down at a cutaway of the selected floor.
const ovCam = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
const ovControls = new OrbitControls(ovCam, renderer.domElement);
ovControls.enableDamping = true;
ovControls.enabled = false;
const allWalls = resolved.floors.flatMap((f) => f.walls);
const hb = wallsBBox(allWalls);
const centre: Vec2 = [(hb.minX + hb.maxX) / 2, (hb.minY + hb.maxY) / 2];
const span = Math.max(hb.maxX - hb.minX, hb.maxY - hb.minY);

// ---------- State ----------
let overview = false;
let overviewFloor = 0;
const minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, resolved, phys);
const statusEl = document.getElementById('status')!;
const startEl = document.getElementById('start')!;
const ovBtn = document.getElementById('overview-btn')!;

/** A good place to stand on a floor: the centre of its largest room that isn't blocked. */
function spawnFor(index: number): Vec2 {
  const f = resolved.floors[index];
  const rooms = [...f.rooms].sort((a, b) => Math.abs(polygonArea(b.polygon)) - Math.abs(polygonArea(a.polygon)));
  for (const r of rooms) {
    const c = polygonCentroid(r.polygon);
    if (!f.voids.some((v) => pointInPolygon(c, v.polygon)) && !phys.blocked(c, f.elevation)) return c;
  }
  return centre;
}

function goToFloor(index: number) {
  if (index < 0 || index >= resolved.floors.length) return;
  if (overview) {
    overviewFloor = index;
    applyOverview();
  } else {
    walker.teleport(spawnFor(index), resolved.floors[index].elevation);
  }
  updateFloorButtons();
}

const floorsEl = document.getElementById('floors')!;
const floorBtns = resolved.floors.map((f, i) => {
  const b = document.createElement('button');
  b.textContent = `${i + 1} · ${f.name}`;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    goToFloor(i);
  });
  floorsEl.appendChild(b);
  return b;
});

function currentFloor(): number {
  return overview ? overviewFloor : phys.floorAt(walker.state.feetY);
}

function updateFloorButtons() {
  const cur = currentFloor();
  floorBtns.forEach((b, i) => b.classList.toggle('active', i === cur));
}

function applyOverview() {
  built.floorGroups.forEach((g, i) => (g.visible = !overview || i <= overviewFloor));
  built.roofGroup.visible = !overview;
  if (overview) {
    const y = resolved.floors[overviewFloor].elevation;
    ovControls.target.set(centre[0], y, -centre[1]);
  }
}

function setOverview(on: boolean) {
  overview = on;
  ovBtn.classList.toggle('active', on);
  if (on) {
    overviewFloor = phys.floorAt(walker.state.feetY);
    walker.enabled = false;
    walker.unlock();
    const y = resolved.floors[overviewFloor].elevation;
    ovCam.position.set(centre[0] + span * 0.15, y + span * 1.3, -centre[1] + span * 0.9);
    ovControls.enabled = true;
    startEl.style.display = 'none';
  } else {
    ovControls.enabled = false;
    startEl.style.display = '';
  }
  applyOverview();
  updateFloorButtons();
}

// ---------- Input ----------
startEl.addEventListener('click', () => {
  startEl.style.display = 'none';
  walker.enabled = true;
  walker.lock();
});
walker.onUnlock = () => {
  if (!overview) {
    walker.enabled = false;
    startEl.style.display = '';
  }
};
const povBtn = document.getElementById('pov-btn')!;
function updatePOVButton() {
  povBtn.textContent = walker.pov === 'first' ? '1st person' : '3rd person';
}
function togglePOV() {
  walker.togglePOV();
  updatePOVButton();
  document.body.classList.toggle('third-person', walker.pov === 'third');
}
const timeBtn = document.getElementById('time-btn')!;
function toggleTime() {
  lighting.toggle();
  timeBtn.textContent = lighting.mode === 'day' ? '☀ Day' : '☾ Night';
}
timeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleTime();
});
povBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePOV();
});
updatePOVButton();
ovBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setOverview(!overview);
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') {
    e.preventDefault();
    setOverview(!overview);
  } else if (e.code === 'KeyN') {
    toggleTime();
  } else if (e.code === 'KeyV' && !overview) {
    togglePOV();
  } else if (/^Digit[1-9]$/.test(e.code)) {
    goToFloor(Number(e.code.slice(5)) - 1);
  }
});
window.addEventListener('resize', () => {
  for (const c of [fpCam, ovCam]) {
    c.aspect = window.innerWidth / window.innerHeight;
    c.updateProjectionMatrix();
  }
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Start: outside the front door, facing the house ----------
const front = resolved.floors[0]?.openings.find((o) => o.type === 'door');
const frontWall = front && resolved.floors[0].walls.find((w) => w.id === front.wallId);
if (front && frontWall) {
  const L = Math.hypot(frontWall.b[0] - frontWall.a[0], frontWall.b[1] - frontWall.a[1]);
  const d: Vec2 = [(frontWall.b[0] - frontWall.a[0]) / L, (frontWall.b[1] - frontWall.a[1]) / L];
  const door: Vec2 = [frontWall.a[0] + d[0] * front.offset, frontWall.a[1] + d[1] * front.offset];
  // Step out along the wall normal, choosing the side outside the house.
  let n: Vec2 = [-d[1], d[0]];
  const probe: Vec2 = [door[0] + n[0] * 3, door[1] + n[1] * 3];
  if (pointInPolygon(probe, [[hb.minX, hb.minY], [hb.maxX, hb.minY], [hb.maxX, hb.maxY], [hb.minX, hb.maxY]])) n = [-n[0], -n[1]];
  const yaw = Math.atan2(n[0], -n[1]); // face back towards the door: forward (-sin, cos) = -n
  walker.teleport([door[0] + n[0] * 4, door[1] + n[1] * 4], resolved.floors[0].elevation, yaw);
} else {
  walker.teleport(spawnFor(0), resolved.floors[0]?.elevation ?? 0, 0);
}
updateFloorButtons();

// ---------- Loop ----------
const clock = new THREE.Clock();
let lastFloor = -1;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  walker.update(dt);
  if (overview) ovControls.update();

  const fi = currentFloor();
  lighting.update(fi);
  if (fi !== lastFloor) {
    lastFloor = fi;
    updateFloorButtons();
  }
  const pos = walker.state.pos;
  const room = resolved.floors[fi].rooms.find((r) => pointInPolygon(pos, r.polygon));
  statusEl.textContent = overview
    ? `Overview · ${resolved.floors[fi].name} (drag to orbit, scroll to zoom)`
    : `${resolved.floors[fi].name} · ${room ? room.name : 'Outside'}`;
  minimap.draw(fi, pos, walker.yaw);
  renderer.render(scene, overview ? ovCam : fpCam);
});

// Debug/testing handle.
(window as unknown as { __app: unknown }).__app = {
  walker, phys, resolved, setOverview, goToFloor, issues, togglePOV, toggleTime, lighting,
  render: () => renderer.render(scene, overview ? ovCam : fpCam),
  ovControls,
};
