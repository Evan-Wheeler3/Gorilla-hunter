import * as THREE from 'three';
import type { Gorilla } from '../game/gorilla';
import type { Hunter } from '../game/hunter';
import { forwardOf } from '../game/types';
import { buildVoxelPart, inRoundedBox } from './voxelModel';

// ---------------------------------------------------------------------- shared helpers

/** Smoothly moves a value toward a target (frame-rate independent). */
export const damp = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

function part(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function pivot(parent: THREE.Object3D, x: number, y: number, z: number, child?: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (child) g.add(child);
  parent.add(g);
  return g;
}

const rand = (x: number, y: number, z: number) => {
  let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 0xff) / 255;
};

// ---------------------------------------------------------------------- gorilla

const FUR = 0x4f4440, FUR_HI = 0x6a5a53, SILVER = 0xb3aaa0, SKIN = 0x8f7262, DARK = 0x231a18;
const EYE_W = 0xf1ece2, EYE = 0x1a100c, MOUTH = 0x3a1f1c;
const furColor = (x: number, y: number, z: number) => (rand(x, y, z) < 0.18 ? FUR_HI : FUR);

interface GorillaGeometry {
  torso: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  upper: THREE.BufferGeometry[];
  fore: THREE.BufferGeometry[];
  thigh: THREE.BufferGeometry[];
  shin: THREE.BufferGeometry[];
}

let gorillaGeo: GorillaGeometry | null = null;

/** Built once and shared by every gorilla. */
function gorillaGeometry(): GorillaGeometry {
  if (gorillaGeo) return gorillaGeo;
  const vs = 0.1;
  const geo: GorillaGeometry = {
    torso: buildVoxelPart(15, 11, 11, vs, (x, y, z) => {
      if (!inRoundedBox(x, y, z, 15, 11, 11, 2)) return null;
      if (z >= 9 && x >= 4 && x <= 10 && y >= 1 && y <= 7) return SKIN; // chest
      if (y >= 8 && z <= 5) return SILVER; // silverback
      return furColor(x, y, z);
    }, [7.5, 0, 5.5]),
    head: buildVoxelPart(9, 10, 10, vs, (x, y, z) => {
      if (z === 9) return y >= 6 && y <= 7 && x >= 1 && x <= 7 ? DARK : null; // brow ridge
      if (!inRoundedBox(x, y, z, 9, 10, 9, 2)) return y === 9 && x >= 3 && x <= 5 && z >= 2 && z <= 6 ? FUR : null;
      if (z === 8) {
        if (y === 5 && (x === 2 || x === 6)) return EYE_W;
        if (y === 5 && (x === 3 || x === 5)) return EYE;
        if (y === 3 && (x === 3 || x === 5)) return DARK; // nostrils
        if (y === 1 && x >= 2 && x <= 6) return MOUTH;
        if (x >= 1 && x <= 7 && y <= 6) return SKIN;
      }
      if (z >= 7 && x >= 2 && x <= 6 && y <= 4) return SKIN; // muzzle
      return furColor(x, y, z);
    }, [4.5, 0, 4.5]),
    upper: [],
    fore: [],
    thigh: [],
    shin: [],
  };
  for (const side of [-1, 1]) {
    geo.upper.push(buildVoxelPart(5, 9, 5, vs, (x, y, z) => (inRoundedBox(x, y, z, 5, 9, 5) ? furColor(x + side * 3, y, z) : null), [2.5, 9, 2.5]));
    geo.fore.push(buildVoxelPart(6, 10, 6, vs, (x, y, z) => {
      if (!inRoundedBox(x, y, z, 6, 10, 6)) return null;
      if (y <= 2) return z >= 4 ? DARK : SKIN; // fist and knuckles
      return furColor(x, y, z + side * 5);
    }, [3, 10, 3]));
    geo.thigh.push(buildVoxelPart(6, 6, 6, vs, (x, y, z) => (inRoundedBox(x, y, z, 6, 6, 6) ? furColor(x, y + side, z) : null), [3, 6, 3]));
    geo.shin.push(buildVoxelPart(6, 5, 8, vs, (x, y, z) => {
      if (y >= 2 && z >= 6) return null;
      if (!inRoundedBox(x, y, z, 6, 5, 8)) return null;
      return y <= 1 ? SKIN : furColor(x, y, z);
    }, [3, 5, 3]));
  }
  gorillaGeo = geo;
  return geo;
}

