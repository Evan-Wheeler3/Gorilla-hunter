using System;
using System.Collections.Generic;
using System.Linq;

namespace PrimalRaid.Core
{
    /// <summary>A player's history for fair role rotation.</summary>
    public readonly struct PlayerRecord
    {
        public readonly int id;
        public readonly int roundsStartedAsHunter;

        public PlayerRecord(int id, int roundsStartedAsHunter)
        {
            this.id = id;
            this.roundsStartedAsHunter = roundsStartedAsHunter;
        }
    }

    /// <summary>Picks the starting hunters for an infection round.</summary>
    public static class TeamAssignment
    {
        /// <summary>
        /// hunters = ceil(players / playersPerStartingHunter), at least one, and always leaving at
        /// least one gorilla. 4 players = 1 v 3, 10 = 2 v 8, 12 = 3 v 9.
        /// </summary>
        public static int StartingHunterCount(int players, MatchStats stats)
        {
            if (players < 2)
                return 0;
            int perHunter = Math.Max(1, stats.playersPerStartingHunter);
            int hunters = (players + perHunter - 1) / perHunter;
            return Math.Min(players - 1, Math.Max(1, hunters));
        }

        /// <summary>
        /// Players who have started as hunter least often go first. Ties (and only ties: the
        /// jitter is below one round) are broken randomly so the same person isn't always picked.
        /// </summary>
        public static List<int> PickStartingHunters(IReadOnlyList<PlayerRecord> players, MatchStats stats, Random rng)
        {
            int count = StartingHunterCount(players.Count, stats);
            return players
                .Select(p => (p.id, key: p.roundsStartedAsHunter + rng.NextDouble() * 0.5))
                .OrderBy(p => p.key)
                .Take(count)
                .Select(p => p.id)
                .ToList();
        }
    }
}
