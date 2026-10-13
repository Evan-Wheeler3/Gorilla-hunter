import * as THREE from 'three';

/** Returns a colour (0xRRGGBB) for a filled voxel, or null for empty. */
export type VoxelFill = (x: number, y: number, z: number) => number | null;

type V3 = [number, number, number];
// Normal, then in-plane axes u, v with u x v = normal (counter-clockwise seen from outside).
const FACES: { n: V3; u: V3; v: V3 }[] = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];

const tmp = new THREE.Color();

function hash(x: number, y: number, z: number): number {
  let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 0xff) / 255;
}

/**
 * Builds a mesh geometry from a small voxel grid (nx * ny * nz cells of voxelSize metres).
 * Interior faces are culled; each voxel gets a slight colour jitter for a hand-made look.
 * `origin` is the grid cell placed at the part's pivot (local 0,0,0).
 */
export function buildVoxelPart(
  nx: number,
  ny: number,
  nz: number,
  voxelSize: number,
  fill: VoxelFill,
  origin: [number, number, number],
  jitter = 0.07,
): THREE.BufferGeometry {
  const colors = new Array<number | null>(nx * ny * nz);
  const at = (x: number, y: number, z: number) =>
    x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? null : colors[(y * nz + z) * nx + x];
  for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) colors[(y * nz + z) * nx + x] = fill(x, y, z);

  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  for (let y = 0; y < ny; y++)
    for (let z = 0; z < nz; z++)
      for (let x = 0; x < nx; x++) {
        const c = at(x, y, z);
        if (c === null) continue;
        tmp.setHex(c, THREE.SRGBColorSpace);
        const j = 1 + (hash(x, y, z) - 0.5) * 2 * jitter;
        const r = tmp.r * j, g = tmp.g * j, b = tmp.b * j;
        for (const { n, u, v } of FACES) {
          const [dx, dy, dz] = n;
          if (at(x + dx, y + dy, z + dz) !== null) continue;
          const cx = x + 0.5 + dx * 0.5, cy = y + 0.5 + dy * 0.5, cz = z + 0.5 + dz * 0.5;
          const start = pos.length / 3;
          for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            pos.push(
              (cx + (u[0] * su + v[0] * sv) * 0.5 - origin[0]) * voxelSize,
              (cy + (u[1] * su + v[1] * sv) * 0.5 - origin[1]) * voxelSize,
              (cz + (u[2] * su + v[2] * sv) * 0.5 - origin[2]) * voxelSize,
            );
            nor.push(dx, dy, dz);
            col.push(r, g, b);
          }
          idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
        }
      }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

/** Rounded-box fill helper: a box with optionally chamfered edges. */
export function inRoundedBox(x: number, y: number, z: number, nx: number, ny: number, nz: number, chamfer = 1): boolean {
  const ex = x < chamfer || x >= nx - chamfer;
  const ey = y < chamfer || y >= ny - chamfer;
  const ez = z < chamfer || z >= nz - chamfer;
  return !((ex && ey) || (ey && ez) || (ex && ez));
}
