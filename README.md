# House Walkthrough

Floor plans → House JSON → 3D first-person walkthrough (Three.js + TypeScript + Vite).

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # schema validation + walking physics
npm run build    # type-check + production build
```

**Controls**

| Motion | Keys |
|---|---|
| Forward / backward | W / S |
| Left / right | A / D step sideways · ← / → turn · mouse |
| Face up / face down | ↑ / ↓ · mouse |
| Run | Shift |
| 1st / 3rd person | V (or HUD button) |
| Day / night | N (or HUD button) |
| Jump to floor | 1–9 |
| Top-down overview | Tab (drag to orbit, scroll to zoom) |
| Release mouse | Esc |

Third person shows a stand-in avatar; the camera is pulled in front of walls, ceilings and glass so it never leaves the room.

**Lighting:** day = sun with soft shadows + sky light; night = dim moonlight + a ceiling lamp in every room
(shadow-casting point lights). Lamps run only on the floor you are on, so light never leaks through slabs.

## Layout

| Path | What |
|---|---|
| `src/schema/house.ts` | House JSON types — the single source of truth (schema v1) |
| `src/schema/validate.ts` | Checks: ids, openings fit walls, rooms closed, stair ↔ void match |
| `src/schema/resolve.ts` | Applies `floor.origin` offsets and defaults for builder/viewer |
| `src/schema/geometry.ts` | Pure 2D helpers |
| `src/builder/` | House JSON → Three.js meshes (walls cut at openings, slabs with voids, stairs, rails, roof) |
| `src/viewer/physics.ts` | Pure walking physics: wall/rail collision, stairs, gravity (unit-tested) |
| `src/viewer/walker.ts`, `camera.ts` | Player controller (1st/3rd person), view maths (unit-tested) |
| `src/viewer/lighting.ts` | Sun/moon, room lamps, shadows, day/night |
| `src/viewer/minimap.ts` | Minimap |
| `src/data/sample-house.json` | Hand-written two-floor test house |

## Schema v1 conventions

- Metres. Plan points are `[x, y]`, x east, y north. Angles in degrees, CCW, 0 = east.
- All floors share one coordinate system; `floor.origin` shifts a whole floor for alignment.
- `floor.elevation` = top of that floor's slab; `floor.height` = floor-to-floor; `slabThickness` default 0.2.
- Opening `offset` = distance from `wall.a` to the opening **centre**. `sill` 0 for doors/arches.
- Stair `start` = centre of the bottom edge of the first step; rise per step is derived from
  the two floors' elevations; footprint length = `steps × going`.
- Validation requires the floor above a stair to have a void covering the flight wherever
  headroom (2.0 m) would hit the slab.
- In 3D, plan `[x, y]` maps to world `(x, h, -y)` (keeps top-down views un-mirrored).

## Known simplifications (step 1)

- Slab and roof outline = bounding box of the floor's walls (fine for rectangular houses).
- Straight stair flights only; no landings/winders.
- Flat colours, no door leaves, stand-in avatar — polish is step 4.
