import { config } from '../core/config';
import { FinisherSelector, LAUNCH_FINISHERS, type FinisherPick } from '../core/finishers';
import { InfectionRound, type RoundEndReason, type RoundResult } from '../core/round';
import { Rng } from '../core/rng';
import { Block } from '../world/blocks';
import type { Island, Vec3 } from '../world/island';
import { Wildfire } from './wildfire';
import { Gorilla } from './gorilla';
import { Hunter } from './hunter';
import { emptyInput, forwardOf, type InputFrame, type SimContext, type Team } from './types';

export interface PlayerSlot {
  id: number;
  name: string;
  team: Team;
}

export type Weather = 'sunset' | 'mist' | 'storm';
export const WEATHERS: Weather[] = ['sunset', 'mist', 'storm'];

export interface MatchOptions {
  /** Practice: everyone spawns close together and the round skips straight to the hunt. */
  practice: boolean;
  players: PlayerSlot[];
  /** Seeds the round (weather, fire, finishers). Random if left out. */
  seed?: number;
  weather?: Weather;
}

/** A net trap on the ground. */
export interface Net {
  id: number;
  owner: number;
  x: number;
  y: number;
  z: number;
  /** Gorilla caught in it and until when, or null while it waits. */
  caught: number | null;
  until: number;
}

/** A flare: rises, then hangs and burns. */
export interface Flare {
  x: number;
  y: number;
  z: number;
  vy: number;
  born: number;
}

/** Things that happened this step, for effects, sounds and the HUD. */
export type MatchEffect =
  | {
      type: 'kill';
      victim: number;
      killer: number;
      at: Vec3;
      killerAt: Vec3;
      yaw: number;
      pick: FinisherPick;
      finisher: boolean;
      dash?: { x: number; z: number };
      /** Crushed by a ground pound, or caught in the fire. */
      pound?: boolean;
      burn?: boolean;
    }
  | { type: 'pound'; gorilla: number; at: Vec3; height: number }
  | { type: 'leaves'; at: Vec3; count: number; burnt: boolean }
  | { type: 'crater'; at: Vec3 }
  | { type: 'netPlaced'; net: number; at: Vec3 }
  | { type: 'netSprung'; gorilla: number; at: Vec3 }
  | { type: 'flare'; hunter: number; at: Vec3 }
  | { type: 'lightning'; at: Vec3 }
  | { type: 'wakeRoar'; gorilla: number; at: Vec3 }
  | { type: 'chargeDrop'; hunter: number; at: Vec3 }
  | { type: 'streak'; gorilla: number }
  | { type: 'burning'; id: number }
  | { type: 'dartHit'; target: number | null; at: Vec3 }
  | { type: 'knockout'; gorilla: number }
  | { type: 'slap'; gorilla: number; at: Vec3 }
  | { type: 'swipe'; gorilla: number }
  | { type: 'shot'; hunter: number }
  | { type: 'convert'; id: number; at: Vec3 }
  | { type: 'thrownOff'; hunter: number }
  | { type: 'roundEnd'; result: RoundResult; reason: RoundEndReason };

export interface Dart {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  owner: number;
  life: number;
  stuck: boolean;
  stuckTo: number | null;
}

const S = config.sedation;
const H = config.hunter;

/**
 * Runs an infection round: owns every character, darts, sedation, dragging, boats, kills and
 * the round rules. In multiplayer this runs on the host only.
 */
export class Match {
  readonly ctx: SimContext;
  readonly gorillas = new Map<number, Gorilla>();
  readonly hunters = new Map<number, Hunter>();
  readonly darts: Dart[] = [];
  readonly effects: MatchEffect[] = [];
  readonly round: InfectionRound;
  announcement = '';
  /** Test hook: the next kill plays this finisher id. */
  forceFinisher: string | null = null;
  announcementUntil = 0;

