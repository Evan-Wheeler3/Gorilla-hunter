import { describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { Block } from '../src/world/blocks';
import { generateIsland } from '../src/world/island';
import { CHUNK, meshChunk } from '../src/world/mesher';
import { VoxelWorld } from '../src/world/voxelWorld';

describe('island', () => {
  const island = generateIsland(1234);
  const { world } = island;

  it('has land, trees, vine anchors and four docks', () => {
    expect(world.surfaceHeight(0, 0)).toBeGreaterThan(config.world.waterLevel);
    expect(world.surfaceHeight(63, 63)).toBeLessThan(config.world.waterLevel);
    let wood = 0;
    for (let i = 0; i < world.data.length; i++) if (world.data[i] === Block.Wood) wood++;
    expect(wood).toBeGreaterThan(1000);
    expect(island.anchors.length).toBeGreaterThan(60);
    expect(island.docks.length).toBe(4);
  });

  it('spawns everyone on solid ground with headroom', () => {
    for (const p of [island.practiceHunter, ...island.practiceGorillas, ...island.hunterSpawns, ...island.gorillaSpawns]) {
      expect(world.solidAt(p.x, p.y - 0.2, p.z)).toBe(true);
      expect(world.solidAt(p.x, p.y + 1, p.z)).toBe(false);
    }
  });

  it('every point on the island is within dragging reach of a boat', () => {
    // 15 s knockout at 40% speed while dragged = 37.5 s; sprint 6.5 m/s with a 15% detour allowance.
    const window = config.sedation.collapseSeconds / config.sedation.draggedDowntimeRate;
    let worst = 0;
    for (let x = -60; x <= 60; x += 2)
      for (let z = -60; z <= 60; z += 2) {
        if (world.surfaceHeight(x, z) < config.world.waterLevel) continue;
        worst = Math.max(worst, Math.min(...island.docks.map((d) => Math.hypot(d.zone.x - x, d.zone.z - z))));
      }
    expect((worst * 1.15) / config.hunter.sprintSpeed).toBeLessThan(window);
  });

  it('is deterministic', () => {
    const checksum = (d: Uint8Array) => d.reduce((h, v, i) => (h * 31 + v * (i % 97)) >>> 0, 7);
    expect(checksum(generateIsland(1234).world.data)).toBe(checksum(world.data));
  });
});

describe('voxel world', () => {
  it('raycasts to the first solid cell', () => {
    const w = new VoxelWorld(16, 16, 16, 0.5);
    w.fillBox(-4, 0, -4, 4, 1, 4, Block.Stone);
    expect(w.raycast(0, 5, 0, 0, -1, 0, 20)).toBeCloseTo(4, 3);
    expect(w.raycast(0, 5, 0, 0, 1, 0, 20)).toBe(-1);
  });

  it('meshes only exposed faces, wound outward', () => {
    const w = new VoxelWorld(CHUNK, CHUNK, CHUNK, 1);
    w.set(5, 5, 5, Block.Stone);
    const m = meshChunk(w, 0, 0, 0)!;
    expect(m.indices.length).toBe(6 * 6);
    // Each triangle's geometric normal must match the stored face normal.
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
      const v = (i: number) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
      const [pa, pb, pc] = [v(a), v(b), v(c)];
      const e1 = pb.map((x, i) => x - pa[i]), e2 = pc.map((x, i) => x - pa[i]);
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const stored = [m.normals[a * 3], m.normals[a * 3 + 1], m.normals[a * 3 + 2]];
      expect(n[0] * stored[0] + n[1] * stored[1] + n[2] * stored[2]).toBeGreaterThan(0);
    }
    w.set(6, 5, 5, Block.Stone);
    expect(meshChunk(w, 0, 0, 0)!.indices.length).toBe(10 * 6);
  });
});
