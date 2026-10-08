using System;

namespace PrimalRaid.Core
{
    /// <summary>Sedation, trap, bind and drag tunables (design doc sections 3 to 5).</summary>
    [Serializable]
    public sealed class SedationStats
    {
        public float maxSedation = 100f;
        public float dartSedation = 100f;     // owner: one dart drops a gorilla
        public float decayDelaySeconds = 4f;  // partial doses (future traps, weaker darts) hold 4 s...
        public float decayPerSecond = 50f;    // ...then drain at this rate
        public float maxSlow = 0.3f;          // move speed lost at a full meter, scaled by the meter; assumption
        public float collapseSeconds = 15f;   // owner: 40/90 s too long for a 10 min round; assumption
        public float boundSeconds = 30f;      // assumption
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
        public float[] speedMultiplierByDraggers = { 1f };  // owner: dragging does not slow hunters
        public bool canSprintWhileDragging = true;          // owner
        public float wakeThrowStunSeconds = 1.5f;
    }
}
