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

        [Test]
        public void OneDartDoesNotDropAGorilla()
        {
            Dart();
            Assert.That(meter.State, Is.EqualTo(SedationState.Awake));
            Assert.That(meter.Value, Is.EqualTo(stats.dartSedation));
        }

        [Test]
        public void OneDartHoldsThenWearsOffInAboutFiveSeconds()
        {
            Dart();
            meter.Tick(stats.decayDelaySeconds);
            Assert.That(meter.Value, Is.EqualTo(stats.dartSedation));
            meter.Tick(0.5f);
            Assert.That(meter.Value, Is.GreaterThan(0f).And.LessThan(stats.dartSedation));
            meter.Tick(0.6f);
            Assert.That(meter.Value, Is.EqualTo(0f));
        }

        [Test]
        public void HoldAndDecaySplitCorrectlyInsideOneTick()
        {
            Dart();
            meter.Tick(stats.decayDelaySeconds + 0.2f);
            Assert.That(meter.Value, Is.EqualTo(stats.dartSedation - stats.decayPerSecond * 0.2f).Within(1e-3));
        }

        [Test]
        public void TwoDartsBackToBackDropAGorilla()
        {
            Dart();
            Assert.That(meter.Add(stats.dartSedation), Is.True);
            Assert.That(meter.State, Is.EqualTo(SedationState.Collapsed));
            Assert.That(meter.RemainingDowntime, Is.EqualTo(stats.collapseSeconds));
        }

        [Test]
        public void OneHunterCanDropAGorillaAcrossAReload()
        {
            // Dart, 3.5 s auto-reload, dart: the first dart is still held at full strength.
            Dart();
            meter.Tick(new HunterStats().rifleReloadSeconds);
            Assert.That(meter.Add(stats.dartSedation), Is.True);
        }

        [Test]
        public void DartsMoreThanFiveSecondsApartDoNotDrop()
        {
            Dart();
            meter.Tick(5.1f);
            Assert.That(meter.Add(stats.dartSedation), Is.False);
            Assert.That(meter.Value, Is.EqualTo(stats.dartSedation));
        }

        [Test]
        public void SedationSlowsTheGorillaInProportion()
        {
            Assert.That(meter.SpeedMultiplier, Is.EqualTo(1f));
            Dart();
            Assert.That(meter.SpeedMultiplier, Is.EqualTo(1f - stats.maxSlow * 0.5f).Within(1e-4));
        }

        [Test]
        public void DartsAreIgnoredWhileDown()
        {
            meter.Add(stats.maxSedation);
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
    }
}
