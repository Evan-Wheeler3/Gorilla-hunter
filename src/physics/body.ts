import type { VoxelWorld } from '../world/voxelWorld';

/** A character's collision box: feet centre (x, y, z), half width and height. */
export interface Body {
  x: number;
  y: number;
  z: number;
  halfWidth: number;
  height: number;
  onGround: boolean;
}

export interface MoveResult {
  hitX: boolean;
  hitY: boolean;
  hitZ: boolean;
}

const EPS = 0.001;
const MAX_STEP = 0.2; // longest sub-step, so fast bodies cannot tunnel through a voxel

/** True if the body's box at (x, y, z) overlaps any solid voxel. */
export function overlaps(world: VoxelWorld, x: number, y: number, z: number, hw: number, h: number): boolean {
  const x0 = world.ix(x - hw + EPS), x1 = world.ix(x + hw - EPS);
  const y0 = world.iy(y + EPS), y1 = world.iy(y + h - EPS);
  const z0 = world.iz(z - hw + EPS), z1 = world.iz(z + hw - EPS);
  for (let iy = y0; iy <= y1; iy++)
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) if (world.solidCell(ix, iy, iz)) return true;
  return false;
}

/**
 * Moves a body by (dx, dy, dz) against the voxel world, axis by axis in small sub-steps.
 * Horizontal moves on the ground (or anywhere, with stepInAir) climb ledges up to stepHeight automatically.
 */
export function moveBody(world: VoxelWorld, body: Body, dx: number, dy: number, dz: number, stepHeight = 0, stepInAir = false): MoveResult {
  const result: MoveResult = { hitX: false, hitY: false, hitZ: false };
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / MAX_STEP));
  const sx = dx / steps, sy = dy / steps, sz = dz / steps;
  const wasGrounded = body.onGround;
  body.onGround = false;

  for (let i = 0; i < steps; i++) {
    if (sy !== 0) {
      const moved = moveAxis(world, body, 1, sy);
      if (moved !== sy) {
        result.hitY = true;
        if (sy < 0) body.onGround = true;
      }
    }
    const canStep = stepHeight > 0 && (stepInAir || wasGrounded || body.onGround);
    if (sx !== 0 && moveAxisWithStep(world, body, 0, sx, canStep ? stepHeight : 0) !== sx) result.hitX = true;
    if (sz !== 0 && moveAxisWithStep(world, body, 2, sz, canStep ? stepHeight : 0) !== sz) result.hitZ = true;
  }

  // Stay grounded when standing still or walking along flat ground.
  if (!body.onGround && dy <= 0 && overlaps(world, body.x, body.y - 0.02, body.z, body.halfWidth, body.height))
    body.onGround = true;
  return result;
}

function moveAxisWithStep(world: VoxelWorld, body: Body, axis: 0 | 2, d: number, stepHeight: number): number {
  const moved = moveAxis(world, body, axis, d);
  if (moved === d || stepHeight <= 0) return moved;

  // Blocked: try stepping up onto the ledge in voxel-sized increments.
  const remaining = d - moved;
  const s = world.size;
  for (let lift = s; lift <= stepHeight + EPS; lift += s) {
    const nx = axis === 0 ? body.x + remaining : body.x;
    const nz = axis === 2 ? body.z + remaining : body.z;
    if (
      !overlaps(world, body.x, body.y + lift, body.z, body.halfWidth, body.height) &&
      !overlaps(world, nx, body.y + lift, nz, body.halfWidth, body.height)
    ) {
      body.y += lift;
      body.x = nx;
      body.z = nz;
      return d;
    }
  }
  return moved;
}

/** Moves along one axis; returns the distance actually moved (bisects to the contact point). */
function moveAxis(world: VoxelWorld, body: Body, axis: 0 | 1 | 2, d: number): number {
  const at = (t: number) =>
    overlaps(
      world,
      axis === 0 ? body.x + t : body.x,
      axis === 1 ? body.y + t : body.y,
      axis === 2 ? body.z + t : body.z,
      body.halfWidth,
      body.height,
    );
  let allowed = d;
  if (at(d)) {
    let lo = 0, hi = d;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid)) hi = mid;
      else lo = mid;
    }
    allowed = lo;
  }
  if (axis === 0) body.x += allowed;
  else if (axis === 1) body.y += allowed;
  else body.z += allowed;
  return allowed;
}
