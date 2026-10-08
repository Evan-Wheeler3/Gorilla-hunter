using System;

namespace PrimalRaid.Core
{
    /// <summary>Finisher selection tunables (design doc section 6).</summary>
    [Serializable]
    public sealed class FinisherStats
    {
        // Chance of each rarity tier; tiers with no finishers are skipped and the rest renormalised.
        public float commonWeight = 50f;
        public float uncommonWeight = 30f;
        public float rareWeight = 15f;
        public float legendaryWeight = 5f;

        public float rageRareAndLegendaryMultiplier = 2f;

        /// <summary>A finisher never repeats within this many kills of the whole match.</summary>
        public int matchNoRepeatWindow = 3;
    }
}
