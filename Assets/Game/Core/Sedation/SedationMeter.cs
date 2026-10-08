using System;

namespace PrimalRaid.Core
{
    public enum SedationState
    {
        Awake,
        Collapsed,
        Bound,
    }

    public enum SedationEvent
    {
        None,
        Collapsed,
        Woke,
    }

    /// <summary>
    /// Pure sedation math for one gorilla. The meter fills from darts and traps, decays while
    /// awake, and at max collapses the gorilla for a fixed downtime. Engine-free so it can be
    /// unit tested and run on the host.
    /// </summary>
    public sealed class SedationMeter
    {
        readonly SedationStats stats;

        public SedationMeter(SedationStats stats)
        {
            this.stats = stats ?? throw new ArgumentNullException(nameof(stats));
        }

        public float Value { get; private set; }
        public SedationState State { get; private set; }

        /// <summary>Seconds until the gorilla wakes; zero while awake.</summary>
        public float RemainingDowntime { get; private set; }

        public bool IsDown => State != SedationState.Awake;
        public float Normalized => stats.maxSedation <= 0f ? 0f : Value / stats.maxSedation;

        /// <summary>Adds sedation. Returns true if this dose caused a collapse. Ignored while down.</summary>
        public bool Add(float amount)
        {
            if (IsDown || amount <= 0f)
                return false;

            Value = Math.Min(stats.maxSedation, Value + amount);
            if (Value < stats.maxSedation)
                return false;

            State = SedationState.Collapsed;
            RemainingDowntime = stats.collapseSeconds;
            return true;
        }

        public SedationEvent Tick(float deltaTime)
        {
            if (deltaTime <= 0f)
                return SedationEvent.None;

            if (!IsDown)
            {
                Value = Math.Max(0f, Value - stats.decayPerSecond * deltaTime);
                return SedationEvent.None;
            }

            RemainingDowntime -= deltaTime;
            if (RemainingDowntime > 0f)
                return SedationEvent.None;

            Wake();
            return SedationEvent.Woke;
        }

        /// <summary>
        /// Binds a collapsed gorilla. Assumption: binding resets the remaining downtime to the
        /// bound duration (90 s) rather than adding it to the time already spent down.
        /// </summary>
        public bool Bind()
        {
            if (State != SedationState.Collapsed)
                return false;

            State = SedationState.Bound;
            RemainingDowntime = stats.boundSeconds;
            return true;
        }

        /// <summary>A teammate cutting the binding frees the gorilla immediately.</summary>
        public bool CutBinding()
        {
            if (State != SedationState.Bound)
                return false;

            Wake();
            return true;
        }

        /// <summary>Debug hook: sets the meter directly while awake (clamped below collapse).</summary>
        public void DebugSetValue(float value)
        {
            if (IsDown)
                return;
            Value = Math.Max(0f, Math.Min(stats.maxSedation, value));
            if (Value >= stats.maxSedation)
            {
                State = SedationState.Collapsed;
                RemainingDowntime = stats.collapseSeconds;
            }
        }

        public void Wake()
        {
            State = SedationState.Awake;
            Value = 0f;
            RemainingDowntime = 0f;
        }
    }
}
