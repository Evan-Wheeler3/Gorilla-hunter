import { Block } from '../world/blocks';
import type { VoxelWorld } from '../world/voxelWorld';
import type { Vec3 } from '../world/island';

/** What fire turns each block into. */
const BURNS_TO: Partial<Record<number, number>> = {
  [Block.Grass]: Block.Ash,
  [Block.Flower]: Block.Ash,
  [Block.Cloth]: Block.Ash,
  [Block.Leaves]: Block.BurntLeaves,
  [Block.LeavesDark]: Block.BurntLeaves,
  [Block.Wood]: Block.Charred,
  [Block.Plank]: Block.Charred,
  [Block.Crate]: Block.Charred,
};

/**
 * The second half of a round: a ring of fire closes in on a point near the middle of the island.
 * Outside the ring is deadly after a few seconds. The ground and trees it passes stay scorched.
 */
export class Wildfire {
  readonly center: Vec3;
  /** Radius when the fire starts (beyond the shore) and when the round ends. */
  readonly startRadius = 70;
  readonly endRadius = 12;
  private startTime = -1;
  private columns: { ix: number; iz: number; d: number }[] | null = null;
  private next = 0;
  private lastBurnAt = -10;

  constructor(
    private readonly world: VoxelWorld,
    center: { x: number; z: number },
    private readonly duration: number,
  ) {
    this.center = { x: center.x, y: 0, z: center.z };
  }

  get active(): boolean {
    return this.startTime >= 0;
  }

  start(time: number): void {
    if (this.startTime < 0) this.startTime = time;
  }

  /** Radius of the safe circle at round time `time` (Infinity before the fire starts). */
  radius(time: number): number {
    if (this.startTime < 0) return Infinity;
    const k = Math.min(1, Math.max(0, (time - this.startTime) / this.duration));
    // Fast at first (the shore burns quickly), slowing as it closes in.
    const e = 1 - (1 - k) * (1 - k);
    return this.startRadius + (this.endRadius - this.startRadius) * e;
  }

  outside(p: { x: number; z: number }, time: number): boolean {
    return Math.hypot(p.x - this.center.x, p.z - this.center.z) > this.radius(time);
  }

  /** Scorches the world outside the ring, a band at a time (so views rebuild in small batches). */
  burn(time: number): void {
    if (this.startTime < 0 || time - this.lastBurnAt < 1.5) return;
    this.lastBurnAt = time;
    const w = this.world;
    if (!this.columns) {
      this.columns = [];
      for (let iz = 0; iz < w.sz; iz++)
        for (let ix = 0; ix < w.sx; ix++) {
          const d = Math.hypot(w.cx(ix) - this.center.x, w.cz(iz) - this.center.z);
          if (d <= this.startRadius) this.columns.push({ ix, iz, d });
        }
      this.columns.sort((a, b) => b.d - a.d); // outermost first
    }
    const r = this.radius(time);
    while (this.next < this.columns.length && this.columns[this.next].d > r) {
      const { ix, iz } = this.columns[this.next++];
      for (let iy = 0; iy < w.sy; iy++) {
        const to = BURNS_TO[w.get(ix, iy, iz)];
        if (to !== undefined) w.edit(ix, iy, iz, to);
      }
    }
  }
}
