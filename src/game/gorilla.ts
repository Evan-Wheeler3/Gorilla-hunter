import { config } from '../core/config';
import { SedationMeter } from '../core/sedation';
import { moveBody, overlaps, type Body } from '../physics/body';
import { isClimbable } from '../world/blocks';
import type { Vec3 } from '../world/island';
import { forwardOf, rightOf, type InputFrame, type SimContext } from './types';

export type GorillaState = 'ground' | 'climb' | 'mantle' | 'swing' | 'down';

const G = config.gorilla;
const GRAVITY = config.world.gravity;
const ANCHOR_REATTACH_DELAY = 0.4;
const RECLIMB_DELAY = 0.35;
const STEP_HEIGHT = 1.0;

export interface GorillaEvents {
  swipe(g: Gorilla): void;
}

/**
 * Gorilla movement and melee: knuckle-run, dash, jump, climbing trunks and walls with mantling
 * onto ledges, pendulum vine swinging, and the swipe. Sedation and dragging are set by the match.
 */
export class Gorilla {
  readonly team = 'gorilla' as const;
  readonly body: Body;
  vel = { x: 0, y: 0, z: 0 };
  yaw = 0;
  state: GorillaState = 'ground';
  stamina = G.maxStamina;
  rage = false;
  held = false;
  readonly sedation = new SedationMeter(config.sedation);
  /** Id of the hunter dragging this gorilla's body, or null. */
  draggedBy: number | null = null;

  // Animation hints for the view.
  lastSwipeTime = -10;
  lastSlappedTime = -10;
  stride = 0; // distance travelled on the ground, drives the run cycle
  climbFacing = { x: 0, z: 1 };
  swingAnchor: Vec3 | null = null;

  private dashTimer = 0;
  private dashCooldown = 0;
  private dashDir = { x: 0, z: 1 };
  private landingSlow = 0;
  private airFromSwing = false;
  private swipeCooldown = 0;
  private reclimbAt = 0;
  private mantleFrom = { x: 0, y: 0, z: 0 };
  private mantleTo = { x: 0, y: 0, z: 0 };
  private mantleT = 0;
  private ropeLength = 0;
  private lastReleased: Vec3 | null = null;
  private lastReleaseTime = -10;

  constructor(
    readonly id: number,
    public name: string,
    spawn: Vec3,
    private readonly events: GorillaEvents,
  ) {
    this.body = { x: spawn.x, y: spawn.y, z: spawn.z, halfWidth: G.halfWidth, height: G.height, onGround: false };
  }

  get isDown(): boolean {
    return this.sedation.isDown;
  }

  get center(): Vec3 {
    return { x: this.body.x, y: this.body.y + this.body.height / 2, z: this.body.z };
  }

  get dashing(): boolean {
    return this.dashTimer > 0;
  }

  get landingSlowed(): boolean {
    return this.landingSlow > 0;
  }

