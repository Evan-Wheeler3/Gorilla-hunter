import type { FinisherStats } from './config';
import { Rng } from './rng';

export type FinisherRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export interface FinisherDefinition {
  id: string;
  name: string;
  rarity: FinisherRarity;
}

/** A finisher picked for one kill. Every client replays the same animation and debris from the seed. */
export interface FinisherPick {
  finisher: FinisherDefinition;
  seed: number;
}

/** The 8 launch finishers from design doc section 6. */
export const LAUNCH_FINISHERS: FinisherDefinition[] = [
  { id: 'rip_in_half', name: 'Rip in Half', rarity: 'common' },
  { id: 'head_pop', name: 'Head Pop', rarity: 'common' },
  { id: 'arm_rip', name: 'Arm Rip', rarity: 'common' },
  { id: 'twirl_and_throw', name: 'Twirl and Throw', rarity: 'common' },
  { id: 'crumple_ball', name: 'Crumple Ball', rarity: 'uncommon' },
  { id: 'head_clap', name: 'Head Clap', rarity: 'uncommon' },
  { id: 'ragdoll_slam', name: 'Ragdoll Slam', rarity: 'uncommon' },
  { id: 'drum_solo', name: 'Drum Solo', rarity: 'legendary' },
];

const TIERS: FinisherRarity[] = ['common', 'uncommon', 'rare', 'legendary'];

/**
 * Picks a rarity tier by weight, then a finisher uniformly within it, never repeating the same
 * gorilla's last finisher or any of the match's last few. Deterministic for a given seed.
 */
export class FinisherSelector {
  private readonly rng: Rng;
  private readonly lastByGorilla = new Map<number, string>();
  private readonly recent: string[] = [];

  constructor(
    private readonly catalog: FinisherDefinition[],
    private readonly stats: FinisherStats,
    seed: number,
  ) {
    if (catalog.length === 0) throw new Error('Finisher catalog is empty.');
    this.rng = new Rng(seed);
  }

  pick(gorillaId: number, rage: boolean): FinisherPick {
    const lastForGorilla = this.lastByGorilla.get(gorillaId);
    // Strict rules first; relax the match window, then everything, if the catalog is too small.
    let candidates = this.collect(lastForGorilla, true);
    if (candidates.length === 0) candidates = this.collect(lastForGorilla, false);
    if (candidates.length === 0) candidates = this.collect(undefined, false);

    const chosen = this.pickFrom(candidates, rage);
    this.lastByGorilla.set(gorillaId, chosen.id);
    this.recent.push(chosen.id);
    while (this.recent.length > Math.max(0, this.stats.matchNoRepeatWindow)) this.recent.shift();
    return { finisher: chosen, seed: this.rng.seed() };
  }

  resetGorillaHistory(): void {
    this.lastByGorilla.clear();
  }

  tierWeight(tier: FinisherRarity, rage: boolean): number {
    const boost = rage ? this.stats.rageRareAndLegendaryMultiplier : 1;
    switch (tier) {
      case 'common':
        return this.stats.commonWeight;
      case 'uncommon':
        return this.stats.uncommonWeight;
      case 'rare':
        return this.stats.rareWeight * boost;
      default:
        return this.stats.legendaryWeight * boost;
    }
  }

  private collect(lastForGorilla: string | undefined, useMatchWindow: boolean): FinisherDefinition[] {
    return this.catalog.filter((f) => f.id !== lastForGorilla && !(useMatchWindow && this.recent.includes(f.id)));
  }

  private pickFrom(candidates: FinisherDefinition[], rage: boolean): FinisherDefinition {
    const tiers = TIERS.filter((t) => candidates.some((f) => f.rarity === t));
    const total = tiers.reduce((sum, t) => sum + this.tierWeight(t, rage), 0);
    let tier = tiers[0];
    let roll = this.rng.next() * total;
    for (const t of tiers) {
      tier = t;
      roll -= this.tierWeight(t, rage);
      if (roll < 0) break;
    }
    const inTier = candidates.filter((f) => f.rarity === tier);
    return inTier[this.rng.int(inTier.length)];
  }
}