/**
 * Every joint angle the gorilla rig is driven by. Arm/leg index 0 is the gorilla's right side.
 * Arm x: negative raises the arm forward and up (-PI is straight overhead). Arm z: sideways.
 */
export interface GorillaPose {
  torsoPitch: number;
  torsoTwist: number;
  hipsY: number;
  bodyTilt: number;
  bodyRoll: number;
  yawOffset: number;
  headX: number;
  headZ: number;
  arm: { x: number; z: number; fore: number }[];
  leg: { x: number; shin: number }[];
  /** Pose smoothing rate; finishers raise it for snappy, hand-timed motion. */
  rate: number;
}

/** Voxel gorilla with a joint hierarchy; animated procedurally from the simulation state. */
export class GorillaRig {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group(); // tilts as a whole (lying down, swinging)
  readonly hips: THREE.Group;
  readonly torso: THREE.Group;
  readonly head: THREE.Group;
  readonly arms: { upper: THREE.Group; fore: THREE.Group }[] = [];
  readonly legs: { thigh: THREE.Group; shin: THREE.Group }[] = [];
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private swipeTwist = 0;
  private lieAmount = 0;
  private yawOffset = 0;

  constructor() {
    const geo = gorillaGeometry();
    this.root.add(this.body);
    this.hips = pivot(this.body, 0, 1.05, 0);
    this.torso = pivot(this.hips, 0, 0, 0, part(geo.torso, this.material));
    this.head = pivot(this.torso, 0, 1.0, 0.3, part(geo.head, this.material));
    [-1, 1].forEach((side, i) => {
      const upper = pivot(this.torso, side * 0.88, 0.85, 0.2, part(geo.upper[i], this.material));
      const fore = pivot(upper, 0, -0.88, 0, part(geo.fore[i], this.material));
      this.arms.push({ upper, fore });
      const thigh = pivot(this.hips, side * 0.42, 0, -0.1, part(geo.thigh[i], this.material));
      const shin = pivot(thigh, 0, -0.58, 0, part(geo.shin[i], this.material));
      this.legs.push({ thigh, shin });
    });
  }

  dispose(): void {
    this.material.dispose();
  }

  /** World position of a fist (0 = right hand, 1 = left hand). */
  hand(i: number, target = new THREE.Vector3()): THREE.Vector3 {
    this.root.updateWorldMatrix(true, true);
    return this.arms[i].fore.localToWorld(target.set(0, -0.95, 0.05));
  }

  /**
   * Poses the rig from the gorilla's state. A finisher can take over the pose through
   * `override`, which receives the computed pose and edits it before it is applied.
   */
  update(g: Gorilla, dt: number, time: number, override?: (pose: GorillaPose) => void): void {
    this.root.position.set(g.body.x, g.body.y, g.body.z);
    const pose = this.computePose(g, dt, time);
    override?.(pose);
    this.applyPose(pose, g.yaw, dt);

    // Rage: a hot red pulse.
    const rage = g.rage ? 0.25 + 0.15 * Math.sin(time * 8) : 0;
    this.material.emissive.setRGB(rage, rage * 0.1, 0);
  }

