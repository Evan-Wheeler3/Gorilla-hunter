import { config } from '../core/config';
import { Rng } from '../core/rng';
import type { Gorilla } from './gorilla';
import type { Hunter } from './hunter';
import type { Match } from './match';
import { emptyInput, forwardOf, type InputFrame } from './types';
import type { Vec3 } from '../world/island';

const H = config.hunter;

/** How sharp the bots are. Practice bots are beatable on purpose. */
export interface BotSkill {
  /** Seconds between spotting a target and the first shot. */
  reaction: number;
  /** Aim error in metres at 30 m (scales with distance). */
  aimError: number;
  /** How far a bot notices enemies (metres). */
  sight: number;
}

export const PRACTICE_SKILL: BotSkill = { reaction: 0.9, aimError: 1.6, sight: 55 };

interface Brain {
  rng: Rng;
  /** Where it is heading when it has nothing better to do. */
  wander: Vec3 | null;
  wanderUntil: number;
  /** Stuck detection: position a moment ago. */
  lastPos: Vec3;
  lastPosTime: number;
  detourUntil: number;
  detourSide: number;
  /** Seconds the current target has been in view (hunters wait for `reaction` before firing). */
  seenFor: number;
  targetId: number | null;
  interactStep: number;
  strafeSeed: number;
}

const flat = (a: Vec3, b: Vec3) => Math.hypot(b.x - a.x, b.z - a.z);
const headingTo = (a: Vec3, b: Vec3) => Math.atan2(b.x - a.x, b.z - a.z);

/**
 * Drives every character no human controls. Simple, readable behaviour on steering alone (no
 * path finding): hunters hunt, shoot, drag and deliver; gorillas dodge, charge, kill and rescue.
 */
export class Bots {
  private readonly brains = new Map<number, Brain>();
  /** Bots hold fire for the first seconds so a player is never killed before they can move. */
  private graceUntil = -1;
  static readonly GRACE_SECONDS = 5;

  constructor(
    private readonly skill: BotSkill = PRACTICE_SKILL,
    private readonly seed = 99,
  ) {}

  /** Inputs for every character except `humans`. */
  inputs(match: Match, dt: number, humans: Set<number>): Map<number, InputFrame> {
    const out = new Map<number, InputFrame>();
    if (this.graceUntil < 0) this.graceUntil = match.ctx.time + Bots.GRACE_SECONDS;
    for (const g of match.gorillas.values()) if (!humans.has(g.id)) out.set(g.id, this.gorilla(match, g, dt));
    for (const h of match.hunters.values()) if (!humans.has(h.id)) out.set(h.id, this.hunter(match, h, dt));
    return out;
  }

  private brain(id: number, at: Vec3): Brain {
    let b = this.brains.get(id);
    if (!b) {
      b = {
        rng: new Rng(this.seed * 7919 + id * 104729),
        wander: null,
        wanderUntil: 0,
        lastPos: { ...at },
        lastPosTime: 0,
        detourUntil: 0,
        detourSide: 1,
        seenFor: 0,
        targetId: null,
        interactStep: 0,
        strafeSeed: id * 1.7,
      };
      this.brains.set(id, b);
    }
    return b;
  }

  // ------------------------------------------------------------------ Shared steering

