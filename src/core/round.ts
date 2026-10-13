import type { MatchStats } from './config';

export type RoundPhase = 'briefing' | 'headStart' | 'hunt' | 'wildfire' | 'ended';
export type RoundResult = 'none' | 'huntersWin' | 'gorillasWin';
export type RoundEndReason = 'none' | 'allGorillasConverted' | 'timerExpired' | 'huntersEliminated';

export interface RoundEvents {
  phaseChanged?(phase: RoundPhase): void;
  hunterRespawned?(id: number): void;
  gorillaConverted?(id: number): void;
  lastGorillaStanding?(id: number): void;
  ended?(result: RoundResult, reason: RoundEndReason): void;
}

/**
 * Host-side rules for one infection round. Hunters win by converting every gorilla (dragging
 * it to a boat); gorillas win when the timer runs out, or when the shared life pool is empty
 * and every hunter is dead.
 */
export class InfectionRound {
  phase: RoundPhase = 'briefing';
  result: RoundResult = 'none';
  endReason: RoundEndReason = 'none';
  /** Seconds since the briefing ended (the round clock, head start included). */
  roundTime = 0;
  briefingRemaining = 0;
  livesRemaining: number;
  /** The only gorilla left, or null. */
  lastGorilla: number | null = null;

  readonly gorillas: Set<number>;
  readonly aliveHunters = new Set<number>();
  readonly deadHunters = new Set<number>();
  private readonly respawnTimers = new Map<number, number>();

  constructor(
    private readonly stats: MatchStats,
    hunters: Iterable<number>,
    gorillas: Iterable<number>,
    private readonly events: RoundEvents = {},
  ) {
    this.gorillas = new Set(gorillas);
    for (const id of hunters) {
      if (this.gorillas.has(id)) throw new Error(`Player ${id} is on both teams.`);
      this.aliveHunters.add(id);
    }
    if (this.gorillas.size === 0 || this.aliveHunters.size === 0)
      throw new Error('A round needs at least one hunter and one gorilla.');
    this.livesRemaining = stats.sharedHunterLives;
    this.updateLastGorilla();
  }

  get timeRemaining(): number {
    return Math.max(0, this.stats.roundSeconds - this.roundTime);
  }

  /** Gorillas may not leave the nest yet. */
  get gorillasHeld(): boolean {
    return this.phase === 'briefing' || this.phase === 'headStart';
  }

  private get inPlay(): boolean {
    return this.phase === 'headStart' || this.phase === 'hunt' || this.phase === 'wildfire';
  }

  start(): void {
    this.briefingRemaining = this.stats.briefingSeconds;
    this.setPhase('briefing');
    if (this.lastGorilla !== null) this.events.lastGorillaStanding?.(this.lastGorilla);
  }

  tick(dt: number): void {
    if (this.phase === 'ended' || dt <= 0) return;
    if (this.phase === 'briefing') {
      this.briefingRemaining -= dt;
      if (this.briefingRemaining > 0) return;
      dt = -this.briefingRemaining; // carry the overshoot into the round clock
      this.briefingRemaining = 0;
      this.setPhase('headStart');
    }

    this.roundTime += dt;
    this.tickRespawns(dt);

    if (this.phase === 'headStart' && this.roundTime >= this.stats.hunterHeadStartSeconds) this.setPhase('hunt');
    if (this.phase === 'hunt' && this.roundTime >= this.stats.fireStartSeconds) this.setPhase('wildfire');
    if (this.roundTime >= this.stats.roundSeconds) this.end('gorillasWin', 'timerExpired');
  }

  /** A hunter died. Spends a life from the shared pool to respawn them, if any are left. */
  reportHunterKilled(id: number): boolean {
    if (!this.inPlay || !this.aliveHunters.delete(id)) return false;
    this.deadHunters.add(id);
    if (this.livesRemaining > 0) {
      this.livesRemaining--;
      this.respawnTimers.set(id, this.stats.hunterRespawnSeconds);
    }
    this.checkHuntersEliminated();
    return true;
  }

  /** A knocked-out gorilla reached a boat: it joins the hunters immediately. */
  reportGorillaSecured(id: number): boolean {
    if (!this.inPlay || !this.gorillas.delete(id)) return false;
    this.aliveHunters.add(id);
    this.events.gorillaConverted?.(id);
    if (this.gorillas.size === 0) {
      this.end('huntersWin', 'allGorillasConverted');
      return true;
    }
    this.updateLastGorilla();
    if (this.lastGorilla !== null) this.events.lastGorillaStanding?.(this.lastGorilla);
    return true;
  }

  /** A player left mid-round. */
  removePlayer(id: number): void {
    if (this.phase === 'ended') return;
    if (this.gorillas.delete(id)) {
      if (this.gorillas.size === 0) {
        this.end('huntersWin', 'allGorillasConverted');
        return;
      }
      const previous = this.lastGorilla;
      this.updateLastGorilla();
      if (this.lastGorilla !== null && this.lastGorilla !== previous) this.events.lastGorillaStanding?.(this.lastGorilla);
      return;
    }
    this.aliveHunters.delete(id);
    this.deadHunters.delete(id);
    this.respawnTimers.delete(id);
    this.checkHuntersEliminated();
  }

  isRespawning(id: number): boolean {
    return this.respawnTimers.has(id);
  }

  respawnRemaining(id: number): number {
    return Math.max(0, this.respawnTimers.get(id) ?? 0);
  }

  private tickRespawns(dt: number): void {
    const respawned: number[] = [];
    for (const [id, t] of this.respawnTimers) {
      const left = t - dt;
      this.respawnTimers.set(id, left);
      if (left <= 0) respawned.push(id);
    }
    for (const id of respawned) {
      this.respawnTimers.delete(id);
      this.deadHunters.delete(id);
      this.aliveHunters.add(id);
      this.events.hunterRespawned?.(id);
    }
  }

  private checkHuntersEliminated(): void {
    if (this.phase !== 'ended' && this.aliveHunters.size === 0 && this.respawnTimers.size === 0)
      this.end('gorillasWin', 'huntersEliminated');
  }

  private updateLastGorilla(): void {
    this.lastGorilla = null;
    if (!this.stats.lastGorillaGetsPermanentRage || this.gorillas.size !== 1) return;
    for (const id of this.gorillas) this.lastGorilla = id;
  }

  private setPhase(phase: RoundPhase): void {
    this.phase = phase;
    this.events.phaseChanged?.(phase);
  }

  private end(result: RoundResult, reason: RoundEndReason): void {
    if (this.phase === 'ended') return;
    this.result = result;
    this.endReason = reason;
    this.respawnTimers.clear();
    this.setPhase('ended');
    this.events.ended?.(result, reason);
  }
}
