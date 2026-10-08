using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using PrimalRaid.Core;

namespace PrimalRaid.Tests
{
    public sealed class TeamAssignmentTests
    {
        readonly MatchStats stats = new MatchStats();

        [TestCase(2, 1)]
        [TestCase(4, 1)]
        [TestCase(5, 1)]
        [TestCase(6, 2)]
        [TestCase(10, 2)]
        [TestCase(12, 3)]
        public void StartingHunterCountIsOnePerFivePlayers(int players, int hunters)
        {
            Assert.That(TeamAssignment.StartingHunterCount(players, stats), Is.EqualTo(hunters));
        }

        [Test]
        public void AlwaysLeavesAtLeastOneGorilla()
        {
            var tiny = new MatchStats { playersPerStartingHunter = 1 };
            Assert.That(TeamAssignment.StartingHunterCount(4, tiny), Is.EqualTo(3));
        }

        [Test]
        public void PlayersWhoHuntedLeastArePickedFirst()
        {
            var players = new List<PlayerRecord>();
            for (int i = 0; i < 10; i++)
                players.Add(new PlayerRecord(i, i == 3 || i == 7 ? 0 : 2));

            for (int seed = 0; seed < 50; seed++)
            {
                var picked = TeamAssignment.PickStartingHunters(players, stats, new Random(seed));
                Assert.That(picked, Is.EquivalentTo(new[] { 3, 7 }));
            }
        }

        [Test]
        public void TiesAreBrokenRandomly()
        {
            var players = Enumerable.Range(0, 10).Select(i => new PlayerRecord(i, 0)).ToList();
            var seen = new HashSet<int>();
            for (int seed = 0; seed < 200; seed++)
                seen.UnionWith(TeamAssignment.PickStartingHunters(players, stats, new Random(seed)));
            Assert.That(seen.Count, Is.EqualTo(10));
        }
    }
}
