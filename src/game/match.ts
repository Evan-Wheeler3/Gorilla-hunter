import { config } from '../core/config';
import { FinisherSelector, LAUNCH_FINISHERS, type FinisherPick } from '../core/finishers';
import { InfectionRound, type RoundEndReason, type RoundResult } from '../core/round';
import type { Island, Vec3 } from '../world/island';
import { Gorilla } from './gorilla';
import { Hunter } from './hunter';
import { emptyInput, forwardOf, type InputFrame, type SimContext, type Team } from './types';

export interface PlayerSlot {
  id: number;
  name: string;
  team: Team;
}

export interface MatchOptions {
  /** Practice: everyone spawns close together and the round skips straight to the hunt. */
  practice: boolean;
  players: PlayerSlot[];
}

/** Things that happened this step, for effects, sounds and the HUD. */
export type MatchEffect =
  | { type: 'kill'; victim: number; killer: number; at: Vec3; yaw: number; pick: FinisherPick }
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
  announcementUntil = 0;

  private readonly finishers: FinisherSelector;

  constructor(
    readonly island: Island,
    readonly options: MatchOptions,
  ) {
    this.ctx = { world: island.world, anchors: island.anchors, time: 0 };
    this.finishers = new FinisherSelector(LAUNCH_FINISHERS, config.finishers, (Math.random() * 1e9) | 0);

    let gi = 0, hi = 0;
    for (const p of options.players) {
      if (p.team === 'gorilla') this.addGorilla(p.id, p.name, this.gorillaSpawn(gi++));
      else this.addHunter(p.id, p.name, this.hunterSpawn(hi++));
    }

    const m = config.match;
    this.round = new InfectionRound(m, this.hunters.keys(), this.gorillas.keys(), {
      phaseChanged: (phase) => {
        if (phase === 'hunt') this.announce('Gorillas released!');
        if (phase === 'wildfire') this.announce('Halfway! The jungle gets hotter...');
      },
      hunterRespawned: (id) => {
        const h = this.hunters.get(id);
        if (!h) return;
        h.revive();
        h.setPosition(this.hunterSpawn(id));
      },
      gorillaConverted: (id) => this.convert(id),
      lastGorillaStanding: (id) => {
        const g = this.gorillas.get(id);
        if (!g) return;
        g.rage = true;
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

    for (const g of this.gorillas.values()) {
      g.held = held;
      g.update(inputs.get(g.id) ?? emptyInput(g.yaw), dt, this.ctx);
      const wasDown = g.sedation.isDown;
      const ev = g.sedation.tick(dt, g.draggedBy !== null ? S.draggedDowntimeRate : 1);
      if (ev === 'woke' && wasDown) this.onGorillaWoke(g);
    }
    for (const h of this.hunters.values()) {
      h.held = huntersHeld;
      h.update(inputs.get(h.id) ?? emptyInput(h.yaw), dt, this.ctx);
    }

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
  }

  // ------------------------------------------------------------------ Spawning

  private addGorilla(id: number, name: string, at: Vec3): Gorilla {
    const g = new Gorilla(id, name, at, { swipe: (gg) => this.onSwipe(gg) });
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
    });
    this.hunters.set(id, h);
    return h;
  }

  private gorillaSpawn(index: number): Vec3 {
    const list = this.options.practice ? this.island.practiceGorillas : this.island.gorillaSpawns;
    return list[index % list.length];
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

    for (const h of this.hunters.values()) {
      if (h.dead) continue;
      const d = Math.hypot(h.body.x - cx, h.body.y + 0.9 - cy, h.body.z - cz);
      if (d > radius + h.body.halfWidth) continue;
      h.kill(this.ctx.time);
      const pick = this.finishers.pick(g.id, g.rage);
      this.effects.push({ type: 'kill', victim: h.id, killer: g.id, at: { x: h.body.x, y: h.body.y, z: h.body.z }, yaw: g.yaw, pick });
      this.announce(`${g.name}: ${pick.finisher.name}!`);
      this.round.reportHunterKilled(h.id);
    }
    for (const other of this.gorillas.values()) {
      if (other === g || !other.sedation.isDown) continue;
      const d = Math.hypot(other.body.x - cx, other.body.z - cz);
      if (d > radius + 1.2) continue;
      other.lastSlappedTime = this.ctx.time;
      this.effects.push({ type: 'slap', gorilla: other.id, at: { x: other.body.x, y: other.body.y + 0.6, z: other.body.z } });
      if (other.sedation.slap() === 'woke') this.onGorillaWoke(other);
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
        d.life = 3;
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
function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
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
