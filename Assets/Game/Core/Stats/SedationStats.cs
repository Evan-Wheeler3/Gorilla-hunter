using System;

namespace PrimalRaid.Core
{
    /// <summary>Sedation, trap, bind and drag tunables (design doc sections 3 to 5).</summary>
    [Serializable]
    public sealed class SedationStats
    {
        public float maxSedation = 100f;
        public float dartSedation = 40f;
        public float decayPerSecond = 8f;
        public float collapseSeconds = 40f;
        public float boundSeconds = 90f;
        public float bindSeconds = 3f;
        public float cutBindingSeconds = 3f;
    }

    [Serializable]
    public sealed class TrapStats
    {
        public float setSeconds = 2f;
        public float holdSeconds = 6f;
        public float holdExtensionPerDartHit = 2f;
    }

    [Serializable]
    public sealed class DragStats
    {
        /// <summary>Speed multiplier indexed by dragger count minus one; the last entry covers larger groups.</summary>
        public float[] speedMultiplierByDraggers = { 0.4f, 0.75f, 1f };
        public float wakeThrowStunSeconds = 1.5f;
    }
}
