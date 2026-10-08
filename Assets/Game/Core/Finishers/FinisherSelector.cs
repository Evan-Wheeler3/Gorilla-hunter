using System;
using System.Collections.Generic;

namespace PrimalRaid.Core
{
    public enum FinisherRarity
    {
        Common,
        Uncommon,
        Rare,
        Legendary,
    }

    public readonly struct FinisherDefinition
    {
        public readonly string id;
        public readonly FinisherRarity rarity;

        public FinisherDefinition(string id, FinisherRarity rarity)
        {
            this.id = id;
            this.rarity = rarity;
        }
    }

    /// <summary>The finisher picked for one kill. Clients replay the animation and debris from the seed.</summary>
    public readonly struct FinisherPick
    {
        public readonly FinisherDefinition finisher;
        public readonly int seed;

        public FinisherPick(FinisherDefinition finisher, int seed)
        {
            this.finisher = finisher;
            this.seed = seed;
        }
    }

    /// <summary>The 8 launch finishers from design doc section 6.</summary>
    public static class FinisherCatalog
    {
        public static readonly FinisherDefinition[] Launch =
        {
            new FinisherDefinition("rip_in_half", FinisherRarity.Common),
            new FinisherDefinition("head_pop", FinisherRarity.Common),
            new FinisherDefinition("arm_rip", FinisherRarity.Common),
            new FinisherDefinition("twirl_and_throw", FinisherRarity.Common),
            new FinisherDefinition("crumple_ball", FinisherRarity.Uncommon),
            new FinisherDefinition("head_clap", FinisherRarity.Uncommon),
            new FinisherDefinition("ragdoll_slam", FinisherRarity.Uncommon),
            new FinisherDefinition("drum_solo", FinisherRarity.Legendary),
        };
    }

    /// <summary>
    /// Host-side finisher picker. Every kill plays one (gorillas kill in one hit). Picks a rarity
    /// tier by weight, then a finisher uniformly within it, never repeating the same gorilla's last
    /// finisher or any of the match's last few. Deterministic for a given seed.
    /// </summary>
    public sealed class FinisherSelector
    {
        static readonly FinisherRarity[] Tiers =
            { FinisherRarity.Common, FinisherRarity.Uncommon, FinisherRarity.Rare, FinisherRarity.Legendary };

        readonly IReadOnlyList<FinisherDefinition> catalog;
        readonly FinisherStats stats;
        readonly Random rng;
        readonly Dictionary<int, string> lastByGorilla = new Dictionary<int, string>();
        readonly LinkedList<string> recentInMatch = new LinkedList<string>();
        readonly List<FinisherDefinition> candidates = new List<FinisherDefinition>();

        public FinisherSelector(IReadOnlyList<FinisherDefinition> catalog, FinisherStats stats, int seed)
        {
            if (catalog == null || catalog.Count == 0)
                throw new ArgumentException("Finisher catalog is empty.", nameof(catalog));
            this.catalog = catalog;
            this.stats = stats ?? throw new ArgumentNullException(nameof(stats));
            rng = new Random(seed);
        }

        public FinisherPick Pick(int gorillaId, bool rageMode)
        {
            lastByGorilla.TryGetValue(gorillaId, out string lastForGorilla);

            // Strict rules first; relax the match window, then everything, if the catalog is too small.
            Collect(lastForGorilla, useMatchWindow: true);
            if (candidates.Count == 0)
                Collect(lastForGorilla, useMatchWindow: false);
            if (candidates.Count == 0)
                Collect(null, useMatchWindow: false);

            var chosen = PickFromCandidates(rageMode);
            lastByGorilla[gorillaId] = chosen.id;
            recentInMatch.AddLast(chosen.id);
            while (recentInMatch.Count > Math.Max(0, stats.matchNoRepeatWindow))
                recentInMatch.RemoveFirst();

            return new FinisherPick(chosen, rng.Next());
        }

        /// <summary>Forget per-gorilla history (e.g. between rounds); the match window persists.</summary>
        public void ResetGorillaHistory() => lastByGorilla.Clear();

        public float TierWeight(FinisherRarity rarity, bool rageMode)
        {
            float rage = rageMode ? stats.rageRareAndLegendaryMultiplier : 1f;
            switch (rarity)
            {
                case FinisherRarity.Common: return stats.commonWeight;
                case FinisherRarity.Uncommon: return stats.uncommonWeight;
                case FinisherRarity.Rare: return stats.rareWeight * rage;
                default: return stats.legendaryWeight * rage;
            }
        }

        void Collect(string lastForGorilla, bool useMatchWindow)
        {
            candidates.Clear();
            foreach (var f in catalog)
            {
                if (f.id == lastForGorilla)
                    continue;
                if (useMatchWindow && recentInMatch.Contains(f.id))
                    continue;
                candidates.Add(f);
            }
        }

        FinisherDefinition PickFromCandidates(bool rageMode)
        {
            // Weighted tier among tiers that still have candidates, then uniform inside the tier.
            float total = 0f;
            foreach (var tier in Tiers)
                if (HasTier(tier))
                    total += TierWeight(tier, rageMode);

            var pickedTier = candidates[0].rarity;
            if (total > 0f)
            {
                double roll = rng.NextDouble() * total;
                foreach (var tier in Tiers)
                {
                    if (!HasTier(tier))
                        continue;
                    roll -= TierWeight(tier, rageMode);
                    pickedTier = tier;
                    if (roll < 0)
                        break;
                }
            }

            int inTier = 0;
            foreach (var f in candidates)
                if (f.rarity == pickedTier)
                    inTier++;
            int index = rng.Next(inTier);
            foreach (var f in candidates)
                if (f.rarity == pickedTier && index-- == 0)
                    return f;
            return candidates[0];
        }

        bool HasTier(FinisherRarity tier)
        {
            foreach (var f in candidates)
                if (f.rarity == tier)
                    return true;
            return false;
        }
    }
}
