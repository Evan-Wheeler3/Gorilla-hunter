import { config } from '../core/config';
import { Rng } from '../core/rng';
import { Block } from './blocks';
import { Noise2D } from './noise';
import { VoxelWorld } from './voxelWorld';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Dock {
  /** Centre of the delivery zone on the shore. */
  zone: Vec3;
  /** Unit vector pointing out to sea. */
  outX: number;
  outZ: number;
  name: string;
}

/** A vine hanging straight down: the gorilla grabs it anywhere and swings from the top. */
export interface Vine {
  x: number;
  z: number;
  /** Pivot height (just under the canopy), metres. */
  top: number;
  /** Lowest point of the vine, metres. */
  bottom: number;
}

export interface Island {
  world: VoxelWorld;
  seed: number;
  /** Vines hanging from the canopy. */
  vines: Vine[];
  docks: Dock[];
  hunterSpawns: Vec3[];
  gorillaSpawns: Vec3[];
  /** Practice spawns: everyone close together south of the temple. */
  practiceHunter: Vec3;
  practiceGorillas: Vec3[];
}

const W = config.world;
const WATER = W.waterLevel;
const ISLAND_RADIUS = 54;
const TEMPLE_HALF = 9;
const CAMP = { x: 0, z: -38 };
const NEST = { x: 0, z: 38 };
const PRACTICE = { x: 0, z: -20 };

const riverX = (z: number) => -26 + 5 * Math.sin(z / 14);

/** Builds the whole island deterministically from a seed. */
export function generateIsland(seed = 1234): Island {
  const world = new VoxelWorld(W.sizeX, W.sizeY, W.sizeZ, W.voxelSize);
  const rng = new Rng(seed);
  const noise = new Noise2D(rng.seed());
  const detail = new Noise2D(rng.seed());
  const s = world.size;

  // ---- Terrain heightmap -------------------------------------------------------------
  const heights = new Float32Array(world.sx * world.sz);
  const isSand = new Uint8Array(world.sx * world.sz);
  for (let iz = 0; iz < world.sz; iz++) {
    for (let ix = 0; ix < world.sx; ix++) {
      const x = world.cx(ix), z = world.cz(iz);
      const dist = Math.hypot(x, z);
      const angle = Math.atan2(z, x);
      const radius = ISLAND_RADIUS * (1 + 0.12 * noise.sample(Math.cos(angle) * 2 + 7, Math.sin(angle) * 2 + 7));
      const d = dist / radius;
      let h: number;
      if (d >= 1) {
        h = Math.max(0.5, WATER - 1.2 - (d - 1) * 6);
      } else {
        const land = 1 - d * d;
        h = WATER + 0.5 + land * 1.8 + Math.max(0, noise.fbm(x / 32, z / 32)) * 4.5 * land;
        // The gorilla nest in the north sits a little higher.
        h += Math.max(0, 1 - Math.hypot(x - NEST.x, z - NEST.z) / 22) * 1.5;
        // Flatten the temple plateau, the hunter camp and the practice clearing.
        h = flatten(h, x, z, 0, 0, TEMPLE_HALF + 3, WATER + 2);
        h = flatten(h, x, z, CAMP.x, CAMP.z, 10, WATER + 1.5);
        h = flatten(h, x, z, PRACTICE.x, PRACTICE.z, 7, WATER + 1.5);
        // River from shore to shore on the west side.
        const rd = Math.abs(x - riverX(z));
        if (rd < 3.5) h = Math.min(h, WATER - 0.8);
        else if (rd < 5) h = Math.min(h, WATER + 0.2 + (rd - 3.5) * 0.6);
      }
      heights[iz * world.sx + ix] = h;
      isSand[iz * world.sx + ix] = h < WATER + 1.1 ? 1 : 0;
    }
  }

  for (let iz = 0; iz < world.sz; iz++) {
    for (let ix = 0; ix < world.sx; ix++) {
      const k = iz * world.sx + ix;
      const top = Math.max(1, Math.round(heights[k] / s));
      const sand = isSand[k] === 1;
      for (let iy = 0; iy < top; iy++) {
        let b: Block;
        if (iy === top - 1) b = sand ? Block.Sand : Block.Grass;
        else if (iy >= top - 3) b = sand ? Block.Sand : Block.Dirt;
        else b = Block.Stone;
        world.set(ix, iy, iz, b);
      }
      // Speckle the grass with flowers.
      if (!sand && detail.sample(ix * 1.7, iz * 1.7) > 0.9) world.set(ix, top - 1, iz, Block.Flower);
    }
  }

  // ---- Structures ---------------------------------------------------------------------
  buildTemple(world, rng);
  const docks = buildDocks(world);
  buildCamp(world, rng);

  // ---- Trees, boulders ----------------------------------------------------------------
  const vines: Vine[] = [];
  const placed: { x: number; z: number }[] = [];
  const blocked = (x: number, z: number) =>
    Math.hypot(x, z) > ISLAND_RADIUS * 0.84 ||
    Math.abs(x - riverX(z)) < 6 ||
    (Math.abs(x) < TEMPLE_HALF + 4 && Math.abs(z) < TEMPLE_HALF + 4) ||
    Math.hypot(x - CAMP.x, z - CAMP.z) < 12 ||
    Math.hypot(x - PRACTICE.x, z - PRACTICE.z) < 9 ||
    docks.some((d) => Math.hypot(x - d.zone.x, z - d.zone.z) < 10);

  for (let attempt = 0; attempt < 4000 && placed.length < 95; attempt++) {
    const x = rng.range(-ISLAND_RADIUS, ISLAND_RADIUS), z = rng.range(-ISLAND_RADIUS, ISLAND_RADIUS);
    if (blocked(x, z)) continue;
    // Denser canopy in the north for the gorilla nest.
    const nestBias = z > 15 ? 1 : 0.55;
    if (rng.next() > nestBias) continue;
    // Wide gaps so the jungle floor stays runnable; the canopies still nearly touch overhead.
    const spacing = z > 15 ? 8.5 : 10.5;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < spacing)) continue;
    placed.push({ x, z });
    buildTree(world, rng, x, z, z > 15 ? 3 : 0, vines);
  }

  for (let i = 0; i < 16; i++) {
    const x = rng.range(-45, 45), z = rng.range(-45, 45);
    if (blocked(x, z) || placed.some((p) => Math.hypot(p.x - x, p.z - z) < 4)) continue;
    buildBoulder(world, rng, x, z);
  }

  const ground = (x: number, z: number): Vec3 => ({ x, y: world.surfaceHeight(x, z) + 0.05, z });
  return {
    world,
    seed,
    vines,
    docks,
    hunterSpawns: [-3, -1, 1, 3].map((dx) => ground(CAMP.x + dx, CAMP.z + 4)),
    gorillaSpawns: [-6, -2, 2, 6].map((dx) => ground(NEST.x + dx, NEST.z)),
    practiceHunter: ground(PRACTICE.x, PRACTICE.z - 5),
    practiceGorillas: [-4, 0, 4].map((dx) => ground(PRACTICE.x + dx, PRACTICE.z + 4 + Math.abs(dx) * 0.3)),
  };
}