  private computePose(g: Gorilla, dt: number, time: number): GorillaPose {
    const speed = Math.hypot(g.vel.x, g.vel.z);
    const amp = Math.min(1, speed / 9);
    const phase = (g.stride / 2.4) * Math.PI * 2;
    const pose: GorillaPose = {
      torsoPitch: 0.5,
      torsoTwist: 0,
      hipsY: 1.05,
      bodyTilt: 0,
      bodyRoll: 0,
      yawOffset: 0,
      headX: -0.45,
      headZ: 0,
      arm: [
        { x: -0.5, z: 0.05, fore: 0.15 },
        { x: -0.5, z: -0.05, fore: 0.15 },
      ],
      leg: [
        { x: 0.2, shin: 0.25 },
        { x: 0.2, shin: 0.25 },
      ],
      rate: 14,
    };
    const lying = g.state === 'down';

    switch (g.state) {
      case 'ground': {
        if (!g.body.onGround) {
          // Airborne: arms flung up and out, legs tucked.
          const rising = g.vel.y > 0 ? 1 : 0;
          pose.arm[0] = { x: -2.4 + rising * 0.4, z: 0.5, fore: -0.4 };
          pose.arm[1] = { x: -2.4 + rising * 0.4, z: -0.5, fore: -0.4 };
          pose.leg[0] = { x: -0.7, shin: 1.1 };
          pose.leg[1] = { x: -0.7, shin: 1.1 };
          pose.torsoPitch = 0.3;
        } else {
          // Knuckle gallop: arms and legs alternate, the body bobs and leans into speed.
          const s = Math.sin(phase), c = Math.cos(phase);
          pose.arm[0] = { x: -0.5 + s * 0.95 * amp, z: 0.05, fore: 0.15 + Math.max(0, c) * 0.5 * amp };
          pose.arm[1] = { x: -0.5 - s * 0.95 * amp, z: -0.05, fore: 0.15 + Math.max(0, -c) * 0.5 * amp };
          pose.leg[0] = { x: 0.2 - s * 0.8 * amp, shin: 0.25 + Math.max(0, -c) * 0.7 * amp };
          pose.leg[1] = { x: 0.2 + s * 0.8 * amp, shin: 0.25 + Math.max(0, c) * 0.7 * amp };
          pose.torsoPitch = 0.5 + 0.2 * amp;
          pose.hipsY = 1.05 + Math.abs(Math.sin(phase)) * 0.14 * amp;
          pose.bodyRoll = Math.sin(phase) * 0.05 * amp;
          if (g.dashing) pose.torsoPitch = 0.95;
          if (amp < 0.05) {
            pose.headZ = Math.sin(time * 0.7 + g.id) * 0.25;
            pose.hipsY += Math.sin(time * 2.2) * 0.015;
          }
        }
        break;
      }
      case 'climb': {
        const p = (g.stride / 1.2) * Math.PI * 2;
        pose.torsoPitch = -0.15;
        pose.arm[0] = { x: -2.7 + Math.sin(p) * 0.45, z: 0.15, fore: -0.3 };
        pose.arm[1] = { x: -2.7 - Math.sin(p) * 0.45, z: -0.15, fore: -0.3 };
        pose.leg[0] = { x: -0.9 + Math.sin(p) * 0.4, shin: 1.2 };
        pose.leg[1] = { x: -0.9 - Math.sin(p) * 0.4, shin: 1.2 };
        pose.headX = 0.1;
        break;
      }
      case 'mantle':
        pose.torsoPitch = 0.8;
        pose.arm[0] = { x: -1.4, z: 0.3, fore: -0.6 };
        pose.arm[1] = { x: -1.4, z: -0.3, fore: -0.6 };
        pose.leg[0] = { x: -0.9, shin: 1.3 };
        pose.leg[1] = { x: -0.9, shin: 1.3 };
        break;
      case 'swing': {
        // One arm up on the vine, the other flung out, legs trailing the motion.
        const f = forwardOf(g.yaw);
        const forwardSpeed = g.vel.x * f.x + g.vel.z * f.z;
        pose.bodyTilt = Math.max(-0.7, Math.min(0.7, forwardSpeed * 0.045));
        pose.torsoPitch = 0.05;
        pose.arm[1] = { x: -3.05, z: 0.1, fore: 0 };
        pose.arm[0] = { x: -1.2, z: 0.9, fore: -0.5 };
        pose.leg[0] = { x: -0.3 - pose.bodyTilt * 0.6, shin: 0.6 };
        pose.leg[1] = { x: 0.2 - pose.bodyTilt * 0.6, shin: 0.3 };
        pose.headX = -0.2;
        break;
      }
      case 'down': {
        const dragged = g.draggedBy !== null;
        pose.torsoPitch = 0;
        pose.hipsY = 0.55;
        pose.arm[0] = dragged ? { x: -3.0, z: 0.3, fore: 0 } : { x: -1.6, z: 1.2, fore: 0.3 };
        pose.arm[1] = dragged ? { x: -3.0, z: -0.3, fore: 0 } : { x: -1.6, z: -1.2, fore: 0.3 };
        pose.leg[0] = { x: -0.3, shin: 0.2 };
        pose.leg[1] = { x: -0.5, shin: 0.4 };
        pose.headX = 0;
        pose.headZ = Math.sin(time * 1.3) * 0.15;
        break;
      }
    }

    // Swipe: wind up, slash across, recover.
    const sinceSwipe = time - g.lastSwipeTime;
    if (sinceSwipe < 0.45 && !lying && !g.inFinisher) {
      const p = sinceSwipe / 0.45;
      pose.arm[1] = p < 0.3 ? { x: -2.7, z: -0.9, fore: -0.8 } : { x: 0.9, z: 0.5, fore: 0.1 };
      this.swipeTwist = damp(this.swipeTwist, p < 0.3 ? -0.5 : 0.6, 30, dt);
    } else {
      this.swipeTwist = damp(this.swipeTwist, 0, 10, dt);
    }
    pose.torsoTwist = this.swipeTwist;

    // Slapped while down: the head snaps sideways.
    if (time - g.lastSlappedTime < 0.25) pose.headZ += 0.6 * Math.sin(((time - g.lastSlappedTime) / 0.25) * Math.PI);

    this.lieAmount = damp(this.lieAmount, lying ? 1 : 0, 8, dt);
    pose.bodyTilt -= this.lieAmount * (Math.PI / 2);
    return pose;
  }

