import { Block, blockInfo } from './blocks';
import type { VoxelWorld } from './voxelWorld';

export const CHUNK = 16;

export interface ChunkMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** 1 for foliage vertices that sway in the wind, else 0. */
  sway: Float32Array;
  indices: Uint32Array;
}

// Face directions: normal, then the two in-plane axes (u, v) that span the face.
const FACES = [
  // u x v must equal the normal so the quads wind counter-clockwise when seen from outside.
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], shade: 0.8 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], shade: 0.8 },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0], shade: 1 },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], shade: 0.55 },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], shade: 0.9 },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0], shade: 0.9 },
] as const;

const AO_LEVELS = [0.5, 0.68, 0.84, 1];

/** Deterministic per-voxel hash in [-1, 1] for colour jitter. */
function hash3(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 0xffff) / 32767.5 - 1;
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/**
 * Builds one chunk's visible faces with per-vertex ambient occlusion and per-voxel colour
 * jitter. Returns null for empty chunks.
 */
export function meshChunk(world: VoxelWorld, cx: number, cy: number, cz: number): ChunkMesh | null {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], sw: number[] = [], idx: number[] = [];
  const s = world.size;
  const solid = (x: number, y: number, z: number) => world.get(x, y, z) !== Block.Air;

  for (let y = cy * CHUNK; y < Math.min(world.sy, (cy + 1) * CHUNK); y++)
    for (let z = cz * CHUNK; z < Math.min(world.sz, (cz + 1) * CHUNK); z++)
      for (let x = cx * CHUNK; x < Math.min(world.sx, (cx + 1) * CHUNK); x++) {
        const b = world.get(x, y, z);
        if (b === Block.Air) continue;
        const info = blockInfo(b);
        const j = 1 + info.jitter * hash3(x, y, z);
        const sways = b === Block.Leaves || b === Block.LeavesDark || b === Block.BurntLeaves ? 1 : 0;

        for (const f of FACES) {
          const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
          if (solid(nx, ny, nz)) continue;
          if (ny < 0) continue;

          // Corners of the unit face in voxel space, ordered (-u,-v), (+u,-v), (+u,+v), (-u,+v).
          const base = [x + 0.5 + f.n[0] * 0.5, y + 0.5 + f.n[1] * 0.5, z + 0.5 + f.n[2] * 0.5];
          const corners = [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ];
          const ao: number[] = [];
          const start = pos.length / 3;
          for (const [cu, cv] of corners) {
            const px = base[0] + (f.u[0] * cu + f.v[0] * cv) * 0.5;
            const py = base[1] + (f.u[1] * cu + f.v[1] * cv) * 0.5;
            const pz = base[2] + (f.u[2] * cu + f.v[2] * cv) * 0.5;
            pos.push(world.originX + px * s, py * s, world.originZ + pz * s);
            nor.push(f.n[0], f.n[1], f.n[2]);
            sw.push(sways);

            // Ambient occlusion from the three neighbours touching this corner on the open side.
            const s1 = solid(nx + f.u[0] * cu, ny + f.u[1] * cu, nz + f.u[2] * cu) ? 1 : 0;
            const s2 = solid(nx + f.v[0] * cv, ny + f.v[1] * cv, nz + f.v[2] * cv) ? 1 : 0;
            const c = solid(nx + f.u[0] * cu + f.v[0] * cv, ny + f.u[1] * cu + f.v[1] * cv, nz + f.u[2] * cu + f.v[2] * cv) ? 1 : 0;
            const level = s1 && s2 ? 0 : 3 - (s1 + s2 + c);
            ao.push(level);
            const k = f.shade * AO_LEVELS[level] * j;
            col.push(
              srgbToLinear(Math.min(1, info.color[0] * k)),
              srgbToLinear(Math.min(1, info.color[1] * k)),
              srgbToLinear(Math.min(1, info.color[2] * k)),
            );
          }
          // Flip the quad's diagonal so AO interpolates without the classic seam.
          if (ao[0] + ao[2] > ao[1] + ao[3]) idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
          else idx.push(start + 1, start + 2, start + 3, start + 1, start + 3, start);
        }
      }

  if (idx.length === 0) return null;
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    colors: new Float32Array(col),
    sway: new Float32Array(sw),
    indices: new Uint32Array(idx),
  };
}