  private readonly finishers: FinisherSelector;
  private readonly rng: Rng;
  readonly seed: number;
  readonly weather: Weather;
  readonly wildfire: Wildfire;
  readonly nets: Net[] = [];
  readonly flares: Flare[] = [];
  private nextNetId = 1;
  private nextLightning = Infinity;
  /** Seconds each character has spent in the fire (resets slowly once safe). */
  readonly heat = new Map<number, number>();

  constructor(
    readonly island: Island,
    readonly options: MatchOptions,
  ) {
    // Every round starts on the island as generated: no craters, no ash.
    island.world.restore();
    this.ctx = { world: island.world, vines: island.vines, time: 0 };
    this.seed = options.seed ?? ((Math.random() * 1e9) | 0);
    this.rng = new Rng(this.seed);
    this.finishers = new FinisherSelector(LAUNCH_FINISHERS, config.finishers, this.rng.seed());
    this.weather = options.weather ?? WEATHERS[this.rng.int(WEATHERS.length)];
    if (this.weather === 'storm') this.nextLightning = 8 + this.rng.next() * 10;
    const fireAt = { x: this.rng.range(-12, 12), z: this.rng.range(-12, 12) };
    this.wildfire = new Wildfire(island.world, fireAt, config.match.roundSeconds - config.match.fireStartSeconds);

    let gi = 0, hi = 0;
    for (const p of options.players) {
      if (p.team === 'gorilla') this.addGorilla(p.id, p.name, this.gorillaSpawn(gi++));
      else this.addHunter(p.id, p.name, this.hunterSpawn(hi++));
    }

    const m = config.match;
    this.round = new InfectionRound(m, this.hunters.keys(), this.gorillas.keys(), {
      phaseChanged: (phase) => {
        if (phase === 'hunt') this.announce('Gorillas released!');
        if (phase === 'wildfire') {
          this.wildfire.start(this.round.roundTime);
          this.announce('WILDFIRE! Get inside the ring before it reaches you');
        }
      },
      hunterRespawned: (id) => {
        const h = this.hunters.get(id);
        if (!h) return;
        h.revive();
        h.setPosition(this.safeSpawn(this.hunterSpawn(id)));
      },
      gorillaConverted: (id) => this.convert(id),
      lastGorillaStanding: (id) => {
        const g = this.gorillas.get(id);
        if (!g) return;
        g.lastStand = true;
        this.announce(`${g.name} is the last gorilla: RAGE MODE`);
      },
      ended: (result, reason) => {
        this.effects.push({ type: 'roundEnd', result, reason });
        const why =
          reason === 'allGorillasConverted' ? 'every gorilla was dragged to a boat'
          : reason === 'timerExpired' ? 'the gorillas outlasted the clock'
          : 'the hunters ran out of lives';
        this.announce(`${result === 'huntersWin' ? 'HUNTERS WIN' : 'GORILLAS WIN'}: ${why}`, 3600);
      },
    });
    this.round.start();
    if (options.practice) this.round.tick(m.briefingSeconds + m.hunterHeadStartSeconds);
  }

  get time(): number {
    return this.ctx.time;
  }

  /** Radius of the safe circle inside the wildfire (Infinity before it starts). */
  get fireRadius(): number {
    return this.wildfire.radius(this.round.roundTime);
  }

  character(id: number): Gorilla | Hunter | undefined {
    return this.gorillas.get(id) ?? this.hunters.get(id);
  }

  announce(text: string, seconds = 3.5): void {
    this.announcement = text;
    this.announcementUntil = this.ctx.time + seconds;
  }

