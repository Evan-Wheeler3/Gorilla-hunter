import * as THREE from 'three';
import type { Match } from '../game/match';
import { Rng } from '../core/rng';
import { Block } from '../world/blocks';
import type { Island } from '../world/island';

interface Bird {
  home: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** 'perched' | 'flying' (scattered) | 'returning'. */
  mode: 'perched' | 'flying' | 'returning';
  until: number;
  phase: number;
  color: THREE.Color;
}

const BIRD_COLORS = [0xe8402a, 0x2a8ae8, 0xf2c230, 0x34b04a, 0xffffff];
const MAX_PRINTS = 260;

/**
 * Small life in the jungle: flocks of birds perched on the canopy that burst into the air when
 * someone runs or shoots near them (giving positions away), and footprints in sand, mud and ash.
 */
export class Wildlife {
  private readonly birds: Bird[] = [];
  private readonly bodies: THREE.InstancedMesh;
  private readonly wings: THREE.InstancedMesh;
  private readonly prints: THREE.InstancedMesh;
  private readonly printLife: number[] = [];
  private readonly printMatrix: THREE.Matrix4[] = [];
  private nextPrint = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  /** Called when a flock scatters (for the sound). */
  onScatter: (at: THREE.Vector3) => void = () => {};

  constructor(
    scene: THREE.Scene,
    private readonly island: Island,
  ) {
    const rng = new Rng(island.seed * 31 + 5);
    const w = island.world;
    // Flocks on crown tops, found from vine positions (each vine hangs under a crown).
    const vines = island.vines;
    for (let f = 0; f < 22 && vines.length; f++) {
      const v = vines[rng.int(vines.length)];
      const top = w.surfaceHeight(v.x, v.z);
      const n = 3 + rng.int(4);
      const color = new THREE.Color(BIRD_COLORS[rng.int(BIRD_COLORS.length)]);
      for (let i = 0; i < n; i++) {
        const x = v.x + rng.range(-1.5, 1.5), z = v.z + rng.range(-1.5, 1.5);
        const home = new THREE.Vector3(x, Math.max(top, w.surfaceHeight(x, z)) + 0.12, z);
        this.birds.push({ home, pos: home.clone(), vel: new THREE.Vector3(), mode: 'perched', until: 0, phase: rng.next() * 10, color });
      }
    }
    const mat = new THREE.MeshLambertMaterial();
    this.bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.14, 0.3), mat, this.birds.length);
    this.wings = new THREE.InstancedMesh(new THREE.BoxGeometry(0.32, 0.03, 0.16), mat, this.birds.length * 2);
    this.birds.forEach((b, i) => {
      this.bodies.setColorAt(i, b.color);
      this.wings.setColorAt(i * 2, b.color.clone().multiplyScalar(0.8));
      this.wings.setColorAt(i * 2 + 1, b.color.clone().multiplyScalar(0.8));
    });
    this.bodies.frustumCulled = this.wings.frustumCulled = false;
    scene.add(this.bodies, this.wings);

    // Footprints: dark flat squares that fade away.
    this.prints = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x2a1c12, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      MAX_PRINTS,
    );
    for (let i = 0; i < MAX_PRINTS; i++) {
      this.printLife.push(0);
      this.printMatrix.push(new THREE.Matrix4().makeScale(0, 0, 0));
      this.prints.setMatrixAt(i, this.printMatrix[i]);
    }
    this.prints.frustumCulled = false;
    scene.add(this.prints);
  }

  /** Leaves a footprint if the ground there is soft. */
  footprint(x: number, y: number, z: number, yaw: number, big: boolean, side: number): void {
    const w = this.island.world;
    const under = w.blockAt(x, y - 0.1, z);
    if (under !== Block.Sand && under !== Block.Dirt && under !== Block.Mud && under !== Block.Ash) return;
    const i = this.nextPrint;
    this.nextPrint = (this.nextPrint + 1) % MAX_PRINTS;
    const s = big ? 0.42 : 0.22;
    const ox = Math.cos(yaw) * side * (big ? 0.35 : 0.14), oz = -Math.sin(yaw) * side * (big ? 0.35 : 0.14);
    this.q.setFromEuler(this.e.set(0, yaw, 0));
    this.printMatrix[i].compose(new THREE.Vector3(x + ox, Math.floor((y + 0.01) / w.size) * w.size + 0.02, z + oz), this.q, new THREE.Vector3(s, 1, s * 1.5));
    this.printLife[i] = 25;
    this.prints.setMatrixAt(i, this.printMatrix[i]);
    this.prints.instanceMatrix.needsUpdate = true;
  }

  update(match: Match, dt: number, time: number): void {
    // Anyone moving fast near a flock (or a shot fired near it) sends it up.
    const movers: THREE.Vector3[] = [];
    for (const c of [...match.gorillas.values(), ...match.hunters.values()]) {
      if (c.team === 'hunter' && c.dead) continue;
      const fast = Math.hypot(c.vel.x, c.vel.y, c.vel.z) > 5 || (c.team === 'hunter' && match.ctx.time - c.lastShotTime < 0.2);
      if (fast) movers.push(new THREE.Vector3(c.body.x, c.body.y + 1, c.body.z));
    }
    let scattered: THREE.Vector3 | null = null;
    for (const b of this.birds) {
      if (b.mode === 'perched') {
        for (const m of movers)
          if (m.distanceToSquared(b.pos) < 12 * 12) {
            b.mode = 'flying';
            b.until = time + 8 + Math.random() * 6;
            const away = b.pos.clone().sub(m).setY(0).normalize();
            b.vel.set(away.x * 6, 7 + Math.random() * 3, away.z * 6);
            scattered = b.pos;
            break;
          }
      } else if (b.mode === 'flying') {
        // Climb away, then circle high up.
        b.vel.y = Math.max(0.5, b.vel.y - dt * 3);
        b.vel.x += Math.sin(time * 0.8 + b.phase) * dt * 4;
        b.vel.z += Math.cos(time * 0.8 + b.phase) * dt * 4;
        b.vel.clampLength(0, 10);
        b.pos.addScaledVector(b.vel, dt);
        if (time > b.until) b.mode = 'returning';
      } else {
        const to = b.home.clone().sub(b.pos);
        const d = to.length();
        if (d < 0.2) {
          b.mode = 'perched';
          b.pos.copy(b.home);
        } else b.pos.addScaledVector(to.normalize(), Math.min(d, dt * 7));
      }
    }
    if (scattered) this.onScatter(scattered);

    this.birds.forEach((b, i) => {
      const flying = b.mode !== 'perched';
      const yaw = flying ? Math.atan2(b.vel.x, b.vel.z) : b.phase;
      const hop = flying ? 0 : Math.max(0, Math.sin(time * 3 + b.phase * 5)) * 0.04;
      this.q.setFromEuler(this.e.set(0, yaw, 0));
      this.m.compose(b.pos.clone().setY(b.pos.y + hop), this.q, new THREE.Vector3(1, 1, 1));
      this.bodies.setMatrixAt(i, this.m);
      const flap = flying ? Math.sin(time * 26 + b.phase) * 0.9 : 0.1;
      for (const side of [-1, 1]) {
        const off = new THREE.Vector3(side * 0.2, 0.04, 0).applyQuaternion(this.q);
        const wq = this.q.clone().multiply(new THREE.Quaternion().setFromEuler(this.e.set(0, 0, side * flap)));
        this.m.compose(b.pos.clone().add(off).setY(b.pos.y + hop + 0.04), wq, new THREE.Vector3(1, 1, 1));
        this.wings.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), this.m);
      }
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.wings.instanceMatrix.needsUpdate = true;

    // Footprints fade by shrinking.
    let changed = false;
    for (let i = 0; i < MAX_PRINTS; i++) {
      if (this.printLife[i] <= 0) continue;
      this.printLife[i] -= dt;
      if (this.printLife[i] < 3) {
        const k = Math.max(0, this.printLife[i] / 3);
        const m = this.printMatrix[i].clone().multiply(new THREE.Matrix4().makeScale(k, 1, k));
        this.prints.setMatrixAt(i, m);
        changed = true;
      }
    }
    if (changed) this.prints.instanceMatrix.needsUpdate = true;
  }
}
