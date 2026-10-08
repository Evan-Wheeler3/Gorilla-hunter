using System;
using PrimalRaid.Config;
using PrimalRaid.Core;
using UnityEngine;

namespace PrimalRaid.Combat
{
    /// <summary>Puts a <see cref="SedationMeter"/> on a gorilla and ticks it.</summary>
    public sealed class SedationTarget : MonoBehaviour
    {
        public SedationMeter Meter { get; private set; }

        /// <summary>Time of the last dart hit, for the hunter's "you hit this gorilla" ring.</summary>
        public float LastHitTime { get; private set; } = float.NegativeInfinity;

        public event Action<SedationTarget> Collapsed;
        public event Action<SedationTarget> Woke;

        void Awake() => Meter = new SedationMeter(GameConfig.Active.sedation);

        void Update()
        {
            if (Meter.Tick(Time.deltaTime) == SedationEvent.Woke)
                Woke?.Invoke(this);
        }

        public void ApplyDart() => AddSedation(GameConfig.Active.sedation.dartSedation);

        public void AddSedation(float amount)
        {
            LastHitTime = Time.time;
            if (Meter.Add(amount))
                Collapsed?.Invoke(this);
        }

        public void DebugSet(float value)
        {
            bool wasDown = Meter.IsDown;
            Meter.DebugSetValue(value);
            if (!wasDown && Meter.IsDown)
                Collapsed?.Invoke(this);
        }

        public void DebugWake()
        {
            if (!Meter.IsDown)
                return;
            Meter.Wake();
            Woke?.Invoke(this);
        }
    }
}
