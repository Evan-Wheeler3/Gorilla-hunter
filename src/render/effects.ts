import * as THREE from 'three';
import type { FinisherPick } from '../core/finishers';
import { Rng } from '../core/rng';
import type { Dart } from '../game/match';
import type { VoxelWorld } from '../world/voxelWorld';
import { GORE_COLORS, HEAD_COLORS, HUNTER_DEBRIS_COLORS } from './characters';

const GORE = new Set(GORE_COLORS);

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  spin: number;
  size: number;
  life: number;
  maxLife: number;
  color: THREE.Color;
  bounce: number;
  gravity: number;
  /** Gore cubes can splat flat on the ground and linger. */
  gore: boolean;
  flat: boolean;
}

/** Sprays gore from a point on a moving body part (a stump) for a while. */
interface Fountain {
  obj: THREE.Object3D;
  local: THREE.Vector3;
  dir: THREE.Vector3;
  until: number;
  speed: number;
  rate: number;
  carry: number;
}

const MAX_PARTICLES = 2500;

/** A detached body part (or a whole body) flying as a rigid piece. */
interface Chunk {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  maxLife: number;
  /** Burst into cubes of these colours on the first hard impact (or when the fuse runs out). */
  burstColors: number[] | null;
  fuse: number;
  radius: number;
  /** Leaves a trail of gore cubes while flying. */
  trail: boolean;
  baseScale: THREE.Vector3;
}

/**
 * Pooled voxel particles (kill debris, dust, dart puffs, slap stars, conversion confetti) plus
 * dart meshes. Everything is one instanced draw call, so it stays cheap on phones.
 */
