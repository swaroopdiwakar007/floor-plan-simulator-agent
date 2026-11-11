import { describe, expect, it } from 'vitest';
import { MORNING_SUN, sunDirection } from './lighting';

describe('morning sun', () => {
  it('sits low in the east-south-east at 8 AM', () => {
    const [x, y, z] = sunDirection(MORNING_SUN.azimuthDeg, MORNING_SUN.elevationDeg);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1);
    expect(x).toBeGreaterThan(0.8); // mostly east
    expect(z).toBeGreaterThan(0); // a little south (plan south = world +z)
    expect(Math.asin(y) * (180 / Math.PI)).toBeCloseTo(20); // 20° above the horizon
  });

  it('maps compass bearings to world axes', () => {
    const north = sunDirection(0, 0);
    expect(north[2]).toBeCloseTo(-1);
    const east = sunDirection(90, 0);
    expect(east[0]).toBeCloseTo(1);
  });
});
