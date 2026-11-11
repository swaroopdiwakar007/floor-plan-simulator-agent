/**
 * Pure view maths shared by first- and third-person modes (no Three.js, unit-testable).
 *
 * World axes: x east, y up, z = -plan y. Yaw 0 faces plan north (world -z) and
 * positive yaw turns left. Pitch 0 is level, positive pitch faces up.
 */

export type POV = 'first' | 'third';

export const MAX_PITCH_FIRST = (85 * Math.PI) / 180;
export const MAX_PITCH_THIRD = (60 * Math.PI) / 180;
/** Preferred distance from the avatar's head to the third-person camera. */
export const THIRD_DISTANCE = 3.0;
/** Keep the camera this far in front of anything it would otherwise clip into. */
export const CAMERA_CLEARANCE = 0.2;

export type V3 = [number, number, number];

export const clampPitch = (pitch: number, pov: POV): number => {
  const m = pov === 'first' ? MAX_PITCH_FIRST : MAX_PITCH_THIRD;
  return Math.max(-m, Math.min(m, pitch));
};

/** Unit world-space direction the player is facing. */
export function lookDirection(yaw: number, pitch: number): V3 {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}

/**
 * Third-person camera: behind the head along the look direction, so facing up
 * swings the camera down behind the avatar and facing down raises it.
 * `maxDist` is the free distance found by a ray cast (walls, ceilings).
 */
export function thirdPersonCamera(head: V3, yaw: number, pitch: number, maxDist = Infinity): V3 {
  const d = lookDirection(yaw, pitch);
  const dist = Math.max(0.3, Math.min(THIRD_DISTANCE, maxDist - CAMERA_CLEARANCE));
  return [head[0] - d[0] * dist, head[1] - d[1] * dist, head[2] - d[2] * dist];
}
