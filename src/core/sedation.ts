import type { SedationStats } from './config';

export type SedationState = 'awake' | 'collapsed' | 'bound';
export type SedationEvent = 'none' | 'collapsed' | 'woke';

/**
 * Pure sedation math for one gorilla. The meter fills from darts, holds briefly after each
 * hit, then decays; at max it knocks the gorilla out for a fixed downtime.
 */
export class SedationMeter {
  value = 0;
  state: SedationState = 'awake';
  /** Seconds until the gorilla wakes; zero while awake. */
  remainingDowntime = 0;
  private holdRemaining = 0;

  constructor(private readonly stats: SedationStats) {}

  get isDown(): boolean {
    return this.state !== 'awake';
  }

  get normalized(): number {
    return this.stats.maxSedation <= 0 ? 0 : this.value / this.stats.maxSedation;
  }

  /** Move speed multiplier while awake: partial doses slow the gorilla. */
  get speedMultiplier(): number {
    return this.isDown ? 0 : 1 - this.stats.maxSlow * this.normalized;
  }

  /** Adds sedation. Returns true if this dose knocked the gorilla out. Ignored while down. */
  add(amount: number): boolean {
    if (this.isDown || amount <= 0) return false;
    this.value = Math.min(this.stats.maxSedation, this.value + amount);
    this.holdRemaining = this.stats.decayDelaySeconds;
    if (this.value < this.stats.maxSedation) return false;
    this.state = 'collapsed';
    this.remainingDowntime = this.stats.collapseSeconds;
    return true;
  }

  /** @param downtimeRate how fast the knockout clock runs (slower while dragged) */
  tick(dt: number, downtimeRate = 1): SedationEvent {
    if (dt <= 0) return 'none';
    if (!this.isDown) {
      const held = Math.min(this.holdRemaining, dt);
      this.holdRemaining -= held;
      this.value = Math.max(0, this.value - this.stats.decayPerSecond * (dt - held));
      return 'none';
    }
    this.remainingDowntime -= dt * downtimeRate;
    if (this.remainingDowntime > 0) return 'none';
    this.wake();
    return 'woke';
  }

  /** Tie up a knocked-out gorilla: the knockout resets to the bound duration. */
  bind(): boolean {
    if (this.state !== 'collapsed') return false;
    this.state = 'bound';
    this.remainingDowntime = this.stats.boundSeconds;
    return true;
  }

  /** A teammate slaps a downed gorilla: knocks time off its knockout. */
  slap(): SedationEvent {
    if (!this.isDown) return 'none';
    this.remainingDowntime -= this.stats.slapWakeSeconds;
    if (this.remainingDowntime > 0) return 'none';
    this.wake();
    return 'woke';
  }

  wake(): void {
    this.state = 'awake';
    this.value = 0;
    this.remainingDowntime = 0;
    this.holdRemaining = 0;
  }
}
