import * as THREE from 'three';
import type { FinisherPick } from '../core/finishers';
import { Rng } from '../core/rng';
import { GORE_COLORS, HEAD_COLORS, HUNTER_DEBRIS_COLORS, HunterRig, type GorillaPose, type GorillaRig } from './characters';
import type { Effects } from './effects';

type V = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = v3(0, 1, 0);

/** Smooth 0..1 progress of t across [a, b]. */
const ease = (t: number, a: number, b: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/** What a finisher script can do while it plays. */
interface Ctx {
  t: number;
  dt: number;
  time: number;
  rng: Rng;
  puppet: HunterRig;
  gorilla: GorillaRig;
  effects: Effects;
  /** Gorilla frame: origin at its feet, forward toward the victim, right = the gorilla's right. */
  origin: V;
  forward: V;
  right: V;
  victimAt: V;
  local(x: number, y: number, z: number): V;
  hand(i: 0 | 1): V;
  /** Puts the victim's feet at `feet` with the body axis along `axis` and the front facing `face`. */
  place(feet: V, axis: V, face: V): void;
  /** Victim standing at `at`, facing the gorilla, optionally tipped back by `tilt` radians. */
  stand(at: V, tilt?: number): void;
  once(key: string, at: number, fn: () => void): void;
  /** Tears a part off the victim and sends it flying (velocity in world space). */
  fling(part: THREE.Object3D, vel: V, opts?: { burst?: number[]; fuse?: number; life?: number; spin?: number }): void;
  worldPos(obj: THREE.Object3D): V;
  /** Kept between frames by scripts that need it. */
  memo: Record<string, unknown>;
}

interface Script {
  /** When the big moment lands (slow motion for the players involved). */
  climax: number;
  pose(t: number, p: GorillaPose): void;
  act(c: Ctx): void;
}

const setArms = (p: GorillaPose, x: number, zOut: number, fore = 0) => {
  p.arm[0] = { x, z: -zOut, fore };
  p.arm[1] = { x, z: zOut, fore };
};

// ---------------------------------------------------------------------- the eight finishers

const SCRIPTS: Record<string, Script> = {
  /** Lifts the hunter overhead by head and feet and pulls him in two. */
  rip_in_half: {
    climax: 1.0,
    pose(t, p) {
      if (t < 0.25) setArms(p, mix(-0.6, -1.5, ease(t, 0, 0.25)), 0.1, -0.2);
      else if (t < 0.7) {
        const k = ease(t, 0.25, 0.7);
        setArms(p, mix(-1.5, -2.6, k), mix(0.15, 0.75, k), -0.1); // hands apart: the hunter is held flat
        p.torsoPitch = mix(0.6, 0.05, k);
        p.headX = -0.7 * k;
      } else if (t < 1.0) {
        const k = ease(t, 0.7, 1.0);
        setArms(p, -2.6, mix(0.75, 1.45, k) + Math.sin(t * 70) * 0.05, -0.1);
        p.torsoPitch = 0.05;
        p.headX = -0.7;
      } else if (t < 1.3) {
        setArms(p, -2.2, 1.5);
        p.headX = -0.8;
      } else {
        // Chest beat.
        const s = Math.sin(t * 28);
        p.arm[0] = { x: -1.3 - s * 0.3, z: 0.6, fore: -1.3 };
        p.arm[1] = { x: -1.3 + s * 0.3, z: -0.6, fore: -1.3 };
        p.torsoPitch = 0.1;
        p.headX = -0.8;
      }
    },
    act(c) {
      if (c.t < 0.25) {
        c.stand(c.victimAt);
        c.puppet.flail(c.time, 0.6);
      } else if (c.t < 1.0) {
        const a = c.hand(1), b = c.hand(0);
        c.place(a, b.clone().sub(a), UP);
        c.puppet.flail(c.time, 1);
      }
      c.once('split', 1.0, () => {
        const waist = c.worldPos(c.puppet.hips);
        c.fling(c.puppet.torso, c.right.clone().multiplyScalar(6).addScaledVector(UP, 5), { spin: 9 });
        c.fling(c.puppet.hips, c.right.clone().multiplyScalar(-6).addScaledVector(UP, 5), { spin: 9 });
        c.effects.burst(waist, GORE_COLORS, 45, 6, { x: 0, y: 3, z: 0 });
        c.effects.shake = 0.7;
      });
    },
  },

  /** Holds the hunter up and squeezes his head until it pops. */
  head_pop: {
    climax: 1.05,
    pose(t, p) {
      p.arm[0] = { x: t < 0.25 ? mix(-0.6, -1.6, ease(t, 0, 0.25)) : t < 1.25 ? mix(-1.6, -2.0, ease(t, 0.25, 0.55)) : -0.8, z: 0.1, fore: -0.3 };
      if (t < 0.55) p.arm[1] = { x: -0.6, z: -0.1, fore: 0.1 };
      else if (t < 1.05) {
        const k = ease(t, 0.55, 0.8);
        p.arm[1] = { x: mix(-0.6, -2.35, k), z: mix(-0.1, -0.35, k) + Math.sin(t * 80) * 0.03 * k, fore: -0.7 };
      } else p.arm[1] = { x: -1.8 + Math.sin(t * 40) * 0.35, z: 0.2, fore: -0.2 }; // shakes the mess off
      p.torsoPitch = 0.3;
      p.headX = -0.3;
    },
    act(c) {
      if (c.t < 0.25) {
        c.stand(c.victimAt);
        c.puppet.flail(c.time, 0.6);
        return;
      }
      if (c.t < 1.25) {
        const feet = c.hand(0).addScaledVector(UP, -1.2).addScaledVector(c.forward, 0.25);
        c.place(feet, UP, c.forward.clone().negate());
        c.puppet.flail(c.time, c.t < 1.05 ? 1 : 0.3);
        const squeeze = ease(c.t, 0.6, 1.05);
        c.puppet.head.scale.set(1 + squeeze * 0.6, 1 - squeeze * 0.55, 1 + squeeze * 0.6);
      }
      c.once('pop', 1.05, () => {
        const head = c.worldPos(c.puppet.head);
        c.fling(c.puppet.helmet, v3(0, 11, 0).addScaledVector(c.forward, 1), { spin: 14 });
        c.puppet.head.visible = false;
        c.effects.burst(head, HEAD_COLORS, 70, 7, { x: 0, y: 4, z: 0 });
        c.effects.shake = 0.6;
      });
      c.once('drop', 1.25, () => c.fling(c.puppet.root, c.forward.clone().multiplyScalar(1).addScaledVector(UP, 1), { spin: 2, life: 3 }));
    },
  },

  /** Tears an arm off and beats the hunter with it. */
  arm_rip: {
    climax: 1.8,
    pose(t, p) {
      const hits = [1.0, 1.4, 1.8];
      if (t < 0.3) p.arm[0] = { x: mix(-0.6, -1.4, ease(t, 0, 0.3)), z: 0.25, fore: -0.2 };
      else if (t < 0.6) {
        p.arm[0] = { x: mix(-1.4, 0.5, ease(t, 0.3, 0.55)), z: 0.1, fore: -0.4 };
        p.torsoTwist = -0.4;
      } else if (t < 2.05) {
        // Club swings: raise high, smash down on each hit.
        let x = -0.6;
        for (const h of hits) if (t > h - 0.4 && t <= h) x = mix(-3.1, -0.5, ease(t, h - 0.12, h));
        p.arm[0] = { x, z: 0.05, fore: -0.2 };
        p.torsoPitch = 0.5 + (x > -1 ? 0.3 : -0.1);
      } else p.arm[0] = { x: mix(-0.6, -2.4, ease(t, 2.05, 2.25)), z: -0.3, fore: 0 }; // tosses it away
      p.arm[1] = { x: -0.7, z: -0.3, fore: 0.2 };
      p.headX = -0.5;
    },
    act(c) {
      const hits = [1.0, 1.4, 1.8];
      const done = hits.filter((h) => c.t >= h).length;
      if (c.t < 1.8) {
        const back = c.forward.clone().multiplyScalar(done * 0.35);
        c.stand(c.victimAt.clone().add(back), -0.12 * done);
        c.puppet.flail(c.time, 0.7);
      }
      c.once('rip', 0.55, () => {
        const shoulder = c.worldPos(c.puppet.arms[1].upper);
        const club = c.puppet.arms[1].upper;
        c.gorilla.arms[0].fore.add(club);
        club.position.set(0, -0.95, 0.05);
        club.rotation.set(0, 0, 0);
        c.memo.club = club;
        c.effects.burst(shoulder, GORE_COLORS, 25, 4);
      });
      hits.forEach((h, i) =>
        c.once(`hit${i}`, h, () => {
          c.effects.burst(c.worldPos(c.puppet.head), GORE_COLORS, 14, 4);
          c.effects.shake = i === 2 ? 0.7 : 0.3;
          if (i === 2) c.fling(c.puppet.root, c.forward.clone().multiplyScalar(9).addScaledVector(UP, 6), { spin: 10, burst: HUNTER_DEBRIS_COLORS, fuse: 1.6 });
        }),
      );
      c.once('toss', 2.2, () => {
        const club = c.memo.club as THREE.Object3D | undefined;
        if (club) c.fling(club, c.forward.clone().multiplyScalar(5).addScaledVector(UP, 7), { spin: 12, life: 4 });
      });
    },
  },

  /** Spins the hunter by the ankles three times and hurls him into the sky. */
  twirl_and_throw: {
    climax: 1.85,
    pose(t, p) {
      p.rate = 40;
      if (t < 0.3) {
        setArms(p, mix(-0.6, -1.0, ease(t, 0, 0.3)), 0.1, 0);
        p.torsoPitch = 0.9;
      } else if (t < 1.85) {
        const k = (t - 0.3) / 1.55;
        p.yawOffset = Math.PI * 2 * 3 * k * k; // three accelerating turns
        setArms(p, -1.6, 0.05, 0);
        p.torsoPitch = 0.15;
        p.bodyTilt = -0.25;
      } else {
        p.yawOffset = 0;
        setArms(p, -1.9, 0.5, 0);
        p.bodyRoll = Math.sin(t * 9) * 0.18; // dizzy
        p.headZ = Math.sin(t * 7) * 0.4;
      }
    },
    act(c) {
      if (c.t < 0.3) {
        c.stand(c.victimAt);
        c.puppet.flail(c.time, 0.6);
        return;
      }
      const mid = c.hand(0).add(c.hand(1)).multiplyScalar(0.5);
      const out = mid.clone().sub(c.origin).setY(0).normalize();
      if (c.t < 1.85) {
        c.place(mid, out.clone().addScaledVector(UP, 0.15), UP);
        c.puppet.flail(c.time, 1);
        c.memo.prevOut = c.memo.out ?? out.clone();
        c.memo.out = out.clone();
      }
      c.once('throw', 1.85, () => {
        const prev = (c.memo.prevOut as V) ?? out;
        const tangent = out.clone().sub(prev).setY(0);
        if (tangent.lengthSq() < 1e-6) tangent.copy(c.right);
        tangent.normalize();
        c.fling(c.puppet.root, tangent.multiplyScalar(15).addScaledVector(out, 5).addScaledVector(UP, 9), { spin: 16, burst: HUNTER_DEBRIS_COLORS, life: 5 });
      });
    },
  },

  /** Hammers the hunter down into a ball and bowls him away. */
  crumple_ball: {
    climax: 1.35,
    pose(t, p) {
      const smacks = [0.45, 0.75, 1.05];
      if (t < 1.1) {
        let x = mix(-0.6, -3.0, ease(t, 0, 0.25));
        for (const s of smacks) if (t > s - 0.18 && t <= s + 0.12) x = t <= s ? mix(-3.0, -0.7, ease(t, s - 0.1, s)) : mix(-0.7, -3.0, ease(t, s, s + 0.12));
        setArms(p, x, 0.15, -0.2);
        p.torsoPitch = x > -1.5 ? 1.05 : 0.3;
      } else if (t < 1.35) {
        p.arm[0] = { x: 0.8, z: -0.2, fore: 0 };
        p.torsoTwist = -0.5;
      } else if (t < 1.6) {
        p.arm[0] = { x: -1.4, z: 0.1, fore: 0 };
        p.torsoTwist = 0.4;
      } else setArms(p, -2.8, 0.5);
    },
    act(c) {
      const squash = [0.72, 0.48, 0.3];
      const n = [0.45, 0.75, 1.05].filter((s) => c.t >= s).length;
      if (c.t < 1.35) {
        c.stand(c.victimAt);
        const target = n === 0 ? 1 : squash[n - 1];
        const cur = (c.memo.s as number) ?? 1;
        const s = cur + (target - cur) * Math.min(1, c.dt * 25);
        c.memo.s = s;
        if (c.t < 1.1) c.puppet.root.scale.set(1 + (1 - s) * 0.7, s, 1 + (1 - s) * 0.7);
        else {
          // Balled up and starting to roll.
          c.puppet.root.scale.set(0.8, 0.5, 0.8);
          c.memo.roll = ((c.memo.roll as number) ?? 0) + c.dt * 8;
          c.puppet.root.rotateOnWorldAxis(c.right, -(c.memo.roll as number));
        }
        c.puppet.flail(c.time, Math.max(0, 1 - n * 0.4));
      }
      [0.45, 0.75, 1.05].forEach((s, i) =>
        c.once(`smack${i}`, s, () => {
          c.effects.burst(c.victimAt.clone().addScaledVector(UP, 0.5), GORE_COLORS, 10, 4);
          c.effects.dust(c.victimAt, 8);
          c.effects.shake = 0.3;
        }),
      );
      c.once('bowl', 1.35, () => c.fling(c.puppet.root, c.forward.clone().multiplyScalar(13).addScaledVector(UP, 2), { burst: HUNTER_DEBRIS_COLORS, fuse: 1.1, spin: 14 }));
    },
  },

  /** Claps both hands on the hunter's head; it pops out the sides. */
  head_clap: {
    climax: 0.8,
    pose(t, p) {
      if (t < 0.72) {
        const k = ease(t, 0, 0.4);
        setArms(p, mix(-0.6, -1.65, k), mix(0.1, 1.35, k) + (t > 0.45 ? Math.sin(t * 60) * 0.04 : 0), -0.15);
        p.torsoPitch = 0.55;
      } else if (t < 1.0) setArms(p, -1.7, mix(1.35, -0.35, ease(t, 0.72, 0.8)), -0.15);
      else setArms(p, -1.2 + Math.sin(t * 30) * 0.2, -0.1, -0.6); // dusting off its hands
      p.headX = -0.4;
    },
    act(c) {
      const front = c.local(0, 0, 1.45);
      const at = c.victimAt.clone().lerp(front, ease(c.t, 0, 0.4));
      if (c.t < 1.4) {
        c.stand(at, -ease(c.t, 0.95, 1.35) * (Math.PI / 2) * 0.95);
        if (c.t < 0.8) c.puppet.flail(c.time, 0.8);
      }
      c.once('clap', 0.8, () => {
        const head = c.worldPos(c.puppet.head);
        c.fling(c.puppet.helmet, v3(0, 12, 0), { spin: 15 });
        c.puppet.head.visible = false;
        c.effects.burst(head, HEAD_COLORS, 35, 3, { x: c.right.x * 7, y: 3, z: c.right.z * 7 });
        c.effects.burst(head, HEAD_COLORS, 35, 3, { x: -c.right.x * 7, y: 3, z: -c.right.z * 7 });
        c.effects.shake = 0.6;
      });
      c.once('fall', 1.4, () => c.fling(c.puppet.root, v3(0, 1, 0), { burst: HUNTER_DEBRIS_COLORS, fuse: 0.25 }));
    },
  },

  /** Grabs the legs and slams the hunter into the ground, back and forth, until he breaks. */
  ragdoll_slam: {
    climax: 2.15,
    pose(t, p) {
      if (t < 0.35) {
        setArms(p, mix(-0.6, -1.0, ease(t, 0, 0.3)), 0.1, 0);
        p.torsoPitch = 0.9;
      } else if (t < 2.25) {
        const cyc = (t - 0.8) / 0.45;
        const x = -2.1 + 1.2 * Math.cos(cyc * Math.PI * 2);
        setArms(p, x, 0.1, 0);
        p.torsoPitch = 0.4 + 0.55 * ((x + 3.3) / 2.4);
        p.bodyTilt = x < -2.5 ? -0.15 : 0;
      } else setArms(p, -2.9, 0.6); // victory
      p.headX = -0.5;
      p.rate = 40;
    },
    act(c) {
      if (c.t < 0.35) {
        c.stand(c.victimAt);
        c.puppet.flail(c.time, 0.6);
        return;
      }
      if (c.t < 2.15) {
        const mid = c.hand(0).add(c.hand(1)).multiplyScalar(0.5);
        const shoulder = c.local(0, 2.2, 0);
        c.place(mid, mid.clone().sub(shoulder), c.right);
        c.puppet.flail(c.time, 0.8);
      }
      [0.8, 1.25, 1.7].forEach((h, i) =>
        c.once(`slam${i}`, h, () => {
          const head = c.worldPos(c.puppet.head);
          c.effects.dust(head, 10);
          c.effects.burst(head, GORE_COLORS, 12, 4);
          c.effects.shake = 0.45;
        }),
      );
      c.once('break', 2.15, () => {
        const parts = [c.puppet.head, c.puppet.arms[0].upper, c.puppet.arms[1].upper, c.puppet.legs[0].thigh, c.puppet.legs[1].thigh, c.puppet.torso];
        for (const part of parts) {
          const dir = v3(c.rng.range(-1, 1), 0, c.rng.range(-1, 1)).normalize();
          c.fling(part, dir.multiplyScalar(c.rng.range(4, 8)).addScaledVector(UP, c.rng.range(5, 9)), { spin: 12 });
        }
        c.effects.burst(c.worldPos(c.puppet.hips), GORE_COLORS, 55, 7);
        c.effects.shake = 0.8;
      });
    },
  },

  /** Legendary: pins the hunter down and plays a drum solo on him, then a double-fist finale. */
  drum_solo: {
    climax: 2.65,
    pose(t, p) {
      if (t < 0.35) {
        setArms(p, mix(-1.5, -0.4, ease(t, 0, 0.35)), 0.15, -0.2);
        p.torsoPitch = 1.0;
      } else if (t < 2.3) {
        // Bongos: alternating hands, speeding up.
        const u = t - 0.6;
        const phase = u > 0 ? u * 6 * Math.PI * 2 + u * u * 4 * Math.PI * 2 : 0;
        p.arm[0] = { x: -1.0 - 0.75 * Math.max(0, Math.sin(phase)), z: 0.2, fore: -0.5 };
        p.arm[1] = { x: -1.0 - 0.75 * Math.max(0, Math.sin(phase + Math.PI)), z: -0.2, fore: -0.5 };
        p.hipsY = 0.75;
        p.torsoPitch = 1.05;
        p.leg[0] = { x: -0.8, shin: 1.4 };
        p.leg[1] = { x: -0.8, shin: 1.4 };
        p.headZ = Math.sin(phase * 0.5) * 0.25;
        p.headX = -0.2;
      } else if (t < 2.65) {
        setArms(p, -3.1, 0.15, 0);
        p.hipsY = 1.0;
        p.torsoPitch = 0.3;
        p.headX = -0.8;
      } else if (t < 2.8) {
        setArms(p, -0.5, 0.1, 0);
        p.torsoPitch = 1.2;
      } else setArms(p, -2.9, 0.6);
      p.rate = 40;
    },
    act(c) {
      const lieFeet = c.local(0.85, 0.15, 1.5), lieHead = c.local(-0.85, 0.15, 1.5);
      if (c.t < 0.35) {
        const k = ease(c.t, 0.05, 0.35);
        c.place(c.victimAt.clone().lerp(lieFeet, k), UP.clone().lerp(lieHead.clone().sub(lieFeet).normalize(), k), c.forward.clone().negate().lerp(UP, k));
        c.puppet.flail(c.time, 0.8);
      } else if (c.t < 2.65) {
        const u = Math.max(0, c.t - 0.6);
        const phase = u * 6 * Math.PI * 2 + u * u * 4 * Math.PI * 2;
        const bounce = Math.abs(Math.sin(phase)) * 0.1;
        c.place(lieFeet.clone().addScaledVector(UP, bounce), lieHead.clone().sub(lieFeet), UP);
        c.puppet.flail(c.time, 0.35);
        const beat = Math.floor(phase / Math.PI);
        if (u > 0 && beat !== c.memo.beat) {
          c.memo.beat = beat;
          c.effects.burst(c.worldPos(c.puppet.torso).addScaledVector(UP, 0.3), [0xffe14d, 0xffffff, 0x6fd3ff, 0xff4fa0], 3, 2, { x: 0, y: 4, z: 0 }, 0.12);
          c.effects.shake = Math.max(c.effects.shake, 0.08);
        }
      }
      c.once('finale', 2.65, () => {
        const at = c.worldPos(c.puppet.torso);
        c.puppet.root.visible = false;
        c.effects.burst(at, HUNTER_DEBRIS_COLORS, 110, 9, { x: 0, y: 6, z: 0 });
        c.effects.burst(at, [0xffd34d, 0xff6a13, 0x6fd3ff, 0xff4fa0, 0x8cff6a], 60, 8, { x: 0, y: 8, z: 0 }, 0.12);
        c.effects.shake = 1;
      });
    },
  },
};

// ---------------------------------------------------------------------- director

interface Active {
  gorillaId: number;
  involvesLocal: boolean;
  script: Script;
  duration: number;
  t: number;
  ctx: Ctx;
  fired: Set<string>;
  climaxed: boolean;
}

export interface FinisherStart {
  killer: number;
  victim: number;
  at: { x: number; y: number; z: number };
  killerAt: { x: number; y: number; z: number };
  yaw: number;
  pick: FinisherPick;
}

/**
 * Plays finishers: drives the killer gorilla's pose, puppets a stand-in hunter from the
 * gorilla's hands, and throws the pieces at the right moments. Everything is seeded by the
 * kill, so every player sees the same scene.
 */
export class FinisherDirector {
  private readonly active = new Map<number, Active>();
  /** Called at each finisher's big moment (the game slows time for the players involved). */
  onClimax: (involvesLocal: boolean) => void = () => {};

  constructor(
    private readonly scene: THREE.Scene,
    private readonly effects: Effects,
  ) {}

  isPlaying(gorillaId: number): boolean {
    return this.active.has(gorillaId);
  }

  start(kill: FinisherStart, gorilla: GorillaRig, localId: number): void {
    const script = SCRIPTS[kill.pick.finisher.id] ?? SCRIPTS.rip_in_half;
    this.stop(kill.killer);

    const puppet = new HunterRig();
    this.scene.add(puppet.root);
    const origin = v3(kill.killerAt.x, kill.killerAt.y, kill.killerAt.z);
    const forward = v3(Math.sin(kill.yaw), 0, Math.cos(kill.yaw));
    const right = v3(-Math.cos(kill.yaw), 0, Math.sin(kill.yaw));
    const victimAt = v3(kill.at.x, kill.at.y, kill.at.z);
    const fired = new Set<string>();
    const tmpM = new THREE.Matrix4();

    const ctx: Ctx = {
      t: 0,
      dt: 0,
      time: 0,
      rng: new Rng(kill.pick.seed),
      puppet,
      gorilla,
      effects: this.effects,
      origin,
      forward,
      right,
      victimAt,
      memo: {},
      local: (x, y, z) => origin.clone().addScaledVector(right, x).addScaledVector(UP, y).addScaledVector(forward, z),
      hand: (i) => gorilla.hand(i),
      place: (feet, axis, face) => {
        const y = axis.clone().normalize();
        const z = face.clone().addScaledVector(y, -face.dot(y));
        if (z.lengthSq() < 1e-6) z.copy(Math.abs(y.y) < 0.9 ? UP : forward).addScaledVector(y, -y.dot(Math.abs(y.y) < 0.9 ? UP : forward));
        z.normalize();
        const x = y.clone().cross(z);
        tmpM.makeBasis(x, y, z);
        puppet.root.quaternion.setFromRotationMatrix(tmpM);
        puppet.root.position.copy(feet);
      },
      stand: (at, tilt = 0) => {
        puppet.root.position.copy(at);
        puppet.root.rotation.set(0, 0, 0);
        puppet.root.rotation.order = 'YXZ';
        puppet.root.rotation.y = kill.yaw + Math.PI;
        puppet.root.rotation.x = tilt;
      },
      once: (key, at, fn) => {
        if (ctx.t >= at && !fired.has(key)) {
          fired.add(key);
          fn();
        }
      },
      fling: (part, vel, opts = {}) => {
        const s = opts.spin ?? 6;
        const spin = v3(ctx.rng.range(-s, s), ctx.rng.range(-s, s), ctx.rng.range(-s, s));
        if (part === puppet.root) ctx.memo.rootFlung = true;
        this.effects.addChunk(part, vel, spin, { burstColors: opts.burst, fuse: opts.fuse, life: opts.life, radius: part === puppet.root ? 0.35 : 0.15 });
      },
      worldPos: (obj) => obj.getWorldPosition(v3()),
    };
    ctx.stand(victimAt);
    this.active.set(kill.killer, {
      gorillaId: kill.killer,
      involvesLocal: kill.killer === localId || kill.victim === localId,
      script,
      duration: kill.pick.finisher.duration,
      t: 0,
      ctx,
      fired,
      climaxed: false,
    });
  }

  /** Pose override for a gorilla's rig while its finisher plays (undefined otherwise). */
  poseFor(gorillaId: number): ((p: GorillaPose) => void) | undefined {
    const a = this.active.get(gorillaId);
    if (!a) return undefined;
    return (p) => {
      p.rate = Math.max(p.rate, 30);
      a.script.pose(a.t, p);
    };
  }

  /** Advances every finisher; call after the gorilla rigs have been posed this frame. */
  update(dt: number, time: number): void {
    for (const a of [...this.active.values()]) {
      a.t += dt;
      a.ctx.t = a.t;
      a.ctx.dt = dt;
      a.ctx.time = time;
      a.script.act(a.ctx);
      if (!a.climaxed && a.t >= a.script.climax) {
        a.climaxed = true;
        this.onClimax(a.involvesLocal);
      }
      if (a.t >= a.duration + 0.2) this.stop(a.gorillaId);
    }
  }

  private stop(gorillaId: number): void {
    const a = this.active.get(gorillaId);
    if (!a) return;
    // Whatever is still attached to the puppet goes; flung pieces live on as chunks.
    if (!a.ctx.memo.rootFlung) a.ctx.puppet.root.removeFromParent();
    const club = a.ctx.memo.club as THREE.Object3D | undefined;
    if (club && club.parent && club.parent !== this.scene) club.removeFromParent();
    this.active.delete(gorillaId);
  }
}
