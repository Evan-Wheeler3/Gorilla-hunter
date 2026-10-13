import { config } from '../core/config';
import { moveBody, type Body } from '../physics/body';
import type { Vec3 } from '../world/island';
import { moveToward, turnToward } from './gorilla';
import { forwardOf, rightOf, type InputFrame, type SimContext } from './types';

const H = config.hunter;
const GRAVITY = config.world.gravity;
const STEP_HEIGHT = 0.5;

export interface HunterEvents {
  fireDart(h: Hunter, from: Vec3, dir: Vec3): void;
  /** Nearest knocked-out, undragged gorilla in reach, or null. */
  findDownedGorilla(h: Hunter): number | null;
  /** Ask the match to start dragging; returns false if someone else got there first. */
  beginDrag(h: Hunter, gorillaId: number): boolean;
  endDrag(h: Hunter): void;
  /** Tie up a knocked-out gorilla (extends the knockout). */
  bind(h: Hunter, gorillaId: number): boolean;
}

/**
 * Hunter movement and tools: walk, (unlimited) sprint, jump, aim, the one-dart auto-reloading
 * rifle, and tapping/holding interact on knocked-out gorillas to drag or tie them up.
 */
export class Hunter {
  readonly team = 'hunter' as const;
  readonly body: Body;
  vel = { x: 0, y: 0, z: 0 };
  yaw = 0;
  pitch = 0;
  dead = false;
  held = false;
  loaded = true;
  reloadTimer = 0;
  stunTimer = 0;
  aiming = false;
  sprinting = false;
  /** Gorilla being dragged, or null. */
  dragging: number | null = null;
  /** Downed gorilla in reach (for the prompt). */
  interactTarget: number | null = null;
  bindProgress = 0;

  // Animation hints for the view.
  stride = 0;
  lastShotTime = -10;
  deathTime = -10;

  private knockback = { x: 0, z: 0 };
  private holdTime = 0;
  private holding = false;

  constructor(
    readonly id: number,
    public name: string,
    spawn: Vec3,
    private readonly events: HunterEvents,
  ) {
    this.body = { x: spawn.x, y: spawn.y, z: spawn.z, halfWidth: H.halfWidth, height: H.height, onGround: false };
  }

  get stunned(): boolean {
    return this.stunTimer > 0;
  }

  get reloadProgress(): number {
    return this.reloadTimer > 0 ? 1 - this.reloadTimer / H.rifleReloadSeconds : 1;
  }

  /** Point behind the hunter that a dragged body is pulled toward. */
  get dragAnchor(): Vec3 {
    const f = forwardOf(this.yaw), r = rightOf(this.yaw);
    const back = H.dragDistance * 0.85, side = -1.2; // behind and to the left, clear of the over-shoulder camera
    return { x: this.body.x - f.x * back + r.x * side, y: this.body.y, z: this.body.z - f.z * back + r.z * side };
  }

  /** Muzzle position: right shoulder, slightly ahead. */
  get muzzle(): Vec3 {
    const f = forwardOf(this.yaw), r = rightOf(this.yaw);
    const k = H.scale;
    return { x: this.body.x + f.x * 0.45 * k + r.x * 0.25 * k, y: this.body.y + 1.42 * k, z: this.body.z + f.z * 0.45 * k + r.z * 0.25 * k };
  }

  setPosition(p: Vec3): void {
    this.body.x = p.x;
    this.body.y = p.y;
    this.body.z = p.z;
    this.vel = { x: 0, y: 0, z: 0 };
    this.knockback = { x: 0, z: 0 };
  }

  kill(time: number): void {
    if (this.dead) return;
    this.dead = true;
    this.deathTime = time;
    this.releaseDrag();
  }

  revive(): void {
    this.dead = false;
    this.loaded = true;
    this.reloadTimer = 0;
    this.stunTimer = 0;
  }

  stun(seconds: number): void {
    this.stunTimer = Math.max(this.stunTimer, seconds);
  }

  applyKnockback(vx: number, vy: number, vz: number): void {
    this.knockback.x += vx;
    this.knockback.z += vz;
    this.vel.y = Math.max(this.vel.y, vy);
  }

  releaseDrag(): void {
    if (this.dragging !== null) this.events.endDrag(this);
    this.dragging = null;
    this.holding = false;
  }

