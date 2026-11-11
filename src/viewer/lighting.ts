import * as THREE from 'three';
import type { Vec2 } from '../schema/house';
import { polygonCentroid, wallsBBox } from '../schema/geometry';
import type { ResolvedHouse } from '../schema/resolve';
import type { BuiltHouse } from '../builder/build';

export type TimeOfDay = 'day' | 'night';

interface Preset {
  sky: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  sunColor: number;
  sun: number;
  /** Direction the sun/moon shines from (world, normalised later). */
  sunFrom: [number, number, number];
  exposure: number;
  lampsOn: boolean;
}

const PRESETS: Record<TimeOfDay, Preset> = {
  day: {
    sky: 0xbfd8ee, fogNear: 60, fogFar: 200,
    hemiSky: 0xffffff, hemiGround: 0xd9d2c5, hemi: 1.6,
    sunColor: 0xfff2dd, sun: 2.8, sunFrom: [0.6, 1.0, 0.35],
    exposure: 1.0, lampsOn: false,
  },
  night: {
    sky: 0x0a1020, fogNear: 25, fogFar: 90,
    hemiSky: 0x2a3a66, hemiGround: 0x0c0c10, hemi: 0.5,
    sunColor: 0x9fb4ff, sun: 0.6, sunFrom: [-0.5, 1.0, -0.4],
    exposure: 1.0, lampsOn: true,
  },
};

const LAMP_INTENSITY = 6; // candela (physically based units)
const LAMP_RANGE = 9;

/**
 * Sun/moon with shadows, sky light, and one ceiling lamp per room.
 * Lamps (and their shadow maps) only run on the floor the player is on, so
 * the cost stays bounded and light never leaks through the slab between floors.
 */
export class Lighting {
  mode: TimeOfDay = 'day';
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private lampsByFloor: { light: THREE.PointLight; bulb: THREE.Mesh }[][];
  private activeFloor = -1;
  private bulbMat: THREE.MeshStandardMaterial;
  private centre: THREE.Vector3;
  private radius: number;

  constructor(
    private scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
    house: ResolvedHouse,
    built: BuiltHouse,
  ) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    // Every house surface casts and receives shadows, except glass.
    built.root.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      const m = (o as THREE.Mesh).material as THREE.Material;
      o.castShadow = !m.transparent && o.name !== 'ground';
      o.receiveShadow = true;
    });

    const walls = house.floors.flatMap((f) => f.walls);
    const b = wallsBBox(walls.length ? walls : [{ id: '', a: [0, 0], b: [1, 1], thickness: 0, height: 0 }]);
    const top = house.floors[house.floors.length - 1];
    const roofTop = top ? top.elevation + top.height + 4 : 6;
    this.centre = new THREE.Vector3((b.minX + b.maxX) / 2, roofTop / 2, -(b.minY + b.maxY) / 2);
    this.radius = Math.hypot(b.maxX - b.minX, b.maxY - b.minY, roofTop) / 2 + 2;

    this.hemi = new THREE.HemisphereLight();
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight();
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -this.radius;
    sc.right = sc.top = this.radius;
    sc.near = 0.5;
    sc.far = this.radius * 4;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.target.position.copy(this.centre);
    scene.add(this.sun, this.sun.target);

    // Ceiling lamps.
    const bulbMat = (this.bulbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe2b0, emissiveIntensity: 0 }));
    const bulbGeo = new THREE.SphereGeometry(0.08, 16, 12);
    const shadeGeo = new THREE.CylinderGeometry(0.05, 0.22, 0.14, 24, 1, true);
    const shadeMat = new THREE.MeshStandardMaterial({ color: 0xf3efe6, side: THREE.DoubleSide, roughness: 0.6 });
    this.lampsByFloor = house.floors.map((f, i) => {
      const above = house.floors[i + 1];
      const ceiling = above ? above.elevation - above.slabThickness : f.elevation + f.height;
      return f.rooms.map((r) => {
        const c: Vec2 = polygonCentroid(r.polygon);
        const y = ceiling - 0.35;
        const light = new THREE.PointLight(0xffd9a8, LAMP_INTENSITY, LAMP_RANGE, 2);
        light.position.set(c[0], y, -c[1]);
        light.castShadow = true;
        light.shadow.mapSize.set(512, 512);
        light.shadow.bias = -0.002;
        light.shadow.camera.near = 0.15;
        light.shadow.camera.far = LAMP_RANGE;
        light.visible = false;

        const bulb = new THREE.Mesh(bulbGeo, bulbMat);
        const shade = new THREE.Mesh(shadeGeo, shadeMat);
        shade.position.y = 0.06;
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 6), shadeMat);
        cord.position.y = 0.28;
        bulb.add(shade, cord);
        bulb.position.copy(light.position);
        bulb.name = `lamp:${r.id}`;
        // Fixtures never block light or the camera ray.
        bulb.traverse((o) => {
          o.castShadow = false;
          o.raycast = () => {};
        });
        built.floorGroups[i].add(bulb);
        scene.add(light);
        return { light, bulb };
      });
    });
    this.setMode('day');
  }

  setMode(mode: TimeOfDay) {
    this.mode = mode;
    const p = PRESETS[mode];
    const bg = new THREE.Color(p.sky);
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(p.sky, p.fogNear, p.fogFar);
    this.hemi.color.setHex(p.hemiSky);
    this.hemi.groundColor.setHex(p.hemiGround);
    this.hemi.intensity = p.hemi;
    this.sun.color.setHex(p.sunColor);
    this.sun.intensity = p.sun;
    const dir = new THREE.Vector3(...p.sunFrom).normalize();
    this.sun.position.copy(this.centre).addScaledVector(dir, this.radius * 2);
    this.renderer.toneMappingExposure = p.exposure;
    this.bulbMat.emissiveIntensity = p.lampsOn ? 2.5 : 0;
    this.activeFloor = -1; // force lamp refresh
  }

  toggle() {
    this.setMode(this.mode === 'day' ? 'night' : 'day');
  }

  /** Call every frame with the floor whose lamps should be lit. */
  update(floor: number) {
    if (floor === this.activeFloor) return;
    this.activeFloor = floor;
    const on = PRESETS[this.mode].lampsOn;
    this.lampsByFloor.forEach((lamps, i) => lamps.forEach(({ light }) => (light.visible = on && i === floor)));
  }
}