  private applyPose(pose: GorillaPose, yaw: number, dt: number): void {
    const k = pose.rate;
    this.yawOffset = pose.rate > 20 ? pose.yawOffset : damp(this.yawOffset, pose.yawOffset, 10, dt);
    this.root.rotation.y = yaw + this.yawOffset;
    this.body.rotation.x = damp(this.body.rotation.x, pose.bodyTilt, k, dt);
    this.body.rotation.z = damp(this.body.rotation.z, pose.bodyRoll, k, dt);
    this.body.position.y = this.lieAmount * 0.15;
    this.hips.position.y = damp(this.hips.position.y, pose.hipsY, k, dt);
    this.torso.rotation.x = damp(this.torso.rotation.x, pose.torsoPitch, k, dt);
    this.torso.rotation.y = damp(this.torso.rotation.y, pose.torsoTwist, k * 2, dt);
    this.head.rotation.x = damp(this.head.rotation.x, pose.headX, k, dt);
    this.head.rotation.z = damp(this.head.rotation.z, pose.headZ, 20, dt);
    for (let i = 0; i < 2; i++) {
      this.arms[i].upper.rotation.x = damp(this.arms[i].upper.rotation.x, pose.arm[i].x, k * 1.3, dt);
      this.arms[i].upper.rotation.z = damp(this.arms[i].upper.rotation.z, pose.arm[i].z, k, dt);
      this.arms[i].fore.rotation.x = damp(this.arms[i].fore.rotation.x, pose.arm[i].fore, k, dt);
      this.legs[i].thigh.rotation.x = damp(this.legs[i].thigh.rotation.x, pose.leg[i].x, k * 1.3, dt);
      this.legs[i].shin.rotation.x = damp(this.legs[i].shin.rotation.x, pose.leg[i].shin, k, dt);
    }
  }
}

// ---------------------------------------------------------------------- hunter

export const KHAKI = 0xb5a272, KHAKI_DK = 0x8f7f55, VEST = 0xff6a13, VEST_DK = 0xd9520a, SKIN_H = 0xf0c39a;
const BOOT = 0x5a3b22, BELT = 0x4a3420, HELMET = 0xe2d6b0, BAND = 0x8a6a3a, MOUSTACHE = 0x6b3f1f, GUN = 0x2c2c30, STOCK = 0x7a5230;

interface HunterGeometry {
  torso: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  helmet: THREE.BufferGeometry;
  upper: THREE.BufferGeometry;
  fore: THREE.BufferGeometry;
  thigh: THREE.BufferGeometry;
  shin: THREE.BufferGeometry;
  rifle: THREE.BufferGeometry;
}

let hunterGeo: HunterGeometry | null = null;
const HV = 0.075; // hunter voxel size

