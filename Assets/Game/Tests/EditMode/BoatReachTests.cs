using NUnit.Framework;
using PrimalRaid.Core;

namespace PrimalRaid.Tests
{
    /// <summary>Owner rule: a 15 s knockout must physically leave time to drag a gorilla to a boat.</summary>
    public sealed class BoatReachTests
    {
        // Paths bend around trees and rocks; require the straight line plus this much detour.
        const float DetourFactor = 1.15f;

        [Test]
        public void EveryPointOnTheIslandCanReachABoatBeforeTheGorillaWakes()
        {
            var sedation = new SedationStats();
            var hunter = new HunterStats();
            var drag = new DragStats();

            float dragSpeed = hunter.sprintSpeed * drag.speedMultiplierByDraggers[0];
            float window = sedation.collapseSeconds / sedation.draggedDowntimeRate;

            float worst = 0f;
            for (float x = -IslandLayout.HalfSize; x <= IslandLayout.HalfSize; x += 5f)
                for (float z = -IslandLayout.HalfSize; z <= IslandLayout.HalfSize; z += 5f)
                    worst = System.Math.Max(worst, IslandLayout.DistanceToNearestBoat(x, z));

            float worstSeconds = worst * DetourFactor / dragSpeed;
            TestContext.WriteLine($"Worst-case boat distance {worst:0} m, {worstSeconds:0.0} s of {window:0.0} s");
            Assert.That(worstSeconds, Is.LessThanOrEqualTo(window));
        }

        [Test]
        public void SingleEastBoatWouldNotBeReachable()
        {
            // Documents why the island has a boat per shore.
            var sedation = new SedationStats();
            float farthest = 2f * IslandLayout.HalfSize; // west shore to east boat
            Assert.That(farthest / new HunterStats().sprintSpeed,
                        Is.GreaterThan(sedation.collapseSeconds / sedation.draggedDowntimeRate));
        }
    }
}