  /** Advances the whole match by dt. Characters without an input stand idle. */
  step(dt: number, inputs: Map<number, InputFrame>): void {
    this.ctx.time += dt;
    this.round.tick(dt);
    const held = this.round.gorillasHeld;
    const huntersHeld = this.round.phase === 'briefing';

    const t = this.ctx.time;
    for (const g of this.gorillas.values()) {
      g.held = held;
      g.rage = g.lastStand || t < g.streakRageUntil;
      g.inFinisher = this.ctx.time < g.finisherUntil;
      g.update(inputs.get(g.id) ?? emptyInput(g.yaw), dt, this.ctx);
      const wasDown = g.sedation.isDown;
      const ev = g.sedation.tick(dt, g.draggedBy !== null ? S.draggedDowntimeRate : 1);
      if (ev === 'woke' && wasDown) this.onGorillaWoke(g);
    }
    for (const h of this.hunters.values()) {
      h.held = huntersHeld;
      const dragged = h.dragging !== null ? this.gorillas.get(h.dragging) : undefined;
      h.dragResist = dragged ? dragged.struggle : 0;
      h.update(inputs.get(h.id) ?? emptyInput(h.yaw), dt, this.ctx);
    }
    for (const g of this.gorillas.values()) if (g.dashing) this.dashHits(g);

    // Dragged bodies follow their hunters; deliveries to a boat convert the gorilla.
    for (const g of [...this.gorillas.values()]) {
      if (g.draggedBy === null) continue;
      const h = this.hunters.get(g.draggedBy);
      if (!h || h.dead || h.dragging !== g.id) {
        g.draggedBy = null;
        continue;
      }
      g.followTo(h.dragAnchor, dt, this.ctx);
      if (this.nearBoat(g.body) || this.nearBoat(h.body)) this.round.reportGorillaSecured(g.id);
    }

    this.stepDarts(dt);
    this.stepNets();
    this.stepFlares(dt);
    this.stepFire(dt);
    this.stepWeather();
  }

  // ------------------------------------------------------------------ Hazards and weather

  private stepFire(dt: number): void {
    const fire = this.wildfire;
    if (!fire.active) return;
    const t = this.ctx.time;
    const ft = this.round.roundTime;
    fire.burn(ft);
    const burnFor = 4;
    for (const c of [...this.gorillas.values(), ...this.hunters.values()]) {
      if (c.team === 'hunter' && c.dead) continue;
      const inFire = fire.outside(c.body, ft);
      const before = this.heat.get(c.id) ?? 0;
      const heat = inFire ? before + dt : Math.max(0, before - dt * 0.5);
      this.heat.set(c.id, heat);
      if (inFire && before === 0) this.effects.push({ type: 'burning', id: c.id });
      if (heat < burnFor) continue;
      this.heat.set(c.id, 0);
      if (c.team === 'hunter') {
        c.kill(t);
        this.effects.push({
          type: 'kill',
          victim: c.id,
          killer: -1,
          at: { x: c.body.x, y: c.body.y, z: c.body.z },
          killerAt: { x: c.body.x, y: c.body.y, z: c.body.z },
          yaw: c.yaw,
          pick: { finisher: LAUNCH_FINISHERS[0], seed: c.id },
          finisher: false,
          burn: true,
        });
        this.announce(`${c.name} burned in the wildfire`);
        this.round.reportHunterKilled(c.id);
      } else if (!c.sedation.isDown) {
        if (c.sedation.add(S.dartSedation)) this.effects.push({ type: 'knockout', gorilla: c.id });
        this.announce(`${c.name} collapsed in the smoke`);
      }
    }
  }

  private stepWeather(): void {
    const t = this.ctx.time;
    if (t < this.nextLightning) return;
    this.nextLightning = t + 12 + this.rng.next() * 14;
    // A flash lights up everyone, wherever they hide.
    for (const g of this.gorillas.values()) g.revealedUntil = t + 1.5;
    for (const h of this.hunters.values()) h.revealedUntil = t + 1.5;
    const a = this.rng.next() * Math.PI * 2;
    this.effects.push({ type: 'lightning', at: { x: Math.cos(a) * 40, y: 30, z: Math.sin(a) * 40 } });
  }