function hunterGeometry(): HunterGeometry {
  if (hunterGeo) return hunterGeo;
  hunterGeo = {
    torso: buildVoxelPart(7, 8, 4, HV, (x, y, z) => {
      if (y === 0) return x === 3 && z === 3 ? 0xd4b24a : BELT; // belt and buckle
      if (y >= 2 && y <= 6 && (z === 0 || z === 3 || x === 0 || x === 6)) return (x + y) % 3 === 0 ? VEST_DK : VEST;
      return KHAKI;
    }, [3.5, 0, 2]),
    head: buildVoxelPart(5, 5, 5, HV, (x, y, z) => {
      if (z === 4 && y === 2 && (x === 1 || x === 3)) return 0x1a1a1a; // eyes
      if (z === 4 && y === 1 && x >= 1 && x <= 3) return MOUSTACHE;
      return SKIN_H;
    }, [2.5, 0, 2.5]),
    helmet: buildVoxelPart(7, 4, 7, HV, (x, y, z) => {
      if (y === 0) return inRoundedBox(x, 0, z, 7, 1, 7, 1) ? HELMET : null; // brim
      if (x === 0 || x === 6 || z === 0 || z === 6) return null;
      if (y === 1) return BAND;
      if (y === 3) return x >= 2 && x <= 4 && z >= 2 && z <= 4 ? HELMET : null;
      return HELMET;
    }, [3.5, 0, 3.5]),
    upper: buildVoxelPart(2, 5, 2, HV, () => KHAKI, [1, 5, 1]),
    fore: buildVoxelPart(2, 5, 2, HV, (_x, y) => (y <= 1 ? SKIN_H : KHAKI_DK), [1, 5, 1]),
    thigh: buildVoxelPart(3, 5, 3, HV, () => KHAKI_DK, [1.5, 5, 1.5]),
    shin: buildVoxelPart(3, 7, 4, HV, (_x, y, z) => (y <= 1 ? BOOT : z === 3 ? null : KHAKI_DK), [1.5, 7, 1.5]),
    rifle: buildVoxelPart(1, 2, 13, HV, (_x, y, z) => {
      if (z <= 3) return STOCK;
      if (y === 1 && z >= 5 && z <= 8) return 0x111114; // scope
      if (y === 1) return null;
      return z === 12 ? 0xff4fa0 : GUN; // pink dart tip
    }, [0.5, 0.5, 4]),
  };
  return hunterGeo;
}

/** Voxel hunter (pith helmet, orange vest, moustache) with a held tranquilliser rifle. */
export class HunterRig {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly hips: THREE.Group;
  readonly torso: THREE.Group;
  readonly head: THREE.Group;
  readonly helmet: THREE.Group;
  readonly rifle: THREE.Group;
  readonly arms: { upper: THREE.Group; fore: THREE.Group }[] = [];
  readonly legs: { thigh: THREE.Group; shin: THREE.Group }[] = [];
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private recoil = 0;
  private spin = 0;

  constructor() {
    const geo = hunterGeometry();
    this.root.add(this.body);
    this.hips = pivot(this.body, 0, 0.9, 0);
    this.torso = pivot(this.hips, 0, 0, 0, part(geo.torso, this.material));
    this.head = pivot(this.torso, 0, 8 * HV + 0.03, 0, part(geo.head, this.material));
    this.helmet = pivot(this.head, 0, 4 * HV, 0, part(geo.helmet, this.material));
    for (const side of [-1, 1]) {
      const upper = pivot(this.torso, side * 0.33, 0.57, 0, part(geo.upper, this.material));
      const fore = pivot(upper, 0, -5 * HV, 0, part(geo.fore, this.material));
      this.arms.push({ upper, fore });
      const thigh = pivot(this.hips, side * 0.12, 0, 0, part(geo.thigh, this.material));
      const shin = pivot(thigh, 0, -5 * HV, 0, part(geo.shin, this.material));
      this.legs.push({ thigh, shin });
    }
    this.rifle = pivot(this.torso, 0.18, 0.45, 0.2, part(geo.rifle, this.material));
  }

  dispose(): void {
    this.material.dispose();
  }

