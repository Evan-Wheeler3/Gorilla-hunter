import type { MatchStats } from './config';

export interface PlayerRecord {
  id: number;
  roundsStartedAsHunter: number;
}

/**
 * hunters = ceil(players / playersPerStartingHunter), at least one, always leaving at least one
 * gorilla. 2 players = 1 v 1, 4 = 1 v 3.
 */
export function startingHunterCount(players: number, stats: MatchStats): number {
  if (players < 2) return 0;
  const per = Math.max(1, stats.playersPerStartingHunter);
  return Math.min(players - 1, Math.max(1, Math.ceil(players / per)));
}

/** Players who have started as hunter least often go first; ties are broken randomly. */
export function pickStartingHunters(players: PlayerRecord[], stats: MatchStats, random: () => number): number[] {
  const count = startingHunterCount(players.length, stats);
  return players
    .map((p) => ({ id: p.id, key: p.roundsStartedAsHunter + random() * 0.5 }))
    .sort((a, b) => a.key - b.key)
    .slice(0, count)
    .map((p) => p.id);
}