function flatten(h: number, x: number, z: number, cx: number, cz: number, radius: number, target: number): number {
  const t = Math.max(0, 1 - Math.hypot(x - cx, z - cz) / radius);
  const k = Math.min(1, t * 2.5); // fully flat over the inner part, blended at the edge
  return h + (target - h) * k;
}

function buildTemple(world: VoxelWorld, rng: Rng): void {
  const floor = WATER + 2;
  const stone = () => (rng.next() < 0.22 ? Block.MossStone : Block.TempleStone);
  const put = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, solidChance = 1) => {
    const s = world.size;
    for (let y = y0; y < y1 - 1e-6; y += s)
      for (let z = z0; z < z1 - 1e-6; z += s)
        for (let x = x0; x < x1 - 1e-6; x += s)
          if (rng.next() < solidChance) world.set(world.ix(x + 1e-4), world.iy(y + 1e-4), world.iz(z + 1e-4), stone());
  };
  const H = TEMPLE_HALF;
  put(-H - 1, floor - 1, -H - 1, H + 1, floor, H + 1); // platform
  // Walls with doorways north and south.
  put(-H, floor, -H, H, floor + 4, -H + 1);
  put(-H, floor, H - 1, H, floor + 4, H);
  put(-H, floor, -H, -H + 1, floor + 4, H);
  put(H - 1, floor, -H, H, floor + 4, H);
  world.fillBox(-1.5, floor, -H, 1.5, floor + 3, -H + 1, Block.Air);
  world.fillBox(-1.5, floor, H - 1, 1.5, floor + 3, H, Block.Air);
  // Corner pillars, broken roof, inner altar.
  for (const [px, pz] of [[-H, -H], [H - 1.5, -H], [-H, H - 1.5], [H - 1.5, H - 1.5]]) put(px, floor, pz, px + 1.5, floor + 6, pz + 1.5);
  put(-H, floor + 4, -H, H, floor + 4.5, H, 0.75);
  put(-2, floor, -2, 2, floor + 1, 2);
  // Steps up to the south door.
  for (let i = 0; i < 4; i++) put(-2, floor - 1 - i * 0.5, -H - 1.5 - i, 2, floor - 0.5 - i * 0.5, -H - 0.5 - i);
}