  /** Fills `input` to walk toward `to`, steering round trunks and hopping over low things. */
  private steer(match: Match, b: Brain, body: { x: number; y: number; z: number; height: number }, to: Vec3, input: InputFrame, speed = 1): void {
    const t = match.ctx.time;
    const world = match.ctx.world;
    let yaw = headingTo(body, to);
    // Stuck for a while: take a sideways detour for a moment.
    if (t - b.lastPosTime > 1.2) {
      if (flat(b.lastPos, body) < 0.6 && flat(body, to) > 2) {
        b.detourUntil = t + 0.9;
        b.detourSide = b.rng.next() < 0.5 ? -1 : 1;
      }
      b.lastPos = { x: body.x, y: body.y, z: body.z };
      b.lastPosTime = t;
    }
    if (t < b.detourUntil) yaw += b.detourSide * 1.3;
    else {
      // Look ahead: if the way is blocked at chest height, try angles either side.
      const blocked = (a: number) => {
        const f = forwardOf(a);
        for (const d of [1.2, 2.4]) if (world.solidAt(body.x + f.x * d, body.y + body.height * 0.6, body.z + f.z * d)) return true;
        return false;
      };
      if (blocked(yaw)) {
        for (const off of [0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
          if (!blocked(yaw + off)) {
            yaw += off;
            break;
          }
        }
      }
    }
    // A low step in the way: jump it.
    const f = forwardOf(yaw);
    if (world.solidAt(body.x + f.x * 1.1, body.y + 1.1, body.z + f.z * 1.1) && !world.solidAt(body.x + f.x * 1.1, body.y + 2.6, body.z + f.z * 1.1)) input.jump = true;
    input.yaw = yaw;
    input.moveY = speed;
  }

  private wander(match: Match, b: Brain, at: Vec3): Vec3 {
    const t = match.ctx.time;
    if (!b.wander || t > b.wanderUntil || flat(at, b.wander) < 3) {
      const a = b.rng.next() * Math.PI * 2, r = 10 + b.rng.next() * 20;
      const w = match.ctx.world;
      const x = Math.max(-45, Math.min(45, at.x + Math.cos(a) * r)), z = Math.max(-45, Math.min(45, at.z + Math.sin(a) * r));
      b.wander = { x, y: w.groundHeight(x, z), z };
      b.wanderUntil = t + 8;
    }
    return b.wander;
  }

  private canSee(match: Match, from: Vec3, to: Vec3): boolean {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    return match.ctx.world.raycast(from.x, from.y, from.z, dx / d, dy / d, dz / d, d - 0.5) < 0;
  }

  // ------------------------------------------------------------------ Hunters

  private hunter(match: Match, h: Hunter, dt: number): InputFrame {
    const b = this.brain(h.id, h.body);
    const input = emptyInput(h.yaw, 0);
    if (h.dead || h.held) return input;
    const eye = { x: h.body.x, y: h.body.y + h.body.height * 0.9, z: h.body.z };

    // 1. Dragging: haul it to the nearest boat, sprinting.
    if (h.dragging !== null) {
      const dock = nearest(match.island.docks.map((d) => d.zone), h.body);
      if (dock) this.steer(match, b, h.body, dock, input);
      input.sprint = true;
      return input;
    }

    // 2. A downed gorilla nobody is dragging: go grab it.
    const downed = nearestOf([...match.gorillas.values()].filter((g) => g.sedation.isDown && g.draggedBy === null), h.body);
    if (downed && flat(h.body, downed.body) < 45) {
      const d = flat(h.body, downed.body);
      if (d > H.interactReach * 0.8) {
        this.steer(match, b, h.body, downed.body, input);
        input.sprint = d > 6;
        b.interactStep = 0;
      } else {
        // Tap interact: press one frame, release the next.
        input.yaw = headingTo(h.body, downed.body);
        input.interact = b.interactStep === 0;
        b.interactStep = b.interactStep === 0 ? 1 : 0;
      }
      return input;
    }

    if (match.ctx.time < this.graceUntil) {
      this.steer(match, b, h.body, this.wander(match, b, h.body), input, 0.6);
      return input;
    }

    // 3. Hunt: the nearest gorilla in sight.
    const visible = [...match.gorillas.values()].filter((g) => !g.sedation.isDown && flat(h.body, g.body) < this.skill.sight && this.canSee(match, eye, centre(g)));
    const target = nearestOf(visible, h.body);
    if (target) {
      if (b.targetId !== target.id) b.seenFor = 0;
      b.targetId = target.id;
      b.seenFor += dt;
      const d = flat(h.body, target.body);
      const aimAt = this.leadPoint(h, target, b);
      input.yaw = headingTo(h.body, aimAt);
      input.pitch = Math.atan2(aimAt.y - eye.y, flat(eye, aimAt));
      input.aim = h.loaded || d > 12;
      // Too close: back off while reloading; otherwise strafe to be harder to catch.
      const strafe = Math.sin(match.ctx.time * 1.3 + b.strafeSeed);
      if (d < 7 && !h.loaded) {
        input.moveY = -1;
        input.aim = false;
        input.sprint = true;
      } else if (d > 30) input.moveY = 0.6;
      input.moveX = strafe;
      if (h.loaded && b.seenFor > this.skill.reaction) {
        input.primary = true;
        input.aimPoint = aimAt;
        b.seenFor = this.skill.reaction * 0.4; // a short re-aim before the next shot
      }
      return input;
    }
    b.targetId = null;
    b.seenFor = 0;

    // 4. Nothing in sight: head for the nearest gorilla (hunters know roughly where they are), or wander.
    const any = nearestOf([...match.gorillas.values()], h.body);
    const goal = any && flat(h.body, any.body) < 70 ? any.body : this.wander(match, b, h.body);
    this.steer(match, b, h.body, goal, input, 1);
    input.sprint = true;
    return input;
  }

  /** Where a bot hunter aims: leading the target, lifted for drop, with human-ish error. */
  private leadPoint(h: Hunter, g: Gorilla, b: Brain): Vec3 {
    const c = centre(g);
    const m = h.muzzle;
    const dist = Math.hypot(c.x - m.x, c.y - m.y, c.z - m.z);
    const t = dist / H.dartSpeed;
    const err = this.skill.aimError * (dist / 30) * (0.3 + b.rng.next());
    const a = b.rng.next() * Math.PI * 2;
    return {
      x: c.x + g.vel.x * t * 0.8 + Math.cos(a) * err,
      y: c.y + 0.5 * H.dartGravity * t * t + Math.sin(a) * err * 0.6,
      z: c.z + g.vel.z * t * 0.8 + Math.sin(a) * err,
    };
  }

  // ------------------------------------------------------------------ Gorillas

  private gorilla(match: Match, g: Gorilla, _dt: number): InputFrame {
    const b = this.brain(g.id, g.body);
    const input = emptyInput(g.yaw, 0);
    if (g.sedation.isDown || g.held || g.inFinisher) return input;
    const t = match.ctx.time;

    // Opening seconds: scatter away from the hunters.
    if (t < this.graceUntil) {
      const h0 = nearestOf([...match.hunters.values()].filter((h) => !h.dead), g.body);
      if (h0) {
        const away = headingTo(h0.body, g.body) + Math.sin(b.strafeSeed) * 0.8;
        const f = forwardOf(away);
        this.steer(match, b, g.body, { x: g.body.x + f.x * 10, y: g.body.y, z: g.body.z + f.z * 10 }, input);
      }
      return input;
    }

    // 1. A teammate is being dragged: go after the hunter dragging it.
    const dragged = nearestOf([...match.gorillas.values()].filter((o) => o !== g && o.draggedBy !== null), g.body);
    const dragger = dragged ? match.hunters.get(dragged.draggedBy!) : undefined;
    if (dragger && !dragger.dead && flat(g.body, dragger.body) < 35) return this.attack(match, g, b, dragger, input);

    // 2. A teammate down on the ground nearby: slap it awake.
    const down = nearestOf([...match.gorillas.values()].filter((o) => o !== g && o.sedation.isDown && o.draggedBy === null), g.body);
    if (down && flat(g.body, down.body) < 25) {
      const d = flat(g.body, down.body);
      if (d > 1.8) this.steer(match, b, g.body, down.body, input);
      else {
        input.yaw = headingTo(g.body, down.body);
        input.primary = Math.floor(t * 3) !== Math.floor((t - 1 / 60) * 3); // a slap three times a second
      }
      return input;
    }

    // 3. Hunters nearby: charge the closest, dodging while it has a dart loaded.
    const hunter = nearestOf([...match.hunters.values()].filter((h) => !h.dead), g.body);
    if (hunter) {
      const d = flat(g.body, hunter.body);
      const eye = { x: g.body.x, y: g.body.y + 2.2, z: g.body.z };
      const aggressive = g.rage || d < 16 || !hunter.loaded;
      if (d < 40 && aggressive && this.canSee(match, eye, centre(hunter))) return this.attack(match, g, b, hunter, input);
      if (d < 22 && hunter.loaded && hunter.aiming) {
        // Being aimed at from range: break line of sight sideways.
        const away = headingTo(hunter.body, g.body);
        input.yaw = away + Math.sin(t * 2 + b.strafeSeed) * 1.2;
        input.moveY = 1;
        if (b.rng.next() < 0.01) input.jump = true;
        return input;
      }
    }

    // 4. Roam.
    this.steer(match, b, g.body, this.wander(match, b, g.body), input, 0.7);
    return input;
  }

  private attack(match: Match, g: Gorilla, b: Brain, h: Hunter, input: InputFrame): InputFrame {
    const d = flat(g.body, h.body);
    const t = match.ctx.time;
    this.steer(match, b, g.body, h.body, input);
    // Zig-zag on the approach while the hunter can shoot.
    if (h.loaded && d > 6) input.yaw += Math.sin(t * 5 + b.strafeSeed) * 0.5;
    const facing = Math.abs(angleDiff(g.yaw, headingTo(g.body, h.body))) < 0.4;
    // Some charges end in a dash straight through him, the rest in a swipe.
    if (d < 5.5 && d > config.gorilla.swipeRange && facing && b.strafeSeed % 2 < 1 && b.rng.next() < 0.3) input.dash = true;
    else if (d < config.gorilla.swipeRange + 0.3 && !g.dashing) {
      input.yaw = headingTo(g.body, h.body);
      input.primary = true;
    }
    return input;
  }
}

function centre(c: { body: { x: number; y: number; z: number; height: number } }): Vec3 {
  return { x: c.body.x, y: c.body.y + c.body.height * 0.55, z: c.body.z };
}

function nearest(points: Vec3[], from: Vec3): Vec3 | null {
  let best: Vec3 | null = null, bd = Infinity;
  for (const p of points) {
    const d = flat(from, p);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function nearestOf<T extends { body: Vec3 }>(list: T[], from: Vec3): T | null {
  let best: T | null = null, bd = Infinity;
  for (const c of list) {
    const d = flat(from, c.body);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}