  private placeNet(h: Hunter): boolean {
    const mine = this.nets.filter((n) => n.owner === h.id && n.caught === null);
    if (mine.length >= H.netMaxActive) this.nets.splice(this.nets.indexOf(mine[0]), 1); // the oldest one is picked up
    const f = forwardOf(h.yaw);
    const net: Net = { id: this.nextNetId++, owner: h.id, x: h.body.x + f.x * 1.2, y: h.body.y, z: h.body.z + f.z * 1.2, caught: null, until: 0 };
    this.nets.push(net);
    this.effects.push({ type: 'netPlaced', net: net.id, at: { x: net.x, y: net.y, z: net.z } });
    return true;
  }

  private stepNets(): void {
    const t = this.ctx.time;
    for (let i = this.nets.length - 1; i >= 0; i--) {
      const n = this.nets[i];
      if (n.caught !== null) {
        const g = this.gorillas.get(n.caught);
        if (t >= n.until || !g) this.nets.splice(i, 1);
        else if (g) {
          // Held in place in the net.
          g.body.x += (n.x - g.body.x) * 0.3;
          g.body.z += (n.z - g.body.z) * 0.3;
        }
        continue;
      }
      for (const g of this.gorillas.values()) {
        if (g.sedation.isDown || !g.body.onGround || g.state !== 'ground') continue;
        if (Math.hypot(g.body.x - n.x, g.body.z - n.z) > H.netRadius || Math.abs(g.body.y - n.y) > 1.2) continue;
        n.caught = g.id;
        n.until = t + H.netHoldSeconds;
        g.netUntil = n.until;
        g.vel = { x: 0, y: 0, z: 0 };
        this.effects.push({ type: 'netSprung', gorilla: g.id, at: { x: g.body.x, y: g.body.y, z: g.body.z } });
        break;
      }
    }
  }

  private fireFlare(h: Hunter): void {
    const t = this.ctx.time;
    this.flares.push({ x: h.body.x, y: h.body.y + 2, z: h.body.z, vy: 16, born: t });
    for (const g of this.gorillas.values())
      if (Math.hypot(g.body.x - h.body.x, g.body.z - h.body.z) <= H.flareRevealRadius) g.revealedUntil = t + H.flareRevealSeconds;
    this.effects.push({ type: 'flare', hunter: h.id, at: { x: h.body.x, y: h.body.y + 2, z: h.body.z } });
  }