function buildDocks(world: VoxelWorld): Dock[] {
  const docks: Dock[] = [];
  const dirs: [number, number, string][] = [
    [1, 0, 'East boat'],
    [0, 1, 'North boat'],
    [-1, 0, 'West boat'],
    [0.35, -0.94, 'South boat'],
  ];
  for (const [rawX, rawZ, name] of dirs) {
    const len = Math.hypot(rawX, rawZ);
    const ox = rawX / len, oz = rawZ / len;
    // March out from the centre to the shoreline.
    let r = 20;
    while (r < 63 && world.surfaceHeight(ox * r, oz * r) > WATER + 0.3) r += 0.5;
    const shoreX = ox * r, shoreZ = oz * r;
    const zone = { x: shoreX - ox * 2, y: 0, z: shoreZ - oz * 2 };
    zone.y = world.surfaceHeight(zone.x, zone.z);

    // Pier: planks from just inland out over the water, on posts.
    const deck = WATER + 0.5;
    const sideX = -oz, sideZ = ox;
    for (let t = -3; t <= 12; t += 0.25) {
      for (let w = -1.25; w <= 1.25; w += 0.25) {
        const x = shoreX + ox * t + sideX * w, z = shoreZ + oz * t + sideZ * w;
        const top = world.surfaceHeight(x, z);
        if (top <= deck + 0.5) world.fillBox(x - 0.01, deck, z - 0.01, x + 0.01, deck + 0.5, z + 0.01, Block.Plank);
        if (Math.abs(w) > 1.1 && Math.abs(t % 3) < 0.25 && t > 0)
          world.fillBox(x - 0.01, 0, z - 0.01, x + 0.01, deck, z + 0.01, Block.Plank);
      }
    }
    // Boat moored alongside the end of the pier.
    const bx = shoreX + ox * 10 + sideX * 3.5, bz = shoreZ + oz * 10 + sideZ * 3.5;
    for (let t = -4; t <= 4; t += 0.25) {
      const halfBeam = 1.6 * Math.sqrt(Math.max(0, 1 - (t / 4.6) ** 2));
      for (let w = -halfBeam; w <= halfBeam; w += 0.25) {
        const x = bx + ox * t + sideX * w, z = bz + oz * t + sideZ * w;
        const edge = Math.abs(w) > halfBeam - 0.5;
        world.fillBox(x - 0.01, WATER - 0.5, z - 0.01, x + 0.01, edge ? WATER + 1.5 : WATER, z + 0.01, Block.Hull);
        if (t > 0.5 && t < 2.8 && Math.abs(w) < 1) world.fillBox(x - 0.01, WATER, z - 0.01, x + 0.01, WATER + 2.5, z + 0.01, Block.Cloth);
      }
    }
    docks.push({ zone, outX: ox, outZ: oz, name });
  }
  return docks;
}

function buildCamp(world: VoxelWorld, rng: Rng): void {
  const base = WATER + 1.5;
  // Two tents (stepped A-frames), crates and a fire ring.
  for (const [tx, tz] of [[-5, -42], [5, -43]]) {
    for (let level = 0; level < 4; level++) {
      const half = 1.75 - level * 0.5;
      world.fillBox(tx - half, base + level * 0.5, tz - 1.5, tx + half, base + level * 0.5 + 0.5, tz + 1.5, Block.Cloth);
    }
    world.fillBox(tx - 0.5, base, tz - 1.5, tx + 0.5, base + 1, tz - 1, 0);
  }
  for (let i = 0; i < 5; i++) {
    const x = -6 + i * 3 + rng.range(-0.5, 0.5), z = -33 + rng.range(-1, 1);
    world.fillBox(x, base, z, x + 1, base + (i % 2 === 0 ? 1 : 0.5), z + 1, Block.Crate);
  }
  for (let a = 0; a < 8; a++) {
    const x = Math.cos((a / 8) * Math.PI * 2) * 1.2, z = -38 + Math.sin((a / 8) * Math.PI * 2) * 1.2;
    world.fillBox(x, base, z, x + 0.5, base + 0.5, z + 0.5, Block.Rock);
  }
}

