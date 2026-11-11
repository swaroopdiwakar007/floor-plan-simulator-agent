import * as THREE from 'three';
import type { Vec2 } from '../schema/house';
import { HousePhysics, stepPlayer, type PlayerState } from './physics';
import { clampPitch, lookDirection, thirdPersonCamera, THIRD_DISTANCE, type POV } from './camera';

export const EYE_HEIGHT = 1.6;
const WALK = 1.8;
const RUN = 4.0;
const TURN = 2.2; // rad/s, arrow keys left/right
const TILT = 1.6; // rad/s, arrow keys up/down
const MOUSE = 0.0022; // rad per pixel

/**
 * Player controller for both points of view.
 *
 * Motions:
 *  - Forward / backward:  W / S
 *  - Left / right:        A / D strafe, ← / → turn (mouse also turns)
 *  - Face up / face down: ↑ / ↓ (mouse also tilts)
 */
export class Walker {
  readonly state: PlayerState = { pos: [0, 0], feetY: 0, vy: 0 };
  enabled = false;
  pov: POV = 'first';
  yaw = 0;
  pitch = 0;
  /** Called when pointer lock is released (Esc). */
  onUnlock: () => void = () => {};
  readonly avatar: THREE.Group;

  private keys = new Set<string>();
  private eyeY = EYE_HEIGHT;
  private ray = new THREE.Raycaster();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
    readonly phys: HousePhysics,
    /** Meshes the third-person camera must not pass through. */
    private obstacles: THREE.Object3D,
  ) {
    this.avatar = makeAvatar();
    this.avatar.visible = false;

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (this.enabled && e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * MOUSE;
      this.pitch = clampPitch(this.pitch - e.movementY * MOUSE, this.pov);
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.dom) this.onUnlock();
    });
  }

  lock() {
    try {
      const p = this.dom.requestPointerLock() as unknown;
      if (p instanceof Promise) p.catch(() => {}); // unavailable: keyboard still works
    } catch {
      /* keyboard still works */
    }
  }

  unlock() {
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  setPOV(pov: POV) {
    this.pov = pov;
    this.pitch = clampPitch(this.pitch, pov);
    this.syncCamera();
  }

  togglePOV() {
    this.setPOV(this.pov === 'first' ? 'third' : 'first');
  }

  /** yaw 0 faces plan north (+y); positive yaw turns left. */
  teleport(pos: Vec2, feetY: number, yaw?: number, pitch = 0) {
    this.state.pos = [...pos];
    this.state.feetY = feetY;
    this.state.vy = 0;
    this.eyeY = feetY + EYE_HEIGHT;
    if (yaw !== undefined) {
      this.yaw = yaw;
      this.pitch = clampPitch(pitch, this.pov);
    }
    this.syncCamera();
  }

  update(dt: number) {
    if (this.enabled) {
      const k = this.keys;
      const turn = (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0);
      const tilt = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
      this.yaw += turn * TURN * dt;
      this.pitch = clampPitch(this.pitch + tilt * TILT * dt, this.pov);

      const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
      const side = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
      let move: Vec2 = [0, 0];
      if (fwd || side) {
        // Movement stays horizontal regardless of pitch.
        const f: Vec2 = [-Math.sin(this.yaw), Math.cos(this.yaw)];
        const r: Vec2 = [Math.cos(this.yaw), Math.sin(this.yaw)];
        const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : WALK) * dt;
        const mx = f[0] * fwd + r[0] * side;
        const my = f[1] * fwd + r[1] * side;
        const l = Math.hypot(mx, my);
        move = [(mx / l) * speed, (my / l) * speed];
      }
      stepPlayer(this.phys, this.state, move, dt);
    }
    // Smooth the eye height so stairs feel like a ramp rather than a jitter.
    const target = this.state.feetY + EYE_HEIGHT;
    this.eyeY += (target - this.eyeY) * Math.min(1, dt * 12);
    if (Math.abs(target - this.eyeY) > 1.5) this.eyeY = target;
    this.syncCamera();
  }

  private syncCamera() {
    const [px, py] = this.state.pos;
    const head = new THREE.Vector3(px, this.eyeY, -py);
    const d = new THREE.Vector3(...lookDirection(this.yaw, this.pitch));

    this.avatar.position.set(px, this.eyeY - EYE_HEIGHT, -py);
    this.avatar.rotation.y = this.yaw;

    if (this.pov === 'first') {
      this.avatar.visible = false;
      this.camera.position.copy(head);
    } else {
      // Pull the camera in when a wall or ceiling is between it and the head.
      this.ray.set(head, d.clone().negate());
      this.ray.far = THIRD_DISTANCE;
      const hit = this.ray.intersectObject(this.obstacles, true).find((h) => isSolid(h.object));
      const pos = thirdPersonCamera([head.x, head.y, head.z], this.yaw, this.pitch, hit ? hit.distance : Infinity);
      this.camera.position.set(...pos);
      // Too close to see the avatar without clipping into it: hide it.
      this.avatar.visible = this.camera.position.distanceTo(head) > 0.8;
    }
    this.camera.lookAt(head.clone().add(d));
  }
}

/** Anything visible blocks the camera, glass included, so it never ends up outside. */
function isSolid(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** A simple stand-in figure; its nose shows which way it faces. */
function makeAvatar(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'avatar';
  const body = new THREE.MeshStandardMaterial({ color: 0x2f6fb3, roughness: 0.7 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe0b48f, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.8 });

  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.8, 16), dark);
  legs.position.y = 0.4;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.45, 6, 16), body);
  torso.position.y = 1.12;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 16), skin);
  head.position.y = EYE_HEIGHT;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 10), skin);
  nose.rotation.x = -Math.PI / 2; // point along -z (forward at yaw 0)
  nose.position.set(0, EYE_HEIGHT - 0.01, -0.14);
  g.add(legs, torso, head, nose);
  // The avatar must never block the camera ray.
  g.traverse((o) => {
    o.raycast = () => {};
    o.castShadow = true;
  });
  return g;
}
