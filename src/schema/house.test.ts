import { describe, expect, it } from 'vitest';
import sample from '../data/sample-house.json';
import type { House } from './house';
import { validateHouse } from './validate';
import { resolveHouse } from './resolve';
import { HousePhysics, stepPlayer, type PlayerState } from '../viewer/physics';

const house = sample as unknown as House; // JSON tuples widen to number[]; validateHouse checks at runtime
const clone = (): House => structuredClone(house);

describe('validateHouse', () => {
  it('accepts the sample house with no errors', () => {
    expect(validateHouse(house).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('flags a stair with no matching void above', () => {
    const h = clone();
    h.floors[1].voids = [];
    const issues = validateHouse(h);
    expect(issues.some((i) => i.level === 'error' && i.ref === 'g-stair' && /no matching void/.test(i.message))).toBe(true);
  });

  it('flags a void that is shifted off the stair (misaligned floors)', () => {
    const h = clone();
    h.floors[1].origin = [2, 0];
    expect(validateHouse(h).some((i) => i.ref === 'g-stair')).toBe(true);
  });

  it('flags openings past the wall end and missing walls', () => {
    const h = clone();
    h.floors[0].openings.push({ id: 'x1', wallId: 'g-s', type: 'window', offset: 9.9, width: 1, height: 1, sill: 1 });
    h.floors[0].openings.push({ id: 'x2', wallId: 'nope', type: 'door', offset: 1, width: 1, height: 2, sill: 0 });
    const refs = validateHouse(h).map((i) => i.ref);
    expect(refs).toContain('x1');
    expect(refs).toContain('x2');
  });
});

describe('HousePhysics', () => {
  const phys = new HousePhysics(resolveHouse(house));
  const walk = (st: PlayerState, dir: [number, number], metres: number) => {
    const speed = 2;
    const dt = 1 / 60;
    for (let t = 0; t < metres / speed; t += dt) stepPlayer(phys, st, [dir[0] * speed * dt, dir[1] * speed * dt], dt);
  };

  it('blocks walking through a solid wall', () => {
    const st: PlayerState = { pos: [5, 2], feetY: 0, vy: 0 };
    walk(st, [0, -1], 5); // south into the living room wall
    expect(st.pos[1]).toBeGreaterThan(0.125);
  });

  it('lets you walk in through the front door', () => {
    const st: PlayerState = { pos: [2.1, -2], feetY: 0, vy: 0 };
    walk(st, [0, 1], 3);
    expect(st.pos[1]).toBeGreaterThan(0.5);
  });

  it('climbs the stair to the first floor and stays there', () => {
    const st: PlayerState = { pos: [0.7, 1.0], feetY: 0, vy: 0 };
    walk(st, [0, 1], 6);
    expect(st.feetY).toBeCloseTo(3.0, 2);
    expect(st.pos[1]).toBeGreaterThan(5.5);
    expect(phys.floorAt(st.feetY)).toBe(1);
  });

  it('cannot walk into the side of the stair from the ground floor', () => {
    const st: PlayerState = { pos: [2.0, 4.5], feetY: 0, vy: 0 };
    walk(st, [-1, 0], 3);
    expect(st.pos[0]).toBeGreaterThan(1.2);
    expect(st.feetY).toBe(0);
  });

  it('railing stops you falling into the stairwell', () => {
    const st: PlayerState = { pos: [2.0, 4.0], feetY: 3.0, vy: 0 };
    walk(st, [-1, 0], 3);
    expect(st.pos[0]).toBeGreaterThan(1.2);
    expect(st.feetY).toBe(3.0);
  });
});