  update(h: Hunter, dt: number, time: number): void {
    this.root.visible = !h.dead;
    if (h.dead) return;
    this.root.position.set(h.body.x, h.body.y, h.body.z);

    const speed = Math.hypot(h.vel.x, h.vel.z);
    const amp = Math.min(1, speed / 6.5);
    const phase = (h.stride / 1.7) * Math.PI * 2;
    const s = Math.sin(phase);
    const k = 16;

    let torsoPitch = 0.05 + amp * 0.12, headX = 0;
    const hipsY = 0.9 + Math.abs(Math.cos(phase)) * 0.06 * amp;
    const arm = [
      { x: -0.9, z: 0.2, fore: -1.1 },
      { x: -0.7, z: -0.2, fore: -1.3 },
    ];
    const leg = [
      { x: s * 0.75 * amp, shin: Math.max(0, -Math.cos(phase)) * 1.0 * amp },
      { x: -s * 0.75 * amp, shin: Math.max(0, Math.cos(phase)) * 1.0 * amp },
    ];
    let rifle = { x: 0.05, y: 0.42, z: 0.24, rx: 0, ry: -1.0 };

    if (!h.body.onGround) {
      leg[0] = { x: -0.6, shin: 0.9 };
      leg[1] = { x: 0.3, shin: 0.3 };
    }
    if (h.aiming) {
      torsoPitch = -h.pitch * 0.4;
      headX = -h.pitch * 0.5;
      arm[1] = { x: -1.55 - h.pitch * 0.6, z: 0.1, fore: -0.35 };
      arm[0] = { x: -1.45 - h.pitch * 0.6, z: 0.75, fore: -0.5 };
      rifle = { x: 0.16, y: 0.5, z: 0.18, rx: -h.pitch * 0.9, ry: 0 };
    } else if (h.dragging !== null) {
      torsoPitch = 0.45;
      arm[1] = { x: 0.9, z: 0.15, fore: 0.2 };
      arm[0] = { x: -0.4 + s * 0.6, z: 0.1, fore: -0.4 };
      rifle = { x: 0, y: 0.35, z: -0.2, rx: 0, ry: 0.4 };
    } else {
      arm[0].x += s * 0.25 * amp;
    }

    if (time - h.lastShotTime < 0.05) this.recoil = 0.35;
    this.recoil = damp(this.recoil, 0, 12, dt);
    torsoPitch -= this.recoil * 0.5;

    this.spin = h.stunned ? this.spin + dt * 12 : damp(this.spin, Math.round(this.spin / (Math.PI * 2)) * Math.PI * 2, 8, dt);
    this.root.rotation.y = h.yaw + this.spin;

    this.hips.position.y = damp(this.hips.position.y, hipsY, k, dt);
    this.torso.rotation.x = damp(this.torso.rotation.x, torsoPitch, k, dt);
    this.head.rotation.x = damp(this.head.rotation.x, headX, k, dt);
    this.head.rotation.y = Math.sin(time * 0.8 + h.id) * 0.12 * (1 - amp);
    for (let i = 0; i < 2; i++) {
      this.arms[i].upper.rotation.x = damp(this.arms[i].upper.rotation.x, arm[i].x - this.recoil, k, dt);
      this.arms[i].upper.rotation.z = damp(this.arms[i].upper.rotation.z, arm[i].z, k, dt);
      this.arms[i].fore.rotation.x = damp(this.arms[i].fore.rotation.x, arm[i].fore, k, dt);
      this.legs[i].thigh.rotation.x = damp(this.legs[i].thigh.rotation.x, leg[i].x, k * 1.5, dt);
      this.legs[i].shin.rotation.x = damp(this.legs[i].shin.rotation.x, leg[i].shin, k * 1.5, dt);
    }
    this.rifle.position.set(damp(this.rifle.position.x, rifle.x, k, dt), damp(this.rifle.position.y, rifle.y, k, dt), damp(this.rifle.position.z, rifle.z, k, dt));
    this.rifle.rotation.x = damp(this.rifle.rotation.x, rifle.rx - this.recoil * 0.6, k, dt);
    this.rifle.rotation.y = damp(this.rifle.rotation.y, rifle.ry, k, dt);
  }

  /** Panicked flailing for a victim held by a gorilla. */
  flail(time: number, amount = 1): void {
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      this.arms[i].upper.rotation.x = (-1.6 + Math.sin(time * 26 + i * 2) * 1.2) * amount;
      this.arms[i].upper.rotation.z = s * (0.6 + Math.sin(time * 19 + i) * 0.4) * amount;
      this.arms[i].fore.rotation.x = -0.6 + Math.sin(time * 31 + i) * 0.6 * amount;
      this.legs[i].thigh.rotation.x = Math.sin(time * 22 + i * Math.PI) * 0.9 * amount;
      this.legs[i].shin.rotation.x = 0.4 + Math.sin(time * 27 + i) * 0.5 * amount;
    }
    this.head.rotation.z = Math.sin(time * 17) * 0.3 * amount;
  }
}

/** Colours a killed hunter bursts into (design doc: blocky pink-red and tan debris, no realistic gore). */
export const GORE_COLORS = [0xd2475a, 0xe0607a, 0xb83246, 0xf28a9a];
export const HUNTER_DEBRIS_COLORS = [KHAKI, KHAKI_DK, VEST, SKIN_H, HELMET, ...GORE_COLORS];
export const HEAD_COLORS = [SKIN_H, SKIN_H, MOUSTACHE, ...GORE_COLORS];
