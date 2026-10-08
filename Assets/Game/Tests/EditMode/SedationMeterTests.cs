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

        [Test]
        public void DartAddsConfiguredSedation()
        {
            meter.Add(stats.dartSedation);
            Assert.That(meter.Value, Is.EqualTo(40f));
            Assert.That(meter.State, Is.EqualTo(SedationState.Awake));
        }

        [Test]
        public void MeterDecaysWhileAwakeAndStopsAtZero()
        {
            meter.Add(40f);
            meter.Tick(2f);
            Assert.That(meter.Value, Is.EqualTo(24f).Within(1e-4));
            meter.Tick(10f);
            Assert.That(meter.Value, Is.EqualTo(0f));
        }

        [Test]
        public void ReachingMaxCollapsesForCollapseDuration()
        {
            Assert.That(meter.Add(60f), Is.False);
            Assert.That(meter.Add(40f), Is.True);
            Assert.That(meter.State, Is.EqualTo(SedationState.Collapsed));
            Assert.That(meter.RemainingDowntime, Is.EqualTo(40f));
        }

        [Test]
        public void ThreeDartsOneSecondApartCollapse()
        {
            meter.Add(40f);
            meter.Tick(1f);
            meter.Add(40f);
            meter.Tick(1f);
            Assert.That(meter.Add(40f), Is.True);
        }

        [Test]
        public void ThreeDartsSpreadOverFiveSecondsDoNotCollapse()
        {
            // With 40 per dart and 8/s decay, three darts must land within 2.5 s in total.
            // The design doc's "within about 5 seconds" is too loose; flagged to the owner.
            meter.Add(40f);
            meter.Tick(2.5f);
            meter.Add(40f);
            meter.Tick(2.5f);
            Assert.That(meter.Add(40f), Is.False);
            Assert.That(meter.Value, Is.EqualTo(80f).Within(1e-4));
        }

        [Test]
        public void DartsAreIgnoredWhileDown()
        {
            meter.Add(100f);
            Assert.That(meter.Add(40f), Is.False);
            Assert.That(meter.RemainingDowntime, Is.EqualTo(40f));
        }

        [Test]
        public void MeterDoesNotDecayWhileDown()
        {
            meter.Add(100f);
            meter.Tick(10f);
            Assert.That(meter.Value, Is.EqualTo(100f));
            Assert.That(meter.RemainingDowntime, Is.EqualTo(30f).Within(1e-4));
        }

        [Test]
        public void WakesAfterDowntimeWithEmptyMeter()
        {
            meter.Add(100f);
            Assert.That(meter.Tick(39f), Is.EqualTo(SedationEvent.None));
            Assert.That(meter.Tick(1.5f), Is.EqualTo(SedationEvent.Woke));
            Assert.That(meter.State, Is.EqualTo(SedationState.Awake));
            Assert.That(meter.Value, Is.EqualTo(0f));
        }

        [Test]
        public void BindingExtendsDowntimeToBoundDuration()
        {
            meter.Add(100f);
            meter.Tick(10f);
            Assert.That(meter.Bind(), Is.True);
            Assert.That(meter.State, Is.EqualTo(SedationState.Bound));
            Assert.That(meter.RemainingDowntime, Is.EqualTo(90f));
        }

        [Test]
        public void CannotBindAnAwakeOrAlreadyBoundGorilla()
        {
            Assert.That(meter.Bind(), Is.False);
            meter.Add(100f);
            meter.Bind();
            Assert.That(meter.Bind(), Is.False);
        }

        [Test]
        public void CuttingBindingFreesImmediately()
        {
            meter.Add(100f);
            meter.Bind();
            Assert.That(meter.CutBinding(), Is.True);
            Assert.That(meter.State, Is.EqualTo(SedationState.Awake));
            Assert.That(meter.Value, Is.EqualTo(0f));
        }

        [Test]
        public void CannotCutBindingOfUnboundGorilla()
        {
            meter.Add(100f);
            Assert.That(meter.CutBinding(), Is.False);
            Assert.That(meter.State, Is.EqualTo(SedationState.Collapsed));
        }
    }
}
