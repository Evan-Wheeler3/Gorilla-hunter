using System.Collections.Generic;
using NUnit.Framework;
using PrimalRaid.Core;

namespace PrimalRaid.Tests
{
    public sealed class InfectionRoundTests
    {
        MatchStats stats;
        InfectionRound round;
        readonly List<string> log = new List<string>();

        // Hunters 1, 2; gorillas 10 to 17 (the 2 v 8 the owner described).
        [SetUp]
        public void SetUp()
        {
            stats = new MatchStats();
            log.Clear();
            round = new InfectionRound(stats, new[] { 1, 2 }, new[] { 10, 11, 12, 13, 14, 15, 16, 17 });
            round.HunterRespawned += id => log.Add($"respawn {id}");
            round.GorillaConverted += id => log.Add($"convert {id}");
            round.LastGorillaStanding += id => log.Add($"last {id}");
            round.Ended += (r, why) => log.Add($"end {r} {why}");
            round.Start();
        }

        void SkipBriefing() => round.Tick(stats.briefingSeconds);

        [Test]
        public void PhasesRunBriefingHeadStartHuntWildfire()
        {
            Assert.That(round.Phase, Is.EqualTo(RoundPhase.Briefing));
            Assert.That(round.GorillasHeld, Is.True);
            SkipBriefing();
            Assert.That(round.Phase, Is.EqualTo(RoundPhase.HunterHeadStart));
            round.Tick(stats.hunterHeadStartSeconds);
            Assert.That(round.Phase, Is.EqualTo(RoundPhase.Hunt));
            Assert.That(round.GorillasHeld, Is.False);
            round.Tick(stats.fireStartSeconds - stats.hunterHeadStartSeconds);
            Assert.That(round.Phase, Is.EqualTo(RoundPhase.Wildfire));
        }

        [Test]
        public void BriefingOvershootCountsTowardTheRoundClock()
        {
            round.Tick(stats.briefingSeconds + 3f);
            Assert.That(round.RoundTime, Is.EqualTo(3f).Within(1e-4));
        }

        [Test]
        public void GorillasWinWhenTheTimerRunsOut()
        {
            SkipBriefing();
            for (int i = 0; i < 700; i++)
                round.Tick(1f);
            Assert.That(round.Result, Is.EqualTo(RoundResult.GorillasWin));
            Assert.That(round.EndReason, Is.EqualTo(RoundEndReason.TimerExpired));
            Assert.That(round.RoundTime, Is.EqualTo(stats.roundSeconds).Within(1f));
        }

        [Test]
        public void SecuredGorillaBecomesAHunter()
        {
            SkipBriefing();
            Assert.That(round.ReportGorillaSecured(10), Is.True);
            Assert.That(round.Gorillas, Does.Not.Contain(10));
            Assert.That(round.AliveHunters, Does.Contain(10));
            Assert.That(log, Does.Contain("convert 10"));
        }

        [Test]
        public void HuntersWinWhenEveryGorillaIsConverted()
        {
            SkipBriefing();
            for (int id = 10; id <= 17; id++)
                round.ReportGorillaSecured(id);
            Assert.That(round.Result, Is.EqualTo(RoundResult.HuntersWin));
            Assert.That(round.EndReason, Is.EqualTo(RoundEndReason.AllGorillasConverted));
            Assert.That(round.AliveHunters.Count, Is.EqualTo(10));
        }

        [Test]
        public void LastGorillaIsAnnouncedOnce()
        {
            SkipBriefing();
            for (int id = 10; id <= 16; id++)
                round.ReportGorillaSecured(id);
            Assert.That(round.LastGorilla, Is.EqualTo(17));
            Assert.That(log.FindAll(l => l.StartsWith("last")), Is.EqualTo(new[] { "last 17" }));
        }

        [Test]
        public void KilledHunterSpendsALifeAndRespawns()
        {
            SkipBriefing();
            Assert.That(round.ReportHunterKilled(1), Is.True);
            Assert.That(round.LivesRemaining, Is.EqualTo(stats.sharedHunterLives - 1));
            Assert.That(round.IsRespawning(1), Is.True);
            Assert.That(round.AliveHunters, Does.Not.Contain(1));

            round.Tick(stats.hunterRespawnSeconds + 0.01f);
            Assert.That(round.AliveHunters, Does.Contain(1));
            Assert.That(log, Does.Contain("respawn 1"));
        }

        [Test]
        public void BothHuntersDeadButRespawningIsNotALoss()
        {
            SkipBriefing();
            round.ReportHunterKilled(1);
            round.ReportHunterKilled(2);
            Assert.That(round.Phase, Is.Not.EqualTo(RoundPhase.Ended));
        }

        [Test]
        public void GorillasWinWhenLivesRunOutAndEveryHunterIsDead()
        {
            stats.sharedHunterLives = 1;
            round = new InfectionRound(stats, new[] { 1, 2 }, new[] { 10, 11 });
            round.Start();
            SkipBriefing();

            round.ReportHunterKilled(1);   // spends the last life
            round.ReportHunterKilled(2);   // no life left: out for good
            Assert.That(round.Phase, Is.Not.EqualTo(RoundPhase.Ended), "hunter 1 is still respawning");

            round.Tick(stats.hunterRespawnSeconds + 0.01f);
            round.ReportHunterKilled(1);
            Assert.That(round.Result, Is.EqualTo(RoundResult.GorillasWin));
            Assert.That(round.EndReason, Is.EqualTo(RoundEndReason.HuntersEliminated));
        }

        [Test]
        public void ConvertedGorillasSpendTheSharedPoolToo()
        {
            SkipBriefing();
            round.ReportGorillaSecured(10);
            round.ReportHunterKilled(10);
            Assert.That(round.LivesRemaining, Is.EqualTo(stats.sharedHunterLives - 1));
        }

        [Test]
        public void NothingCountsDuringBriefingOrAfterTheEnd()
        {
            Assert.That(round.ReportHunterKilled(1), Is.False);
            Assert.That(round.ReportGorillaSecured(10), Is.False);

            SkipBriefing();
            for (int id = 10; id <= 17; id++)
                round.ReportGorillaSecured(id);
            Assert.That(round.ReportHunterKilled(1), Is.False);
        }

        [Test]
        public void DeadOrUnknownPlayersCannotBeKilledOrSecuredTwice()
        {
            SkipBriefing();
            Assert.That(round.ReportHunterKilled(1), Is.True);
            Assert.That(round.ReportHunterKilled(1), Is.False);
            Assert.That(round.ReportHunterKilled(99), Is.False);
            Assert.That(round.ReportGorillaSecured(10), Is.True);
            Assert.That(round.ReportGorillaSecured(10), Is.False);
        }

        [Test]
        public void LastGorillaLeavingGivesHuntersTheWin()
        {
            round = new InfectionRound(stats, new[] { 1 }, new[] { 10 });
            round.Start();
            round.RemovePlayer(10);
            Assert.That(round.Result, Is.EqualTo(RoundResult.HuntersWin));
        }

        [Test]
        public void OneGorillaRoundsStartWithItsRage()
        {
            var events = new List<int>();
            round = new InfectionRound(stats, new[] { 1 }, new[] { 10, 11, 12 });
            Assert.That(round.LastGorilla, Is.Null);

            round = new InfectionRound(stats, new[] { 1, 2, 3 }, new[] { 10 });
            round.LastGorillaStanding += events.Add;
            round.Start();
            Assert.That(events, Is.EqualTo(new[] { 10 }));
        }
    }
}
