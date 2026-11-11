import type { Vec2 } from '../schema/house';
import { bboxOf, stairFootprint } from '../schema/geometry';
import type { ResolvedHouse } from '../schema/resolve';
import { ROOM_COLORS } from '../builder/materials';
import type { HousePhysics } from './physics';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private toPx: (p: Vec2) => [number, number];

  constructor(private canvas: HTMLCanvasElement, private house: ResolvedHouse, private phys: HousePhysics) {
    this.ctx = canvas.getContext('2d')!;
    const pts: Vec2[] = house.floors.flatMap((f) => f.walls.flatMap((w) => [w.a, w.b]));
    const b = bboxOf(pts.length ? pts : [[0, 0], [1, 1]], 1.5);
    const s = Math.min(canvas.width / (b.maxX - b.minX), canvas.height / (b.maxY - b.minY));
    const ox = (canvas.width - (b.maxX - b.minX) * s) / 2;
    const oy = (canvas.height - (b.maxY - b.minY) * s) / 2;
    // Plan y up = screen up.
    this.toPx = ([x, y]) => [ox + (x - b.minX) * s, canvas.height - (oy + (y - b.minY) * s)];
  }

  draw(floorIndex: number, pos: Vec2, yaw: number) {
    const { ctx, canvas, toPx } = this;
    const f = this.house.floors[floorIndex];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(20,22,26,0.75)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const poly = (p: Vec2[]) => {
      ctx.beginPath();
      p.forEach((q, i) => (i ? ctx.lineTo(...toPx(q)) : ctx.moveTo(...toPx(q))));
      ctx.closePath();
    };

    for (const r of f.rooms) {
      poly(r.polygon);
      ctx.fillStyle = hex(ROOM_COLORS[r.type] ?? 0x999999);
      ctx.fill();
    }
    for (const v of f.voids) {
      poly(v.polygon);
      ctx.fillStyle = '#1b1d22';
      ctx.fill();
    }
    // Stairs leaving or arriving on this floor.
    for (const s of this.house.stairs) {
      if (s.floorIndex !== floorIndex && s.toIndex !== floorIndex) continue;
      const fp = stairFootprint(s);
      poly(fp);
      ctx.fillStyle = s.floorIndex === floorIndex ? '#8a6a48' : 'rgba(138,106,72,0.5)';
      ctx.fill();
      ctx.strokeStyle = '#5a4630';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.strokeStyle = '#f4f1ea';
    ctx.lineCap = 'square';
    for (const s of this.phys.segments[floorIndex]) {
      ctx.lineWidth = Math.max(1.5, s.half * 2 * (toPx([1, 0])[0] - toPx([0, 0])[0]));
      ctx.beginPath();
      ctx.moveTo(...toPx(s.a));
      ctx.lineTo(...toPx(s.b));
      ctx.stroke();
    }

    // Player: dot + view cone. yaw 0 looks plan +y; positive yaw turns left.
    // Clamp to the canvas edge when the player is outside the mapped area.
    const [rx, ry] = toPx(pos);
    const px = Math.min(Math.max(rx, 6), canvas.width - 6);
    const py = Math.min(Math.max(ry, 6), canvas.height - 6);
    const dir = -yaw - Math.PI / 2; // screen angle (canvas y is down)
    ctx.fillStyle = 'rgba(255,90,60,0.35)';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, 22, dir - 0.5, dir + 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ff5a3c';
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(f.name, 8, 16);
  }
}