export class Effects {
  private readonly cubes: THREE.InstancedMesh;
  private readonly particles: Particle[] = [];
  private readonly dartMeshes: THREE.Mesh[] = [];
  private readonly dartGeo = new THREE.BoxGeometry(0.06, 0.06, 0.4);
  private readonly dartMat = new THREE.MeshLambertMaterial({ color: 0xff4fa0, emissive: 0x551030 });
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly sv = new THREE.Vector3();
  private readonly chunks: Chunk[] = [];
  private readonly fountains: Fountain[] = [];
  private clock = 0;
  private readonly tmpQ = new THREE.Quaternion();
  /** Camera shake strength, decays over time. */
  shake = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: VoxelWorld,
  ) {
    this.cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), MAX_PARTICLES);
    this.cubes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cubes.castShadow = true;
    this.cubes.frustumCulled = false;
    this.cubes.count = 0;
    // Allocate the per-instance colour buffer up front.
    this.cubes.setColorAt(0, new THREE.Color());
    scene.add(this.cubes);
  }

  private spawn(p: Partial<Omit<Particle, 'color'>> & { x: number; y: number; z: number; color: number | THREE.Color }): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    const life = p.life ?? 6;
    this.particles.push({
      vx: 0,
      vy: 0,
      vz: 0,
      rx: Math.random() * 6,
      ry: Math.random() * 6,
      spin: (Math.random() - 0.5) * 12,
      size: 0.12,
      bounce: 0.35,
      gravity: 20,
      maxLife: life,
      gore: typeof p.color === 'number' && GORE.has(p.color),
      flat: false,
      ...p,
      life,
      color: p.color instanceof THREE.Color ? p.color : new THREE.Color(p.color),
    });
  }

  /**
   * A hunter bursts into voxel chunks. Each finisher throws the pieces its own way, seeded so
   * every player sees the same result.
   */
  hunterKilled(at: { x: number; y: number; z: number }, gorillaYaw: number, pick: FinisherPick): void {
    const rng = new Rng(pick.seed);
    const fx = Math.sin(gorillaYaw), fz = Math.cos(gorillaYaw);
    const sx = -fz, sz = fx; // sideways
    const id = pick.finisher.id;
    const count = id === 'drum_solo' ? 160 : 110;
    for (let i = 0; i < count; i++) {
      const color = HUNTER_DEBRIS_COLORS[rng.int(HUNTER_DEBRIS_COLORS.length)];
      const h = rng.range(0, 1.8);
      let vx = rng.range(-3, 3), vy = rng.range(2, 7), vz = rng.range(-3, 3);
      switch (id) {
        case 'rip_in_half': {
          const side = i % 2 === 0 ? 1 : -1;
          vx = sx * side * rng.range(5, 9) + fx * 2;
          vz = sz * side * rng.range(5, 9) + fz * 2;
          vy = rng.range(3, 6);
          break;
        }
        case 'head_pop':
        case 'head_clap':
          if (h > 1.3) vy = rng.range(10, 16);
          break;
        case 'twirl_and_throw':
          vx = fx * rng.range(12, 18) + rng.range(-1, 1);
          vz = fz * rng.range(12, 18) + rng.range(-1, 1);
          vy = rng.range(8, 12);
          break;
        case 'crumple_ball':
          vx = fx * rng.range(6, 8);
          vz = fz * rng.range(6, 8);
          vy = rng.range(0, 2);
          break;
        case 'ragdoll_slam':
          vy = rng.range(-2, 1);
          vx = rng.range(-8, 8);
          vz = rng.range(-8, 8);
          break;
        case 'drum_solo':
          vy = rng.range(6, 15);
          vx = rng.range(-6, 6);
          vz = rng.range(-6, 6);
          break;
      }
      this.spawn({
        x: at.x + rng.range(-0.3, 0.3),
        y: at.y + h,
        z: at.z + rng.range(-0.3, 0.3),
        vx,
        vy,
        vz,
        size: rng.range(0.14, 0.32),
        color,
        life: rng.range(5, 8),
      });
    }
    this.shake = Math.max(this.shake, 0.6);
  }

  /**
   * Detaches a body part into the world (keeping where it is) and lets it fly. With burstColors
   * it explodes into cubes when it slams into the ground, or when `fuse` seconds run out.
   */
  addChunk(obj: THREE.Object3D, vel: THREE.Vector3, spin: THREE.Vector3, opts: { life?: number; burstColors?: number[]; fuse?: number; radius?: number; trail?: boolean } = {}): void {
    this.scene.attach(obj);
    const life = opts.life ?? 6;
    this.chunks.push({
      obj,
      vel: vel.clone(),
      spin: spin.clone(),
      life,
      maxLife: life,
      burstColors: opts.burstColors ?? null,
      fuse: opts.fuse ?? Infinity,
      radius: opts.radius ?? 0.15,
      trail: opts.trail ?? true,
      baseScale: obj.scale.clone(),
    });
  }

  /**
   * A gore fountain from a stump: `local` is the point on `obj`, `dir` the spray direction in the
   * object's own space. Keeps spraying as the part moves or flies.
   */
  fountain(obj: THREE.Object3D, local: THREE.Vector3, dir: THREE.Vector3, duration: number, speed = 5, rate = 70): void {
    this.fountains.push({ obj, local: local.clone(), dir: dir.clone().normalize(), until: this.clock + duration, speed, rate, carry: 0 });
  }

  private updateFountains(dt: number): void {
    const p = new THREE.Vector3(), d = new THREE.Vector3(), q = new THREE.Quaternion();
    for (let i = this.fountains.length - 1; i >= 0; i--) {
      const f = this.fountains[i];
      if (this.clock > f.until || !f.obj.parent) {
        this.fountains.splice(i, 1);
        continue;
      }
      f.obj.updateWorldMatrix(true, false);
      f.obj.localToWorld(p.copy(f.local));
      d.copy(f.dir).applyQuaternion(f.obj.getWorldQuaternion(q));
      // Pulses, like a heartbeat, and weakens over time.
      const left = (f.until - this.clock) / 1.5;
      const pulse = 0.6 + 0.4 * Math.max(0, Math.sin(this.clock * 14));
      f.carry += f.rate * dt * pulse;
      while (f.carry >= 1) {
        f.carry -= 1;
        const sp = f.speed * (0.6 + Math.random() * 0.6) * Math.min(1, 0.4 + left);
        this.spawn({
          x: p.x,
          y: p.y,
          z: p.z,
          vx: d.x * sp + (Math.random() - 0.5) * 1.5,
          vy: d.y * sp + (Math.random() - 0.5) * 1.5,
          vz: d.z * sp + (Math.random() - 0.5) * 1.5,
          size: 0.07 + Math.random() * 0.08,
          color: GORE_COLORS[(Math.random() * GORE_COLORS.length) | 0],
          life: 3 + Math.random() * 4,
        });
      }
    }
  }

  /** A spray of voxel cubes from a point; `dir` biases the spray. */
  /** Speed lines streaming off a dashing body. */
  streak(at: { x: number; y: number; z: number }, vx: number, vz: number): void {
    for (let i = 0; i < 3; i++)
      this.spawn({
        x: at.x + (Math.random() - 0.5) * 1.2,
        y: at.y + 0.3 + Math.random() * 2.2,
        z: at.z + (Math.random() - 0.5) * 1.2,
        vx: -vx * 0.25,
        vy: 0,
        vz: -vz * 0.25,
        size: 0.09,
        color: 0xf2f2f2,
        life: 0.3,
        gravity: 0,
      });
  }

  /** Called for every sizeable spray of gore (the game plays a splat). */
  onGore: (at: { x: number; y: number; z: number }, count: number) => void = () => {};

  burst(at: { x: number; y: number; z: number }, colors: number[], count: number, speed: number, dir?: { x: number; y: number; z: number }, size = 0.16): void {
    if (count >= 10 && (colors === GORE_COLORS || colors === HEAD_COLORS || colors === HUNTER_DEBRIS_COLORS)) this.onGore(at, count);
    for (let i = 0; i < count; i++) {
      const color = colors[(Math.random() * colors.length) | 0];
      this.spawn({
        x: at.x + (Math.random() - 0.5) * 0.3,
        y: at.y + (Math.random() - 0.5) * 0.3,
        z: at.z + (Math.random() - 0.5) * 0.3,
        vx: (Math.random() - 0.5) * speed + (dir?.x ?? 0),
        vy: Math.random() * speed * 0.8 + (dir?.y ?? 2),
        vz: (Math.random() - 0.5) * speed + (dir?.z ?? 0),
        size: size * (0.6 + Math.random() * 0.8),
        color,
        life: 4 + Math.random() * 3,
      });
    }
  }

  dartHit(at: { x: number; y: number; z: number }, onGorilla: boolean): void {
    for (let i = 0; i < (onGorilla ? 18 : 6); i++)
      this.spawn({
        x: at.x,
        y: at.y,
        z: at.z,
        vx: (Math.random() - 0.5) * 4,
        vy: Math.random() * 4,
        vz: (Math.random() - 0.5) * 4,
        size: 0.07,
        color: onGorilla ? 0xff6fb5 : 0xd9cfae,
        life: 0.8,
        gravity: 8,
      });
  }

  knockout(at: { x: number; y: number; z: number }): void {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      this.spawn({ x: at.x, y: at.y + 0.3, z: at.z, vx: Math.cos(a) * 5, vy: 1.5, vz: Math.sin(a) * 5, size: 0.14, color: 0xcfc2a5, life: 0.9, gravity: 4 });
    }
    this.shake = Math.max(this.shake, 0.25);
  }

  slap(at: { x: number; y: number; z: number }): void {
    for (let i = 0; i < 10; i++)
      this.spawn({
        x: at.x,
        y: at.y + 1,
        z: at.z,
        vx: (Math.random() - 0.5) * 5,
        vy: 3 + Math.random() * 3,
        vz: (Math.random() - 0.5) * 5,
        size: 0.13,
        color: 0xfff27a,
        life: 0.7,
        gravity: 6,
      });
  }

  /** Little "z" puffs over a knocked-out gorilla. */
  sleepPuff(at: { x: number; y: number; z: number }): void {
    this.spawn({ x: at.x + (Math.random() - 0.5), y: at.y + 1.2, z: at.z, vy: 0.8, vx: 0.3, size: 0.12, color: 0xffffff, life: 1.4, gravity: -0.2 });
  }

  confetti(at: { x: number; y: number; z: number }): void {
    const colors = [0xffd34d, 0xff6a13, 0x6fd3ff, 0xff4fa0, 0x8cff6a];
    for (let i = 0; i < 80; i++)
      this.spawn({
        x: at.x,
        y: at.y + 1,
        z: at.z,
        vx: (Math.random() - 0.5) * 8,
        vy: 6 + Math.random() * 8,
        vz: (Math.random() - 0.5) * 8,
        size: 0.1,
        color: colors[i % colors.length],
        life: 3,
        gravity: 7,
      });
  }

  dust(at: { x: number; y: number; z: number }, amount = 2): void {
    for (let i = 0; i < amount; i++)
      this.spawn({
        x: at.x + (Math.random() - 0.5) * 0.6,
        y: at.y + 0.05,
        z: at.z + (Math.random() - 0.5) * 0.6,
        vx: (Math.random() - 0.5) * 1.2,
        vy: 0.6 + Math.random(),
        vz: (Math.random() - 0.5) * 1.2,
        size: 0.1 + Math.random() * 0.08,
        color: 0xc9b48a,
        life: 0.6,
        gravity: 1,
      });
  }

  private updateChunks(dt: number): void {
    const p = new THREE.Vector3();
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.life -= dt;
      c.fuse -= dt;
      c.obj.getWorldPosition(p);
      const explode = (c.burstColors && c.fuse <= 0) || c.life <= 0;
      if (explode) {
        if (c.burstColors) this.burst(p, c.burstColors, 50, 6, { x: c.vel.x * 0.3, y: 3, z: c.vel.z * 0.3 }, 0.2);
        c.obj.removeFromParent();
        this.chunks.splice(i, 1);
        continue;
      }
      c.vel.y -= 20 * dt;
      const next = p.clone().addScaledVector(c.vel, dt);
      if (this.world.solidAt(next.x, next.y - c.radius, next.z)) {
        const hard = Math.abs(c.vel.y) > 7;
        if (c.burstColors && hard) {
          this.burst(p, c.burstColors, 60, 7, { x: c.vel.x * 0.2, y: 4, z: c.vel.z * 0.2 }, 0.22);
          this.shake = Math.max(this.shake, 0.35);
          c.obj.removeFromParent();
          this.chunks.splice(i, 1);
          continue;
        }
        if (Math.abs(c.vel.y) > 3) {
          this.dust({ x: p.x, y: p.y - c.radius, z: p.z }, 4);
          if (c.trail) this.burst({ x: p.x, y: p.y - c.radius + 0.1, z: p.z }, GORE_COLORS, 8, 3, { x: 0, y: 1, z: 0 }, 0.12);
        }
        if (!this.world.solidAt(next.x, p.y - c.radius, next.z)) c.vel.y = -c.vel.y * 0.3;
        else c.vel.set(-c.vel.x * 0.3, c.vel.y, -c.vel.z * 0.3);
        c.vel.x *= 0.6;
        c.vel.z *= 0.6;
        c.spin.multiplyScalar(0.5);
      } else {
        c.obj.position.add(next.sub(p));
        // A trail of gore while it flies.
        if (c.trail && c.vel.lengthSq() > 9 && Math.random() < dt * 40)
          this.spawn({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5), vy: Math.random(), vz: (Math.random() - 0.5), size: 0.08 + Math.random() * 0.06, color: GORE_COLORS[(Math.random() * GORE_COLORS.length) | 0], life: 4 });
      }
      this.tmpQ.setFromEuler(this.e.set(c.spin.x * dt, c.spin.y * dt, c.spin.z * dt));
      c.obj.quaternion.premultiply(this.tmpQ);
      // Shrink away at the end of its life.
      const fade = Math.min(1, c.life / 0.6);
      if (fade < 1) c.obj.scale.copy(c.baseScale).multiplyScalar(Math.max(0.01, fade));
    }
  }

  update(dt: number, darts: Dart[]): void {
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.clock += dt;
    this.updateChunks(dt);
    this.updateFountains(dt);
    let n = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity * dt;
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      if (p.flat) {
        // Splatted: lies on the ground.
      } else if (this.world.solidAt(nx, ny - p.size / 2, nz)) {
        // Gore that lands may splat flat and linger; everything else bounces and scrapes to a stop.
        if (p.gore && Math.random() < 0.4 && !this.world.solidAt(nx, p.y, nz)) {
          p.flat = true;
          p.vx = p.vy = p.vz = 0;
          p.y = Math.floor((ny - p.size / 2) / 0.5) * 0.5 + 0.5 + 0.02;
          p.rx = 0;
          p.spin = 0;
          p.life = Math.max(p.life, 7 + Math.random() * 5);
          p.maxLife = p.life;
          p.size *= 1.2 + Math.random() * 0.8;
          p.color.multiplyScalar(0.55); // soaks in darker than the spray
        } else if (!this.world.solidAt(nx, p.y, nz)) {
          p.vy = -p.vy * p.bounce;
          p.vx *= 0.6;
          p.vz *= 0.6;
          p.spin *= 0.5;
        } else {
          p.vx = -p.vx * 0.3;
          p.vz = -p.vz * 0.3;
        }
      } else {
        p.x = nx;
        p.y = ny;
        p.z = nz;
      }
      p.rx += p.spin * dt;
      p.ry += p.spin * 0.7 * dt;
      const fade = Math.min(1, p.life / Math.min(1, p.maxLife * 0.3));
      const s = p.size * fade;
      this.q.setFromEuler(this.e.set(p.rx, p.ry, 0));
      this.m4.compose(this.v.set(p.x, p.y, p.z), this.q, p.flat ? this.sv.set(s, 0.04, s) : this.sv.set(s, s, s));
      this.cubes.setMatrixAt(n, this.m4);
      this.cubes.setColorAt(n, p.color);
      n++;
    }
    this.cubes.count = n;
    this.cubes.instanceMatrix.needsUpdate = true;
    if (this.cubes.instanceColor) this.cubes.instanceColor.needsUpdate = true;

    // Darts: one mesh each, pointing along their flight.
    while (this.dartMeshes.length < darts.length) {
      const m = new THREE.Mesh(this.dartGeo, this.dartMat);
      this.scene.add(m);
      this.dartMeshes.push(m);
    }
    this.dartMeshes.forEach((m, i) => {
      const d = darts[i];
      m.visible = !!d;
      if (!d) return;
      m.position.set(d.x, d.y, d.z);
      if (!d.stuck) m.lookAt(d.x + d.vx, d.y + d.vy, d.z + d.vz);
    });
  }
}
