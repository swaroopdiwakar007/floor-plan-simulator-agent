import * as THREE from 'three';
import type { Vec2 } from '../schema/house';
import { polygonCentroid, wallsBBox } from '../schema/geometry';
import type { ResolvedHouse } from '../schema/resolve';
import type { BuiltHouse } from '../builder/build';

export type TimeOfDay = 'day' | 'night';

/**
 * Day = a morning sun at about 8 AM: low in the east-south-east sky, warm light,
 * long shadows. Compass azimuth (0 = plan north, 90 = east), elevation above the horizon.
 */
export const MORNING_SUN = { azimuthDeg: 105, elevationDeg: 20, distance: 40 };

/** Unit world-space vector pointing from the house towards the sun (plan north = world -z). */
export function sunDirection(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

interface Preset {
  sky: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  /** Day: the point-light sun. Night: the directional moon. */
  lightColor: number;
  light: number;
  exposure: number;
  lampsOn: boolean;
}

const PRESETS: Record<TimeOfDay, Preset> = {
  day: {
    sky: 0xc9dcec, fogNear: 70, fogFar: 220,
    hemiSky: 0xe8f0ff, hemiGround: 0xd9cbb5, hemi: 1.35,
    lightColor: 0xffd6a6, light: 3.2,
    exposure: 1.0, lampsOn: false,
  },
  night: {
    sky: 0x0a1020, fogNear: 25, fogFar: 90,
    hemiSky: 0x2a3a66, hemiGround: 0x0c0c10, hemi: 0.5,
    lightColor: 0x9fb4ff, light: 0.6,
    exposure: 1.0, lampsOn: true,
  },
};

const LAMP_INTENSITY = 6; // candela (physically based units)
const LAMP_RANGE = 9;

const MOON_FROM: [number, number, number] = [-0.5, 1.0, -0.4];

/**
 * Day: a visible sun in the sky that is a shadow-casting point light.
 * Night: a dim directional moon. Both have sky light, and at night one ceiling lamp per room.
 * Lamps (and their shadow maps) only run on the floor the player is on, so
 * the cost stays bounded and light never leaks through the slab between floors.
 */
export class Lighting {
  mode: TimeOfDay = 'day';
  readonly sun: THREE.PointLight;
  readonly sunDisc: THREE.Group;
  readonly moon: THREE.DirectionalLight;
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

    // Sun: a point light far out in the 8 AM direction. decay 0 = no distance falloff,
    // like real sunlight; its shadows fan out slightly from the light.
    const { azimuthDeg, elevationDeg, distance } = MORNING_SUN;
    const sunPos = this.centre.clone().addScaledVector(new THREE.Vector3(...sunDirection(azimuthDeg, elevationDeg)), distance);
    this.sun = new THREE.PointLight(0xffffff, 1, 0, 0);
    this.sun.position.copy(sunPos);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = distance * 3;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.sunDisc = makeSunDisc();
    this.sunDisc.position.copy(sunPos);
    scene.add(this.sun, this.sunDisc);

    this.moon = new THREE.DirectionalLight();
    this.moon.castShadow = true;
    const sc = this.moon.shadow.camera;
    sc.left = sc.bottom = -this.radius;
    sc.right = sc.top = this.radius;
    sc.near = 0.5;
    sc.far = this.radius * 4;
    this.moon.shadow.mapSize.set(2048, 2048);
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.03;
    this.moon.target.position.copy(this.centre);
    this.moon.position.copy(this.centre).addScaledVector(new THREE.Vector3(...MOON_FROM).normalize(), this.radius * 2);
    scene.add(this.moon, this.moon.target);

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
    const day = mode === 'day';
    this.sun.visible = this.sunDisc.visible = day;
    this.moon.visible = !day;
    const active = day ? this.sun : this.moon;
    active.color.setHex(p.lightColor);
    active.intensity = p.light;
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

/** The visible sun: a bright disc with a soft additive glow. Never casts or receives shadows. */
function makeSunDisc(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'sun';
  const disc = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false, toneMapped: false }),
  );
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const grad = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,236,190,1)');
  grad.addColorStop(0.25, 'rgba(255,214,150,0.55)');
  grad.addColorStop(1, 'rgba(255,200,130,0)');
  x.fillStyle = grad;
  x.fillRect(0, 0, 128, 128);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  glow.scale.setScalar(12);
  g.add(disc, glow);
  g.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });
  return g;
}
