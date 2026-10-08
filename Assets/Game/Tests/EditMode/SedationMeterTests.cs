using NUnit.Framework;
using PrimalRaid.Core;

namespace PrimalRaid.Tests
{
    public sealed class SedationMeterTests
    {
        SedationStats stats;
        SedationMeter meter;

        [SetUp]
        public void SetUp()
        {
            stats = new SedationStats();
            meter = new SedationMeter(stats);
        }

        void Dart() => meter.Add(stats.dartSedation);
        float Half => stats.maxSedation * 0.5f;

        [Test]
        public void OneDartDropsAGorilla()
        {
            Assert.That(meter.Add(stats.dartSedation), Is.True);
            Assert.That(meter.State, Is.EqualTo(SedationState.Collapsed));
            Assert.That(meter.RemainingDowntime, Is.EqualTo(stats.collapseSeconds));
        }

        [Test]
        public void PartialDoseHoldsThenWearsOff()
        {
            meter.Add(Half);
            meter.Tick(stats.decayDelaySeconds);
            Assert.That(meter.Value, Is.EqualTo(Half));
            meter.Tick(0.2f);
            Assert.That(meter.Value, Is.EqualTo(Half - stats.decayPerSecond * 0.2f).Within(1e-3));
            meter.Tick(10f);
            Assert.That(meter.Value, Is.EqualTo(0f));
        }

        [Test]
        public void HoldAndDecaySplitCorrectlyInsideOneTick()
        {
            meter.Add(Half);
            meter.Tick(stats.decayDelaySeconds + 0.2f);
            Assert.That(meter.Value, Is.EqualTo(Half - stats.decayPerSecond * 0.2f).Within(1e-3));
        }

        [Test]
        public void TwoPartialDosesInsideTheHoldDrop()
        {
            meter.Add(Half);
            meter.Tick(stats.decayDelaySeconds * 0.9f);
            Assert.That(meter.Add(Half), Is.True);
        }

        [Test]
        public void SedationSlowsTheGorillaInProportion()
        {
            Assert.That(meter.SpeedMultiplier, Is.EqualTo(1f));
            meter.Add(Half);
            Assert.That(meter.SpeedMultiplier, Is.EqualTo(1f - stats.maxSlow * 0.5f).Within(1e-4));
        }

        [Test]
        public void DartsAreIgnoredWhileDown()
        {
            Dart();
            Assert.That(meter.Add(stats.dartSedation), Is.False);
            Assert.That(meter.RemainingDowntime, Is.EqualTo(stats.collapseSeconds));
        }

        [Test]
        public void MeterDoesNotDecayWhileDown()
        {
            meter.Add(stats.maxSedation);
            meter.Tick(5f);
            Assert.That(meter.Value, Is.EqualTo(stats.maxSedation));
            Assert.That(meter.RemainingDowntime, Is.EqualTo(stats.collapseSeconds - 5f).Within(1e-4));
        }

        [Test]
        public void WakesAfterDowntimeWithEmptyMeter()
        {
            meter.Add(stats.maxSedation);
            Assert.That(meter.Tick(stats.collapseSeconds - 1f), Is.EqualTo(SedationEvent.None));
            Assert.That(meter.Tick(1.5f), Is.EqualTo(SedationEvent.Woke));
            Assert.That(meter.State, Is.EqualTo(SedationState.Awake));
            Assert.That(meter.Value, Is.EqualTo(0f));
        }

        [Test]
        public void BindingSetsDowntimeToBoundDuration()
        {
            meter.Add(stats.maxSedation);
            meter.Tick(5f);
            Assert.That(meter.Bind(), Is.True);
            Assert.That(meter.State, Is.EqualTo(SedationState.Bound));
            Assert.That(meter.RemainingDowntime, Is.EqualTo(stats.boundSeconds));
        }

        [Test]
        public void CannotBindAnAwakeOrAlreadyBoundGorilla()
        {
            Assert.That(meter.Bind(), Is.False);
            meter.Add(stats.maxSedation);
            meter.Bind();
            Assert.That(meter.Bind(), Is.False);
        }

        [Test]
        public void CuttingBindingFreesImmediately()
        {
            meter.Add(stats.maxSedation);
            meter.Bind();
            Assert.That(meter.CutBinding(), Is.True);
            Assert.That(meter.State, Is.EqualTo(SedationState.Awake));
            Assert.That(meter.Value, Is.EqualTo(0f));
        }

        [Test]
        public void CannotCutBindingOfUnboundGorilla()
        {
            meter.Add(stats.maxSedation);
            Assert.That(meter.CutBinding(), Is.False);
            Assert.That(meter.State, Is.EqualTo(SedationState.Collapsed));
        }

        [Test]
        public void SlapKnocksTimeOffAKnockout()
        {
            Dart();
            Assert.That(meter.Slap(), Is.EqualTo(SedationEvent.None));
            Assert.That(meter.RemainingDowntime, Is.EqualTo(stats.collapseSeconds - stats.slapWakeSeconds));
        }

        [Test]
        public void RepeatedSlapsWakeAGorilla()
        {
            Dart();
            int slaps = 0;
            while (meter.IsDown && slaps < 100)
            {
                meter.Slap();
                slaps++;
            }
            Assert.That(meter.State, Is.EqualTo(SedationState.Awake));
            Assert.That(slaps, Is.EqualTo((int)System.Math.Ceiling(stats.collapseSeconds / stats.slapWakeSeconds)));
        }

        [Test]
        public void SlapsAlsoWorkOnBoundGorillas()
        {
            Dart();
            meter.Bind();
            meter.Slap();
            Assert.That(meter.RemainingDowntime, Is.EqualTo(stats.boundSeconds - stats.slapWakeSeconds));
        }

        [Test]
        public void SlappingAnAwakeGorillaDoesNothing()
        {
            Assert.That(meter.Slap(), Is.EqualTo(SedationEvent.None));
            Assert.That(meter.State, Is.EqualTo(SedationState.Awake));
        }

        [Test]
        public void KnockoutClockRunsSlowerWhileDragged()
        {
            Dart();
            meter.Tick(10f, stats.draggedDowntimeRate);
            Assert.That(meter.RemainingDowntime, Is.EqualTo(stats.collapseSeconds - 10f * stats.draggedDowntimeRate).Within(1e-4));
        }
    }
}