  private stepFlares(dt: number): void {
    const t = this.ctx.time;
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      // Rises, slows, then drifts down under its little parachute.
      f.vy = Math.max(-1.2, f.vy - 14 * dt);
      f.y += f.vy * dt;
      if (t - f.born > 8) this.flares.splice(i, 1);
    }
  }

  // ------------------------------------------------------------------ Destruction

  /** Leaves a gorilla bursts through are gone (wood stays). */
  private smash(g: Gorilla): void {
    const w = this.ctx.world, b = g.body, s = w.size;
    let count = 0, burnt = false;
    const pad = 0.35;
    for (let y = b.y; y < b.y + b.height + pad; y += s)
      for (let z = b.z - b.halfWidth - pad; z <= b.z + b.halfWidth + pad; z += s)
        for (let x = b.x - b.halfWidth - pad; x <= b.x + b.halfWidth + pad; x += s) {
          const ix = w.ix(x), iy = w.iy(y), iz = w.iz(z);
          const block = w.get(ix, iy, iz);
          if (block !== Block.Leaves && block !== Block.LeavesDark && block !== Block.BurntLeaves) continue;
          if (block === Block.BurntLeaves) burnt = true;
          if (w.edit(ix, iy, iz, Block.Air)) count++;
        }
    if (count > 0) this.effects.push({ type: 'leaves', at: { x: b.x, y: b.y + b.height / 2, z: b.z }, count, burnt });
  }

  /** Blasts a shallow crater into the ground: a dip of churned mud ringed by bare dirt. */
  crater(at: { x: number; y: number; z: number }, radius: number): void {
    const w = this.ctx.world, s = w.size;
    for (let z = at.z - radius; z <= at.z + radius; z += s)
      for (let x = at.x - radius; x <= at.x + radius; x += s) {
        const d = Math.hypot(x - at.x, z - at.z);
        if (d > radius) continue;
        const ix = w.ix(x), iz = w.iz(z);
        // The ground surface near the impact height.
        let iy = w.iy(at.y + 0.6);
        while (iy > 0 && w.get(ix, iy, iz) === Block.Air) iy--;
        if (iy <= w.iy(config.world.waterLevel) + 1) continue; // no holes to the sea
        const top = w.get(ix, iy, iz);
        if (top === Block.Wood || top === Block.TempleStone || top === Block.MossStone || top === Block.Plank || top === Block.Hull) continue;
        if (d < radius * 0.55) {
          w.edit(ix, iy, iz, Block.Air);
          w.edit(ix, iy - 1, iz, Block.Mud);
        } else w.edit(ix, iy, iz, Block.Dirt);
      }
    this.effects.push({ type: 'crater', at: { x: at.x, y: at.y, z: at.z } });
  }

  private onGroundPound(g: Gorilla, height: number): void {
    const t = this.ctx.time;
    const at = { x: g.body.x, y: g.body.y, z: g.body.z };
    this.effects.push({ type: 'pound', gorilla: g.id, at, height });
    this.crater(at, Math.min(2.4, 1.2 + height * 0.08));
    for (const h of this.hunters.values()) {
      if (h.dead) continue;
      const dx = h.body.x - at.x, dz = h.body.z - at.z;
      const d = Math.hypot(dx, dz);
      if (Math.abs(h.body.y - at.y) > 3) continue;
      if (d < 3.2) {
        // Flattened.
        h.kill(t);
        this.effects.push({
          type: 'kill',
          victim: h.id,
          killer: g.id,
          at: { x: h.body.x, y: h.body.y, z: h.body.z },
          killerAt: at,
          yaw: Math.atan2(dx, dz),
          pick: { finisher: LAUNCH_FINISHERS[0], seed: (Math.floor(t * 1000) * 31 + h.id * 7919) >>> 0 },
          finisher: false,
          pound: true,
        });
        this.round.reportHunterKilled(h.id);
        this.creditKill(g);
      } else if (d < 7.5) {
        // The shockwave knocks the rest flat for a moment.
        const k = (7.5 - d) / 7.5;
        h.applyKnockback((dx / d) * 9 * k, 5 * k, (dz / d) * 9 * k);
        h.stun(0.6 + k * 0.8);
        if (h.dragging !== null) this.dropBody(h);
      }
    }
  }

  /** Three kills without going down: rage for a while. */
  private creditKill(g: Gorilla): void {
    g.streak++;
    if (g.streak === 3 && !g.lastStand) {
      g.streakRageUntil = this.ctx.time + 15;
      this.effects.push({ type: 'streak', gorilla: g.id });
      this.announce(`${g.name} is on a rampage!`);
    }
  }

  private dropBody(h: Hunter): void {
    h.releaseDrag();
    h.stun(1.5);
    this.effects.push({ type: 'chargeDrop', hunter: h.id, at: { x: h.body.x, y: h.body.y + 1, z: h.body.z } });
  }

  // ------------------------------------------------------------------ Spawning

  private addGorilla(id: number, name: string, at: Vec3): Gorilla {
    const g = new Gorilla(id, name, at, {
      swipe: (gg) => this.onSwipe(gg),
      groundPound: (gg, height) => this.onGroundPound(gg, height),
      smash: (gg) => this.smash(gg),
    });
    this.gorillas.set(id, g);
    return g;
  }

  private addHunter(id: number, name: string, at: Vec3): Hunter {
    const h = new Hunter(id, name, at, {
      fireDart: (hh, from, dir) => this.fireDart(hh, from, dir),
      findDownedGorilla: (hh) => this.findDownedGorilla(hh),
      beginDrag: (hh, gid) => this.beginDrag(hh, gid),
      endDrag: (hh) => this.endDrag(hh),
      bind: (_hh, gid) => this.gorillas.get(gid)?.sedation.bind() ?? false,
      placeNet: (hh) => this.placeNet(hh),
      fireFlare: (hh) => this.fireFlare(hh),
    });
    this.hunters.set(id, h);
    return h;
  }

  private gorillaSpawn(index: number): Vec3 {
    const list = this.options.practice ? this.island.practiceGorillas : this.island.gorillaSpawns;
    return list[index % list.length];
  }

  /** A spawn point, moved inside the fire ring if the fire has reached it. */
  private safeSpawn(p: Vec3): Vec3 {
    const fire = this.wildfire;
    const r0 = this.fireRadius;
    if (!fire.active || Math.hypot(p.x - fire.center.x, p.z - fire.center.z) < r0 - 6) return p;
    const r = Math.max(2, r0 * 0.5);
    const a = Math.atan2(p.z - fire.center.z, p.x - fire.center.x);
    const x = fire.center.x + Math.cos(a) * r, z = fire.center.z + Math.sin(a) * r;
    return { x, y: this.ctx.world.groundHeight(x, z) + 0.05, z };
  }

  private hunterSpawn(index: number): Vec3 {
    if (this.options.practice) return this.island.practiceHunter;
    const list = this.island.hunterSpawns;
    return list[Math.abs(index) % list.length];
  }

  private convert(id: number): void {
    const g = this.gorillas.get(id);
    if (!g) return;
    const at = { x: g.body.x, y: g.body.y + 0.2, z: g.body.z };
    if (g.draggedBy !== null) {
      const dragger = this.hunters.get(g.draggedBy);
      if (dragger) dragger.dragging = null;
    }
    this.gorillas.delete(id);
    const h = this.addHunter(id, g.name, at);
    h.yaw = g.yaw;
    this.effects.push({ type: 'convert', id, at });
    this.announce(`${g.name} reached the boat and joins the hunters!`);
  }

  // ------------------------------------------------------------------ Combat

  private onSwipe(g: Gorilla): void {
    this.effects.push({ type: 'swipe', gorilla: g.id });
    const f = forwardOf(g.yaw);
    const reach = config.gorilla.swipeRange;
    const cx = g.body.x + f.x * reach * 0.55, cz = g.body.z + f.z * reach * 0.55;
    const cy = g.body.y + 1.2;
    const radius = reach * 0.6;

    let finisherStarted = false;
    const t0 = this.ctx.time;
    for (const h of this.hunters.values()) {
      if (h.dead) continue;
      const d = Math.hypot(h.body.x - cx, h.body.y + h.body.height / 2 - cy, h.body.z - cz);
      if (d > radius + h.body.halfWidth) continue;
      h.kill(this.ctx.time);
      // On a streak, only the big ones.
      let pick = t0 < g.streakRageUntil ? this.finishers.pickTop(g.id) : this.finishers.pick(g.id, g.rage);
      const forced = LAUNCH_FINISHERS.find((f) => f.id === this.forceFinisher);
      if (forced) pick = { ...pick, finisher: forced };
      // The first victim gets the full finisher: the gorilla turns to face him and is locked in.
      const finisher = !finisherStarted;
      if (finisher) {
        finisherStarted = true;
        g.yaw = Math.atan2(h.body.x - g.body.x, h.body.z - g.body.z);
        g.finisherUntil = this.ctx.time + pick.finisher.duration;
      }
      this.effects.push({
        type: 'kill',
        victim: h.id,
        killer: g.id,
        at: { x: h.body.x, y: h.body.y, z: h.body.z },
        killerAt: { x: g.body.x, y: g.body.y, z: g.body.z },
        yaw: g.yaw,
        pick,
        finisher,
      });
      this.round.reportHunterKilled(h.id);
      this.creditKill(g);
      // Slammed into the ground hard enough to dent it.
      if (pick.finisher.id === 'ragdoll_slam') this.crater({ x: h.body.x, y: h.body.y, z: h.body.z }, 1.3);
    }
    for (const other of this.gorillas.values()) {
      if (other === g || !other.sedation.isDown) continue;
      const d = Math.hypot(other.body.x - cx, other.body.z - cz);
      if (d > radius + 1.2) continue;
      other.lastSlappedTime = this.ctx.time;
      this.effects.push({ type: 'slap', gorilla: other.id, at: { x: other.body.x, y: other.body.y + 0.6, z: other.body.z } });
      if (g.wakeRoarReady) {
        // Once a round: a roar and a slap that brings a teammate straight back up.
        g.wakeRoarReady = false;
        other.sedation.wake();
        this.effects.push({ type: 'wakeRoar', gorilla: g.id, at: { x: other.body.x, y: other.body.y + 1, z: other.body.z } });
        this.onGorillaWoke(other);
      } else if (other.sedation.slap() === 'woke') this.onGorillaWoke(other);
    }
  }

  /** A dashing gorilla ploughs straight through any hunter in its path, killing him without stopping. */
  private dashHits(g: Gorilla): void {
    if (g.sedation.isDown || g.inFinisher) return;
    const dir = g.dashDirection;
    for (const h of this.hunters.values()) {
      if (h.dead) continue;
      const dx = h.body.x - g.body.x, dz = h.body.z - g.body.z;
      // Charging at a hunter who is dragging a teammate: he drops the body, even on a near miss.
      if (h.dragging !== null && Math.hypot(dx, dz) < 3.6) this.dropBody(h);
      // A little reach in front so a dash aimed at a hunter connects.
      const ahead = dx * dir.x + dz * dir.z, side = Math.abs(dx * dir.z - dz * dir.x);
      const reach = g.body.halfWidth + h.body.halfWidth;
      if (ahead < -reach || ahead > reach + 0.9 || side > reach + 0.2) continue;
      if (h.body.y > g.body.y + g.body.height || g.body.y > h.body.y + h.body.height) continue;
      h.kill(this.ctx.time);
      this.effects.push({
        type: 'kill',
        victim: h.id,
        killer: g.id,
        at: { x: h.body.x, y: h.body.y, z: h.body.z },
        killerAt: { x: g.body.x, y: g.body.y, z: g.body.z },
        yaw: Math.atan2(dir.x, dir.z),
        // Not a finisher: the seed only varies how he comes apart.
        pick: { finisher: LAUNCH_FINISHERS[0], seed: (Math.floor(this.ctx.time * 1000) * 31 + h.id * 7919) >>> 0 },
        finisher: false,
        dash: { x: dir.x, z: dir.z },
      });
      this.round.reportHunterKilled(h.id);
      this.creditKill(g);
    }
  }

  private onGorillaWoke(g: Gorilla): void {
    if (g.draggedBy !== null) {
      const h = this.hunters.get(g.draggedBy);
      if (h) {
        h.dragging = null;
        h.stun(S.wakeThrowStunSeconds);
        const f = forwardOf(h.yaw);
        h.applyKnockback(f.x * 7, 4, f.z * 7);
        this.effects.push({ type: 'thrownOff', hunter: h.id });
      }
    }
    g.draggedBy = null;
  }

  private fireDart(h: Hunter, from: Vec3, dir: Vec3): void {
    this.effects.push({ type: 'shot', hunter: h.id });
    this.darts.push({
      x: from.x,
      y: from.y,
      z: from.z,
      vx: dir.x * H.dartSpeed,
      vy: dir.y * H.dartSpeed,
      vz: dir.z * H.dartSpeed,
      owner: h.id,
      life: H.dartLifetime,
      stuck: false,
      stuckTo: null,
    });
  }

  private stepDarts(dt: number): void {
    for (let i = this.darts.length - 1; i >= 0; i--) {
      const d = this.darts[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.darts.splice(i, 1);
        continue;
      }
      if (d.stuck) {
        const g = d.stuckTo !== null ? this.gorillas.get(d.stuckTo) : undefined;
        if (d.stuckTo !== null && !g) this.darts.splice(i, 1);
        continue;
      }
      d.vy -= H.dartGravity * dt;
      const len = Math.hypot(d.vx, d.vy, d.vz) * dt;
      const nx = d.vx / (len / dt), ny = d.vy / (len / dt), nz = d.vz / (len / dt);

      // Nearest gorilla box along the segment, then the world.
      let hitT = Infinity, hitG: Gorilla | null = null;
      for (const g of this.gorillas.values()) {
        const t = rayBox(d.x, d.y, d.z, nx, ny, nz, g.body.x - g.body.halfWidth, g.body.y, g.body.z - g.body.halfWidth,
          g.body.x + g.body.halfWidth, g.body.y + g.body.height, g.body.z + g.body.halfWidth);
        if (t >= 0 && t <= len && t < hitT) {
          hitT = t;
          hitG = g;
        }
      }
      const wt = this.ctx.world.raycast(d.x, d.y, d.z, nx, ny, nz, len);
      if (wt >= 0 && wt < hitT) {
        d.x += nx * wt;
        d.y += ny * wt;
        d.z += nz * wt;
        d.stuck = true;
        d.life = 25; // stays stuck in the bark for a while
        this.effects.push({ type: 'dartHit', target: null, at: { x: d.x, y: d.y, z: d.z } });
        continue;
      }
      if (hitG) {
        d.x += nx * hitT;
        d.y += ny * hitT;
        d.z += nz * hitT;
        d.stuck = true;
        d.stuckTo = hitG.id;
        d.life = 2;
        this.effects.push({ type: 'dartHit', target: hitG.id, at: { x: d.x, y: d.y, z: d.z } });
        if (hitG.sedation.add(S.dartSedation)) {
          this.effects.push({ type: 'knockout', gorilla: hitG.id });
          this.announce(`${hitG.name} is down! Grab him (E) and drag him to a boat`);
        }
        continue;
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
    }
  }

  // ------------------------------------------------------------------ Dragging and boats

  private findDownedGorilla(h: Hunter): number | null {
    let best: number | null = null;
    let bestD = H.interactReach + config.gorilla.halfWidth;
    for (const g of this.gorillas.values()) {
      if (!g.sedation.isDown || g.draggedBy !== null) continue;
      const d = Math.hypot(g.body.x - h.body.x, g.body.z - h.body.z);
      if (d < bestD && Math.abs(g.body.y - h.body.y) < 2) {
        bestD = d;
        best = g.id;
      }
    }
    return best;
  }

  private beginDrag(h: Hunter, gorillaId: number): boolean {
    const g = this.gorillas.get(gorillaId);
    if (!g || !g.sedation.isDown || g.draggedBy !== null) return false;
    g.draggedBy = h.id;
    return true;
  }

  private endDrag(h: Hunter): void {
    for (const g of this.gorillas.values()) if (g.draggedBy === h.id) g.draggedBy = null;
  }

  private nearBoat(p: { x: number; z: number }): boolean {
    return this.island.docks.some((d) => Math.hypot(d.zone.x - p.x, d.zone.z - p.z) <= config.match.boatZoneRadius);
  }
}

/** Ray vs axis-aligned box (slab method). Returns the entry distance, or -1. */
export function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  let tmin = -Infinity, tmax = Infinity;
  for (const [o, d, a, b] of [[ox, dx, x0, x1], [oy, dy, y0, y1], [oz, dz, z0, z1]]) {
    if (Math.abs(d) < 1e-9) {
      if (o < a || o > b) return -1;
      continue;
    }
    let t1 = (a - o) / d, t2 = (b - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmax < 0 ? -1 : Math.max(0, tmin);
}
