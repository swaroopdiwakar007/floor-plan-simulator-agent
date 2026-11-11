import { describe, expect, it } from 'vitest';
import { clampPitch, lookDirection, MAX_PITCH_FIRST, thirdPersonCamera, THIRD_DISTANCE, CAMERA_CLEARANCE } from './camera';

describe('view maths', () => {
  it('yaw 0 faces plan north (world -z); facing up raises the look direction', () => {
    const [x, y, z] = lookDirection(0, 0);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(-1);
    expect(lookDirection(0, 0.5)[1]).toBeGreaterThan(0);
    expect(lookDirection(0, -0.5)[1]).toBeLessThan(0);
  });

  it('clamps face up / face down', () => {
    expect(clampPitch(10, 'first')).toBeCloseTo(MAX_PITCH_FIRST);
    expect(clampPitch(-10, 'third')).toBeLessThan(0);
    expect(Math.abs(clampPitch(-10, 'third'))).toBeLessThan(MAX_PITCH_FIRST);
  });

  it('third-person camera sits behind the head, lower when facing up', () => {
    const level = thirdPersonCamera([0, 1.6, 0], 0, 0);
    expect(level[2]).toBeCloseTo(THIRD_DISTANCE); // behind = +z when facing -z
    expect(thirdPersonCamera([0, 1.6, 0], 0, 0.4)[1]).toBeLessThan(1.6);
    expect(thirdPersonCamera([0, 1.6, 0], 0, -0.4)[1]).toBeGreaterThan(1.6);
  });

  it('pulls the camera in front of a wall hit by the ray', () => {
    const cam = thirdPersonCamera([0, 1.6, 0], 0, 0, 1.0);
    expect(cam[2]).toBeCloseTo(1.0 - CAMERA_CLEARANCE);
  });
});
