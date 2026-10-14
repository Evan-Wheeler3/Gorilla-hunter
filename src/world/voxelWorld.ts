import { Block } from './blocks';

/**
 * The island as a dense voxel grid. World coordinates are metres with the island centred on
 * x = z = 0 and y = 0 at the bottom of the grid. Outside the grid horizontally is treated as
 * solid (invisible walls); below it is solid; above it is air.
 */
export class VoxelWorld {
  readonly data: Uint8Array;
  readonly originX: number;
  readonly originZ: number;

  constructor(
    readonly sx: number,
    readonly sy: number,
    readonly sz: number,
    readonly size: number,
  ) {
    this.data = new Uint8Array(sx * sy * sz);
    this.originX = (-sx * size) / 2;
    this.originZ = (-sz * size) / 2;
  }

  get halfExtentX(): number {
    return (this.sx * this.size) / 2;
  }

  get halfExtentZ(): number {
    return (this.sz * this.size) / 2;
  }

  index(ix: number, iy: number, iz: number): number {
    return (iy * this.sz + iz) * this.sx + ix;
  }

  inBounds(ix: number, iy: number, iz: number): boolean {
    return ix >= 0 && iy >= 0 && iz >= 0 && ix < this.sx && iy < this.sy && iz < this.sz;
  }

  get(ix: number, iy: number, iz: number): number {
    if (iy < 0) return Block.Stone;
    if (iy >= this.sy) return Block.Air;
    if (ix < 0 || iz < 0 || ix >= this.sx || iz >= this.sz) return Block.Air;
    return this.data[this.index(ix, iy, iz)];
  }

  set(ix: number, iy: number, iz: number, b: number): void {
    if (this.inBounds(ix, iy, iz)) this.data[this.index(ix, iy, iz)] = b;
  }

  // ---- Live edits (craters, smashed leaves, fire), tracked so views can rebuild and rounds reset.

  /** Render chunks ("cx,cy,cz", 16-cell chunks) changed since the view last rebuilt them. */
  readonly dirtyChunks = new Set<string>();
  private readonly touchedChunks = new Set<string>();
  private pristine: Uint8Array | null = null;

  /** Remembers the freshly generated island so later rounds can start from it again. */
  snapshot(): void {
    this.pristine = this.data.slice();
  }

  /** Undoes every live edit since the snapshot. */
  restore(): void {
    if (!this.pristine || this.touchedChunks.size === 0) return;
    this.data.set(this.pristine);
    for (const k of this.touchedChunks) this.dirtyChunks.add(k);
    this.touchedChunks.clear();
  }

  /** Changes one cell during play and marks its chunk (and neighbours it borders) for rebuilding. */
  edit(ix: number, iy: number, iz: number, b: number): boolean {
    if (!this.inBounds(ix, iy, iz)) return false;
    const i = this.index(ix, iy, iz);
    if (this.data[i] === b) return false;
    this.data[i] = b;
    const C = 16;
    const mark = (x: number, y: number, z: number) => {
      const k = `${x},${y},${z}`;
      this.dirtyChunks.add(k);
      this.touchedChunks.add(k);
    };
    const cx = Math.floor(ix / C), cy = Math.floor(iy / C), cz = Math.floor(iz / C);
    mark(cx, cy, cz);
    // Faces and ambient occlusion of the neighbouring chunk can change too.
    if (ix % C === 0) mark(cx - 1, cy, cz);
    if (ix % C === C - 1) mark(cx + 1, cy, cz);
    if (iy % C === 0) mark(cx, cy - 1, cz);
    if (iy % C === C - 1) mark(cx, cy + 1, cz);
    if (iz % C === 0) mark(cx, cy, cz - 1);
    if (iz % C === C - 1) mark(cx, cy, cz + 1);
    return true;
  }

  /** Solid for collision: any block, plus the walls around the grid. */
  solidCell(ix: number, iy: number, iz: number): boolean {
    if (iy < 0) return true;
    if (iy >= this.sy) return false;
    if (ix < 0 || iz < 0 || ix >= this.sx || iz >= this.sz) return true;
    return this.data[this.index(ix, iy, iz)] !== Block.Air;
  }

  ix(x: number): number {
    return Math.floor((x - this.originX) / this.size);
  }

  iy(y: number): number {
    return Math.floor(y / this.size);
  }

  iz(z: number): number {
    return Math.floor((z - this.originZ) / this.size);
  }

  /** Centre of a cell in metres. */
  cx(ix: number): number {
    return this.originX + (ix + 0.5) * this.size;
  }

  cz(iz: number): number {
    return this.originZ + (iz + 0.5) * this.size;
  }

  blockAt(x: number, y: number, z: number): number {
    return this.get(this.ix(x), this.iy(y), this.iz(z));
  }

  solidAt(x: number, y: number, z: number): boolean {
    return this.solidCell(this.ix(x), this.iy(y), this.iz(z));
  }

  /** Top surface (metres) of the highest block in the column, or 0. */
  surfaceHeight(x: number, z: number): number {
    const ix = this.ix(x), iz = this.iz(z);
    for (let iy = this.sy - 1; iy >= 0; iy--) if (this.get(ix, iy, iz) !== Block.Air) return (iy + 1) * this.size;
    return 0;
  }

  /** Top of the ground under a point (first air cell from the bottom), ignoring canopies above. */
  groundHeight(x: number, z: number): number {
    const ix = this.ix(x), iz = this.iz(z);
    for (let iy = 0; iy < this.sy; iy++) if (this.get(ix, iy, iz) === Block.Air) return iy * this.size;
    return this.sy * this.size;
  }

  /** Fill an axis-aligned box given in metres (min inclusive, max exclusive). */
  fillBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: number): void {
    const ax = this.ix(x0), ay = this.iy(y0), az = this.iz(z0);
    const bx = this.ix(x1 - 1e-6), by = this.iy(y1 - 1e-6), bz = this.iz(z1 - 1e-6);
    for (let iy = ay; iy <= by; iy++)
      for (let iz = az; iz <= bz; iz++) for (let ix = ax; ix <= bx; ix++) this.set(ix, iy, iz, b);
  }

  /**
   * Voxel ray march (Amanatides-Woo). Returns the distance to the first solid cell within
   * maxDist, or -1. Used by darts and the camera.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number {
    const s = this.size;
    let ix = this.ix(ox), iy = this.iy(oy), iz = this.iz(oz);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const nextBoundary = (o: number, origin: number, i: number, step: number) => origin + (i + (step > 0 ? 1 : 0)) * s - o;
    let tMaxX = dx !== 0 ? nextBoundary(ox, this.originX, ix, stepX) / dx : Infinity;
    let tMaxY = dy !== 0 ? nextBoundary(oy, 0, iy, stepY) / dy : Infinity;
    let tMaxZ = dz !== 0 ? nextBoundary(oz, this.originZ, iz, stepZ) / dz : Infinity;
    const tDeltaX = dx !== 0 ? Math.abs(s / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(s / dy) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(s / dz) : Infinity;
    let t = 0;
    for (let i = 0; i < 2048 && t <= maxDist; i++) {
      if (iy < this.sy && this.get(ix, iy, iz) !== Block.Air) return t;
      if (iy < 0) return t;
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        t = tMaxX;
        tMaxX += tDeltaX;
        ix += stepX;
      } else if (tMaxY < tMaxZ) {
        t = tMaxY;
        tMaxY += tDeltaY;
        iy += stepY;
      } else {
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        iz += stepZ;
      }
    }
    return -1;
  }
}