  update(input: InputFrame, dt: number, ctx: SimContext): void {
    if (dt <= 0) return;
    this.stunTimer -= dt;
    if (this.dead || this.stunned || this.held)
      input = { ...input, moveX: 0, moveY: 0, jump: false, primary: false, interact: false, interactHeld: false, aim: false };

    this.updateMovement(input, dt, ctx);
    if (this.dead) return;
    this.updateInteract(input, dt);
    this.updateRifle(input, dt, ctx);
  }

  private updateMovement(input: InputFrame, dt: number, ctx: SimContext): void {
    const f = forwardOf(input.yaw), r = rightOf(input.yaw);
    const wishX = f.x * input.moveY + r.x * input.moveX;
    const wishZ = f.z * input.moveY + r.z * input.moveX;
    const grounded = this.body.onGround;

    this.aiming = input.aim && this.dragging === null;
    this.pitch = input.pitch;
    // Face the camera while aiming, otherwise the movement direction.
    const moving = Math.hypot(wishX, wishZ) > 0.1;
    const targetYaw = this.aiming || !moving ? input.yaw : Math.atan2(wishX, wishZ);
    if (!this.dead) this.yaw = turnToward(this.yaw, targetYaw, (this.aiming ? 20 : 12) * dt);

    this.sprinting = input.sprint && moving && !this.aiming && H.unlimitedSprint;
    const speed = (this.sprinting ? H.sprintSpeed : H.walkSpeed) * (this.aiming ? 0.6 : 1);
    const accel = grounded ? H.groundAcceleration : H.airAcceleration;
    const [hx, hz] = moveToward(this.vel.x, this.vel.z, wishX * speed, wishZ * speed, accel * dt);

    let vy = this.vel.y;
    if (grounded && vy <= 0) vy = input.jump ? Math.sqrt(2 * GRAVITY * H.jumpHeight) : -1;
    else vy -= GRAVITY * dt;

    const damp = Math.exp(-H.knockbackDamping * dt);
    this.knockback.x *= damp;
    this.knockback.z *= damp;
    this.vel = { x: hx, y: vy, z: hz };
    const hit = moveBody(ctx.world, this.body, (hx + this.knockback.x) * dt, vy * dt, (hz + this.knockback.z) * dt, grounded ? STEP_HEIGHT : 0);
    if (hit.hitY && vy > 0) this.vel.y = 0;
    if (this.body.onGround) this.stride += Math.hypot(hx, hz) * dt;
  }

  private updateInteract(input: InputFrame, dt: number): void {
    if (this.dragging !== null) {
      this.interactTarget = null;
      this.bindProgress = 0;
      if (input.interact) this.releaseDrag();
      return;
    }
    this.interactTarget = this.events.findDownedGorilla(this);
    if (this.interactTarget === null) {
      this.holding = false;
      this.bindProgress = 0;
      return;
    }
    if (input.interact) {
      this.holding = true;
      this.holdTime = 0;
    }
    if (!this.holding) return;

    if (input.interactHeld) {
      this.holdTime += dt;
      this.bindProgress = Math.min(1, this.holdTime / config.sedation.bindSeconds);
      if (this.holdTime >= config.sedation.bindSeconds) {
        this.events.bind(this, this.interactTarget);
        this.holding = false;
        this.bindProgress = 0;
      }
      return;
    }
    // Released quickly: a tap grabs the body.
    this.holding = false;
    this.bindProgress = 0;
    if (this.holdTime <= H.tapMaxSeconds && this.events.beginDrag(this, this.interactTarget)) this.dragging = this.interactTarget;
  }

  private updateRifle(input: InputFrame, dt: number, ctx: SimContext): void {
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.reloadTimer = 0;
        this.loaded = true;
      }
      return;
    }
    if (!input.primary || !this.loaded || this.dragging !== null) return;

    const from = this.muzzle;
    const target = input.aimPoint ?? (() => {
      const f = forwardOf(input.yaw);
      return { x: from.x + f.x * 100, y: from.y + Math.tan(input.pitch) * 100, z: from.z + f.z * 100 };
    })();
    const dx = target.x - from.x, dy = target.y - from.y, dz = target.z - from.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    this.yaw = input.yaw;
    this.events.fireDart(this, from, { x: dx / len, y: dy / len, z: dz / len });
    this.loaded = false;
    this.lastShotTime = ctx.time;
    if (H.rifleAutoReload) this.reloadTimer = H.rifleReloadSeconds;
  }
}