  /** Nearest vine anchor in reach (for the HUD prompt and attaching). */
  anchorInRange(ctx: SimContext): Vec3 | null {
    if (this.state === 'down' || this.state === 'swing') return null;
    const c = this.center;
    const exclude = ctx.time - this.lastReleaseTime < ANCHOR_REATTACH_DELAY ? this.lastReleased : null;
    let best: Vec3 | null = null;
    let bestD = G.swingAttachRange * G.swingAttachRange;
    for (const a of ctx.anchors) {
      if (a === exclude || a.y < c.y + 0.3) continue;
      const d = (a.x - c.x) ** 2 + (a.y - c.y) ** 2 + (a.z - c.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  setPosition(p: Vec3): void {
    this.body.x = p.x;
    this.body.y = p.y;
    this.body.z = p.z;
    this.vel = { x: 0, y: 0, z: 0 };
    if (this.state !== 'down') this.state = 'ground';
    this.swingAnchor = null;
  }

  refillStamina(): void {
    this.stamina = G.maxStamina;
  }

  private cost(amount: number): number {
    return this.rage ? 0 : amount;
  }

  update(input: InputFrame, dt: number, ctx: SimContext): void {
    if (dt <= 0) return;
    if (this.held) input = { ...input, moveX: 0, moveY: 0, jump: false, dash: false, primary: false, primaryHeld: false };

    this.dashTimer -= dt;
    this.dashCooldown -= dt;
    this.landingSlow -= dt;
    this.swipeCooldown -= dt;

    if (this.sedation.isDown && this.state !== 'down') this.enterDown();
    if (!this.sedation.isDown && this.state === 'down') this.exitDown();

    switch (this.state) {
      case 'ground':
        this.updateGround(input, dt, ctx);
        break;
      case 'climb':
        this.updateClimb(input, dt, ctx);
        break;
      case 'mantle':
        this.updateMantle(dt);
        break;
      case 'swing':
        this.updateSwing(input, dt, ctx);
        break;
      case 'down':
        this.updateDown(dt, ctx);
        break;
    }
  }

  // ------------------------------------------------------------------ Ground and air

  private updateGround(input: InputFrame, dt: number, ctx: SimContext): void {
    const f = forwardOf(input.yaw), r = rightOf(input.yaw);
    const wishX = f.x * input.moveY + r.x * input.moveX;
    const wishZ = f.z * input.moveY + r.z * input.moveX;
    const wishLen = Math.hypot(wishX, wishZ);
    const grounded = this.body.onGround;
    const slow = (this.landingSlow > 0 ? G.swingLandingSlowMultiplier : 1) * this.sedation.speedMultiplier;

    // Face the movement direction (or the camera when standing still), smoothly.
    const targetYaw = wishLen > 0.1 ? Math.atan2(wishX, wishZ) : this.yaw;
    this.yaw = turnToward(this.yaw, targetYaw, 12 * dt);

    if (input.dash && this.dashCooldown <= 0 && this.stamina >= this.cost(G.dashStaminaCost)) {
      this.dashTimer = G.dashDuration;
      this.dashCooldown = G.dashCooldown;
      this.stamina -= this.cost(G.dashStaminaCost);
      this.dashDir = wishLen > 0.1 ? { x: wishX / wishLen, z: wishZ / wishLen } : forwardOf(this.yaw);
    }

    let hx = this.vel.x, hz = this.vel.z;
    if (this.dashTimer > 0) {
      hx = this.dashDir.x * G.dashSpeed;
      hz = this.dashDir.z * G.dashSpeed;
    } else if (grounded) {
      [hx, hz] = moveToward(hx, hz, wishX * G.groundSpeed * slow, wishZ * G.groundSpeed * slow, G.groundAcceleration * dt);
    } else {
      [hx, hz] = airAccelerate(hx, hz, wishX, wishZ, G.groundSpeed, G.airAcceleration * dt);
    }

    let vy = this.vel.y;
    if (grounded) {
      this.stamina = Math.min(G.maxStamina, this.stamina + G.groundStaminaRegenPerSecond * dt);
      vy = input.jump ? Math.sqrt(2 * GRAVITY * G.jumpHeight) : -1;
    } else {
      vy -= GRAVITY * dt;
    }
    this.vel = { x: hx, y: vy, z: hz };

    const hit = moveBody(ctx.world, this.body, hx * dt, vy * dt, hz * dt, grounded ? STEP_HEIGHT : 0);
    if (hit.hitY && vy > 0) this.vel.y = 0;
    if (hit.hitX) this.vel.x = 0;
    if (hit.hitZ) this.vel.z = 0;
    if (this.body.onGround) this.stride += Math.hypot(hx, hz) * dt;

    if (!grounded && this.body.onGround) {
      if (this.airFromSwing) this.landingSlow = G.swingLandingSlowDuration;
      this.airFromSwing = false;
    }

    // Holding forward into a trunk or wall starts a climb.
    if (input.moveY > 0.5 && this.stamina > 0 && ctx.time >= this.reclimbAt) {
      const facing = this.probeClimb(ctx, f.x, f.z);
      if (facing) {
        this.state = 'climb';
        this.climbFacing = facing;
        this.vel = { x: 0, y: 0, z: 0 };
        this.dashTimer = 0;
        return;
      }
    }

    const anchor = this.anchorInRange(ctx);
    if (input.primaryHeld && anchor && this.stamina >= this.cost(G.swingAttachStaminaCost)) {
      this.enterSwing(anchor);
      return;
    }
    if (input.primary) this.trySwipe(input.yaw, ctx);
  }

  private trySwipe(cameraYaw: number, ctx: SimContext): void {
    if (this.swipeCooldown > 0) return;
    this.swipeCooldown = G.swipeCooldown * (this.rage ? G.rageSwipeCooldownMultiplier : 1);
    this.yaw = cameraYaw; // swipe where the player is looking
    this.lastSwipeTime = ctx.time;
    this.events.swipe(this);
  }

  // ------------------------------------------------------------------ Climbing

  /** Axis-aligned facing toward a climbable surface just ahead, or null. */
  private probeClimb(ctx: SimContext, fx: number, fz: number): { x: number; z: number } | null {
    const ax = Math.abs(fx) >= Math.abs(fz) ? Math.sign(fx) : 0;
    const az = ax === 0 ? Math.sign(fz) : 0;
    const reach = this.body.halfWidth + 0.3;
    for (const h of [0.6, 1.4, 2.2]) {
      const b = ctx.world.blockAt(this.body.x + ax * reach, this.body.y + h, this.body.z + az * reach);
      if (isClimbable(b)) return { x: ax, z: az };
    }
    return null;
  }

  private updateClimb(input: InputFrame, dt: number, ctx: SimContext): void {
    this.stamina -= this.cost(G.climbStaminaDrainPerSecond) * dt;
    const f = this.climbFacing;
    if (this.stamina <= 0) {
      this.stamina = 0;
      this.exitClimb(-f.x * 2, 0, -f.z * 2, ctx);
      return;
    }
    if (input.jump) {
      this.exitClimb(-f.x * G.climbJumpOffSpeed, G.climbJumpOffSpeed * 0.8, -f.z * G.climbJumpOffSpeed, ctx);
      return;
    }
    this.yaw = Math.atan2(f.x, f.z);
    const r = { x: -f.z, z: f.x };
    const speed = G.climbSpeed * this.sedation.speedMultiplier;
    const up = input.moveY * speed;
    const side = input.moveX * speed * 0.6;
    this.vel = { x: 0, y: up, z: 0 };
    const hit = moveBody(ctx.world, this.body, (r.x * side + f.x * 0.5) * dt, up * dt, (r.z * side + f.z * 0.5) * dt);
    this.stride += Math.abs(up) * dt;

    // Head bumped a branch or crown, or the wall ran out: climb up onto the ledge.
    const wallAtHead = isClimbable(
      ctx.world.blockAt(this.body.x + f.x * (this.body.halfWidth + 0.3), this.body.y + this.body.height - 0.3, this.body.z + f.z * (this.body.halfWidth + 0.3)),
    );
    if (up > 0 && (hit.hitY || !wallAtHead) && this.tryMantle(ctx)) return;

    if (!this.probeClimb(ctx, f.x, f.z)) {
      this.exitClimb(0, up > 0 ? 3 : 0, 0, ctx);
      return;
    }
    if (up < 0 && this.body.onGround) this.exitClimb(0, 0, 0, ctx);
  }

  private exitClimb(vx: number, vy: number, vz: number, ctx: SimContext): void {
    this.state = 'ground';
    this.vel = { x: vx, y: vy, z: vz };
    this.reclimbAt = ctx.time + RECLIMB_DELAY;
  }

  /** Finds a standable spot just above, overhead or ahead, and starts a mantle onto it. */
  private tryMantle(ctx: SimContext): boolean {
    const f = this.climbFacing;
    const b = this.body;
    const columns = [
      { x: b.x + f.x * (b.halfWidth + 0.6), z: b.z + f.z * (b.halfWidth + 0.6) },
      { x: b.x, z: b.z },
      { x: b.x + f.x * (b.halfWidth + 1.4), z: b.z + f.z * (b.halfWidth + 1.4) },
    ];
    const s = ctx.world.size;
    for (const c of columns) {
      for (let ty = Math.ceil((b.y + 0.4) / s) * s; ty <= b.y + b.height + 2.5; ty += s) {
        if (!ctx.world.solidAt(c.x, ty - s / 2, c.z)) continue;
        if (overlaps(ctx.world, c.x, ty, c.z, b.halfWidth * 0.9, b.height)) continue;
        this.state = 'mantle';
        this.mantleFrom = { x: b.x, y: b.y, z: b.z };
        this.mantleTo = { x: c.x, y: ty + 0.01, z: c.z };
        this.mantleT = 0;
        this.vel = { x: 0, y: 0, z: 0 };
        return true;
      }
    }
    return false;
  }

  private updateMantle(dt: number): void {
    this.mantleT = Math.min(1, this.mantleT + dt / G.mantleDuration);
    const t = this.mantleT;
    // Rise first, then move over the edge, so the body clears the lip.
    this.body.x = lerp(this.mantleFrom.x, this.mantleTo.x, t * t);
    this.body.y = lerp(this.mantleFrom.y, this.mantleTo.y, Math.sqrt(t));
    this.body.z = lerp(this.mantleFrom.z, this.mantleTo.z, t * t);
    if (t >= 1) {
      this.state = 'ground';
      this.body.onGround = true;
    }
  }

  // ------------------------------------------------------------------ Swinging

  private enterSwing(anchor: Vec3): void {
    this.state = 'swing';
    this.swingAnchor = anchor;
    const c = this.center;
    this.ropeLength = Math.max(G.swingMinRopeLength, Math.hypot(anchor.x - c.x, anchor.y - c.y, anchor.z - c.z));
    this.stamina -= this.cost(G.swingAttachStaminaCost);
    this.dashTimer = 0;
  }

  private updateSwing(input: InputFrame, dt: number, ctx: SimContext): void {
    const a = this.swingAnchor;
    if (!a || !input.primaryHeld) {
      this.releaseSwing(ctx);
      return;
    }
    const c = this.center;
    const rope = normalize(c.x - a.x, c.y - a.y, c.z - a.z);
    const f = forwardOf(input.yaw), r = rightOf(input.yaw);
    const wish = { x: f.x * input.moveY + r.x * input.moveX, y: 0, z: f.z * input.moveY + r.z * input.moveX };
    // Pump along the tangent plane of the rope.
    const along = wish.x * rope.x + wish.z * rope.z;
    const pump = { x: wish.x - rope.x * along, y: -rope.y * along, z: wish.z - rope.z * along };

    this.vel.y -= GRAVITY * dt;
    this.vel.x += pump.x * G.swingPumpAcceleration * dt;
    this.vel.y += pump.y * G.swingPumpAcceleration * dt;
    this.vel.z += pump.z * G.swingPumpAcceleration * dt;

    let nx = c.x + this.vel.x * dt, ny = c.y + this.vel.y * dt, nz = c.z + this.vel.z * dt;
    const ox = nx - a.x, oy = ny - a.y, oz = nz - a.z;
    const len = Math.hypot(ox, oy, oz);
    if (len > this.ropeLength) {
      nx = a.x + (ox / len) * this.ropeLength;
      ny = a.y + (oy / len) * this.ropeLength;
      nz = a.z + (oz / len) * this.ropeLength;
    }
    let vx = (nx - c.x) / dt, vy = (ny - c.y) / dt, vz = (nz - c.z) / dt;
    const speed = Math.hypot(vx, vy, vz);
    if (speed > G.swingMaxSpeed) {
      const k = G.swingMaxSpeed / speed;
      vx *= k;
      vy *= k;
      vz *= k;
    }
    this.vel = { x: vx, y: vy, z: vz };
    const hSpeed = Math.hypot(vx, vz);
    if (hSpeed > 1) this.yaw = turnToward(this.yaw, Math.atan2(vx, vz), 8 * dt);

    const hit = moveBody(ctx.world, this.body, vx * dt, vy * dt, vz * dt);
    if (hit.hitX) this.vel.x = 0;
    if (hit.hitZ) this.vel.z = 0;
    if (this.body.onGround) {
      this.releaseSwing(ctx);
      this.airFromSwing = false;
    }
  }

  private releaseSwing(ctx: SimContext): void {
    this.lastReleased = this.swingAnchor;
    this.lastReleaseTime = ctx.time;
    this.swingAnchor = null;
    this.airFromSwing = true;
    this.state = 'ground';
  }

  // ------------------------------------------------------------------ Knocked out

  private enterDown(): void {
    this.state = 'down';
    this.swingAnchor = null;
    this.vel = { x: 0, y: Math.min(0, this.vel.y), z: 0 };
    this.body.height = 1.2; // lying down
  }

  private exitDown(): void {
    this.state = 'ground';
    this.body.height = G.height;
    this.draggedBy = null;
  }

  /** Lies still under gravity; when dragged, the match moves the body with followTo(). */
  private updateDown(dt: number, ctx: SimContext): void {
    this.vel.x = 0;
    this.vel.z = 0;
    this.vel.y = this.body.onGround ? -1 : this.vel.y - GRAVITY * dt;
    moveBody(ctx.world, this.body, 0, this.vel.y * dt, 0);
  }

  /** Slides the knocked-out body toward a point behind its dragger. */
  followTo(target: Vec3, dt: number, ctx: SimContext): void {
    const dx = target.x - this.body.x, dz = target.z - this.body.z;
    const max = 15 * dt;
    const d = Math.hypot(dx, dz);
    const k = d > max ? max / d : 1;
    if (d > 0.05) this.yaw = Math.atan2(-dx, -dz); // dragged feet first
    moveBody(ctx.world, this.body, dx * k, 0, dz * k, STEP_HEIGHT);
  }
}

// ---------------------------------------------------------------------- helpers

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function turnToward(current: number, target: number, maxStep: number): number {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + Math.max(-maxStep, Math.min(maxStep, d));
}

export function moveToward(x: number, z: number, tx: number, tz: number, maxDelta: number): [number, number] {
  const dx = tx - x, dz = tz - z;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d === 0) return [tx, tz];
  return [x + (dx / d) * maxDelta, z + (dz / d) * maxDelta];
}

/** Speeds up toward the wish direction without bleeding off swing or dash momentum. */
function airAccelerate(x: number, z: number, wx: number, wz: number, maxSpeed: number, maxDelta: number): [number, number] {
  const len = Math.hypot(wx, wz);
  if (len < 0.01) return [x, z];
  const dx = wx / len, dz = wz / len;
  const add = maxSpeed * Math.min(1, len) - (x * dx + z * dz);
  if (add <= 0) return [x, z];
  const a = Math.min(add, maxDelta);
  return [x + dx * a, z + dz * a];
}

function normalize(x: number, y: number, z: number): Vec3 {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}
