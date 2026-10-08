using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using PrimalRaid.Core;

namespace PrimalRaid.Tests
{
    public sealed class FinisherSelectorTests
    {
        static FinisherSelector Make(int seed = 7) =>
            new FinisherSelector(FinisherCatalog.Launch, new FinisherStats(), seed);

        [Test]
        public void SameGorillaNeverGetsTheSameFinisherTwiceInARow()
        {
            var selector = Make();
            string last = null;
            for (int i = 0; i < 2000; i++)
            {
                string id = selector.Pick(1, rageMode: false).finisher.id;
                Assert.That(id, Is.Not.EqualTo(last));
                last = id;
            }
        }

        [Test]
        public void NoRepeatWithinTheLastThreeKillsOfTheMatch()
        {
            var selector = Make();
            var history = new List<string>();
            for (int i = 0; i < 2000; i++)
            {
                string id = selector.Pick(i % 8, rageMode: false).finisher.id; // 8 gorillas taking turns
                Assert.That(history.Skip(System.Math.Max(0, history.Count - 3)), Does.Not.Contain(id));
                history.Add(id);
            }
        }

        [Test]
        public void EveryLaunchFinisherShowsUp()
        {
            var selector = Make();
            var seen = new HashSet<string>();
            for (int i = 0; i < 500; i++)
                seen.Add(selector.Pick(i % 8, false).finisher.id);
            Assert.That(seen.Count, Is.EqualTo(FinisherCatalog.Launch.Length));
        }

        [Test]
        public void RageMakesTheLegendaryMoreCommon()
        {
            int Count(bool rage)
            {
                var selector = Make(123);
                int legendary = 0;
                for (int i = 0; i < 20000; i++)
                    if (selector.Pick(i % 8, rage).finisher.rarity == FinisherRarity.Legendary)
                        legendary++;
                return legendary;
            }

            int normal = Count(false);
            int rage = Count(true);
            TestContext.WriteLine($"Legendary: {normal} normal vs {rage} rage per 20000 kills");
            Assert.That(rage, Is.GreaterThan(normal * 1.5));
        }

        [Test]
        public void SameSeedGivesTheSameSequence()
        {
            var a = Make(42);
            var b = Make(42);
            for (int i = 0; i < 100; i++)
            {
                var pa = a.Pick(i % 3, i % 5 == 0);
                var pb = b.Pick(i % 3, i % 5 == 0);
                Assert.That(pa.finisher.id, Is.EqualTo(pb.finisher.id));
                Assert.That(pa.seed, Is.EqualTo(pb.seed));
            }
        }

        [Test]
        public void TinyCatalogStillPicksSomething()
        {
            var one = new[] { new FinisherDefinition("only", FinisherRarity.Common) };
            var selector = new FinisherSelector(one, new FinisherStats(), 1);
            Assert.That(selector.Pick(1, false).finisher.id, Is.EqualTo("only"));
            Assert.That(selector.Pick(1, false).finisher.id, Is.EqualTo("only"));
        }
    }
}