function buildTree(world: VoxelWorld, rng: Rng, x: number, z: number, extra: number, vines: Vine[]): void {
  const s = world.size;
  const ground = world.surfaceHeight(x, z);
  if (ground < WATER + 0.6) return;
  const height = rng.range(13, 19) + extra;
  const tx = Math.floor(x / s) * s, tz = Math.floor(z / s) * s;
  const cx = tx + 0.75, cz = tz + 0.75; // trunk centre (1.5 m wide trunk)
  world.fillBox(tx, ground, tz, tx + 1.5, ground + height, tz + 1.5, Block.Wood);
  // Root flare so the big trunks sit in the ground.
  world.fillBox(tx - 0.5, ground, tz - 0.5, tx + 2, ground + 0.5, tz + 2, Block.Wood);

  // Leafy crown: a broad, squashed, noisy ellipsoid around the trunk top.
  const rx = rng.range(3.8, 5.2), ry = rng.range(2, 2.8);
  const cy = ground + height;
  const leaf = rng.next() < 0.5 ? Block.Leaves : Block.LeavesDark;
  const other = leaf === Block.Leaves ? Block.LeavesDark : Block.Leaves;
  for (let dy = -ry; dy <= ry; dy += s)
    for (let dz = -rx; dz <= rx; dz += s)
      for (let dx = -rx; dx <= rx; dx += s) {
        const e = (dx * dx + dz * dz) / (rx * rx) + (dy * dy) / (ry * ry);
        if (e < 1 - rng.next() * 0.3)
          world.set(world.ix(cx + dx), world.iy(cy + dy), world.iz(cz + dz), rng.next() < 0.25 ? other : leaf);
      }

  // Side branches with leafy pads: perches halfway up.
  const branches = 1 + rng.int(3);
  for (let i = 0; i < branches; i++) {
    const y = ground + Math.max(6.5, height * rng.range(0.45, 0.75)); // above head height
    const angle = rng.int(4) * (Math.PI / 2);
    const bx = Math.round(Math.cos(angle)), bz = Math.round(Math.sin(angle));
    for (let t = 0.75; t <= 3.5; t += s) world.set(world.ix(cx + bx * t), world.iy(y), world.iz(cz + bz * t), Block.Wood);
    const ex = cx + bx * 4, ez = cz + bz * 4;
    world.fillBox(ex - 1.25, y, ez - 1.25, ex + 1.25, y + 1, ez + 1.25, rng.next() < 0.5 ? leaf : other);
  }

  // Long vines hanging from the underside of the crown almost to the ground.
  const a0 = rng.next() * Math.PI * 2;
  const count = 3 + rng.int(2);
  for (let i = 0; i < count; i++) {
    const a = a0 + (i / count) * Math.PI * 2;
    const vx = cx + Math.cos(a) * rx * 0.65, vz = cz + Math.sin(a) * rx * 0.65;
    let top = cy;
    while (top > ground + 5 && world.solidAt(vx, top, vz)) top -= s;
    if (top <= ground + 5) continue;
    let bottom = top;
    const lowest = world.groundHeight(vx, vz) + rng.range(2.4, 3.4);
    while (bottom - s > lowest && !world.solidAt(vx, bottom - s, vz)) bottom -= s;
    // Skip vines blocked by a branch partway down: they would end out of reach.
    if (top - bottom < 4 || bottom > lowest + 1) continue;
    vines.push({ x: vx, z: vz, top, bottom });
  }
}

function buildBoulder(world: VoxelWorld, rng: Rng, x: number, z: number): void {
  const ground = world.surfaceHeight(x, z);
  const r = rng.range(0.9, 1.6);
  const s = world.size;
  for (let dy = 0; dy <= r; dy += s)
    for (let dz = -r; dz <= r; dz += s)
      for (let dx = -r; dx <= r; dx += s)
        if (dx * dx + dz * dz + dy * dy * 1.6 < r * r * (0.85 + rng.next() * 0.3))
          world.set(world.ix(x + dx), world.iy(ground - 0.25 + dy), world.iz(z + dz), Block.Rock);
}
