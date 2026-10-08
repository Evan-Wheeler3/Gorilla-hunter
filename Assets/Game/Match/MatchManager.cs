using System;
using System.Collections.Generic;
using PrimalRaid.Combat;
using PrimalRaid.Config;
using PrimalRaid.Core;
using PrimalRaid.Players;
using PrimalRaid.World;
using UnityEngine;

namespace PrimalRaid.Match
{
    /// <summary>
    /// Runs infection rounds in the scene: spawns characters, feeds kills and boat deliveries into
    /// <see cref="InfectionRound"/>, and applies its outcomes (respawns, gorilla-to-hunter
    /// conversion, last-gorilla rage, finisher picks). Offline only for now; in the netcode
    /// milestone this runs on the host.
    /// </summary>
    public sealed class MatchManager : MonoBehaviour
    {
        const int FirstHunterId = 1;
        const int FirstGorillaId = 100;
        const float BoatZoneRadius = 6f;
        const float AnnouncementSeconds = 4f;

        [Serializable]
        public sealed class Setup
        {
            public int gorillas = 3;
            public int hunters = 1;
            /// <summary>Skip the briefing and head start so testing starts immediately.</summary>
            public bool quickStart = true;
            /// <summary>Spawn everyone next to each other instead of nest and camp.</summary>
            public bool spawnNearTestArea = true;
            /// <summary>Which side the local player starts on.</summary>
            public bool startAsHunter = true;
        }

        readonly Dictionary<int, GorillaController> gorillas = new Dictionary<int, GorillaController>();
        readonly Dictionary<int, HunterController> hunters = new Dictionary<int, HunterController>();
        readonly List<int> deliveries = new List<int>();

        GreyboxIslandBuilder.Result island;
        Setup setup;
        FinisherSelector finisherSelector;
        int roundNumber;

        public InfectionRound Round { get; private set; }
        public IControllable Controlled { get; private set; }
        public IEnumerable<GorillaController> Gorillas => gorillas.Values;
        public IEnumerable<HunterController> Hunters => hunters.Values;
        public GreyboxIslandBuilder.Result Island => island;
        public Setup CurrentSetup => setup;

        public string Announcement { get; private set; }
        public bool HasAnnouncement => Time.time < announcementExpiry;
        float announcementExpiry = float.NegativeInfinity;

        /// <summary>Raised for every finisher pick, so the finisher system can play it later.</summary>
        public event Action<GorillaController, HunterController, FinisherPick> FinisherTriggered;

        public void Init(GreyboxIslandBuilder.Result islandResult, Setup matchSetup)
        {
            island = islandResult;
            setup = matchSetup;
            finisherSelector = new FinisherSelector(FinisherCatalog.Launch, GameConfig.Active.finishers,
                                                    Environment.TickCount);
        }

        public void BeginRound()
        {
            ClearCharacters();
            roundNumber++;
            finisherSelector.ResetGorillaHistory();

            var hunterIds = new List<int>();
            var gorillaIds = new List<int>();
            for (int i = 0; i < Mathf.Max(1, setup.hunters); i++)
            {
                int id = FirstHunterId + i;
                SpawnHunter(id, HunterSpawn(i));
                hunterIds.Add(id);
            }
            for (int i = 0; i < Mathf.Max(1, setup.gorillas); i++)
            {
                int id = FirstGorillaId + i;
                var gorilla = GreyboxCharacterFactory.SpawnGorilla(GorillaSpawn(i), 0f);
                gorilla.name = $"Gorilla {i + 1}";
                gorilla.KilledHunter += OnGorillaKilledHunter;
                gorillas[id] = gorilla;
                gorillaIds.Add(id);
            }

            Round = new InfectionRound(GameConfig.Active.match, hunterIds, gorillaIds);
            Round.HunterRespawned += OnHunterRespawned;
            Round.GorillaConverted += OnGorillaConverted;
            Round.LastGorillaStanding += OnLastGorillaStanding;
            Round.Ended += OnRoundEnded;
            Round.PhaseChanged += OnPhaseChanged;
            Round.Start();

            if (setup.quickStart)
            {
                var stats = GameConfig.Active.match;
                Round.Tick(stats.briefingSeconds + stats.hunterHeadStartSeconds);
            }

            Possess(setup.startAsHunter ? (IControllable)hunters[FirstHunterId] : gorillas[FirstGorillaId]);
            Announce($"Round {roundNumber}: {hunterIds.Count} hunter(s) vs {gorillaIds.Count} gorillas");
        }

        void Update()
        {
            if (Round == null)
                return;

            Round.Tick(Time.deltaTime);
            ApplyHolds();
            CheckBoatDeliveries();
        }

        // ---------------------------------------------------------------- Possession

        public void Possess(IControllable target)
        {
            foreach (var g in gorillas.Values)
                g.SetControl(ReferenceEquals(g, target));
            foreach (var h in hunters.Values)
                h.SetControl(ReferenceEquals(h, target));
            Controlled = target;
        }

        public void PossessNextGorilla() => Possess(NextAfter(gorillas.Values, Controlled));
        public void PossessNextHunter() => Possess(NextAfter(hunters.Values, Controlled));

        static IControllable NextAfter<T>(IEnumerable<T> items, IControllable current) where T : class, IControllable
        {
            var list = new List<T>(items);
            if (list.Count == 0)
                return current;
            int index = list.IndexOf(current as T);
            return list[(index + 1) % list.Count];
        }

        public int IdOf(HunterController hunter)
        {
            foreach (var pair in hunters)
                if (pair.Value == hunter)
                    return pair.Key;
            return -1;
        }

        public int IdOf(GorillaController gorilla)
        {
            foreach (var pair in gorillas)
                if (pair.Value == gorilla)
                    return pair.Key;
            return -1;
        }

        // ---------------------------------------------------------------- Round events

        void OnPhaseChanged(RoundPhase phase)
        {
            if (phase == RoundPhase.Hunt)
                Announce("Gorillas released!");
            else if (phase == RoundPhase.Wildfire)
                Announce("Wildfire! (fire system not built yet)");
        }

        void OnHunterDied(int id)
        {
            Round.ReportHunterKilled(id);
        }

        void OnHunterRespawned(int id)
        {
            if (!hunters.TryGetValue(id, out var hunter))
                return;
            hunter.Revive();
            hunter.Teleport(HunterSpawn(id % 4));
        }

        void OnGorillaKilledHunter(GorillaController gorilla, Health victim)
        {
            var hunter = victim.GetComponent<HunterController>();
            var pick = finisherSelector.Pick(IdOf(gorilla), gorilla.RageActive);
            Announce($"{gorilla.name}: {Pretty(pick.finisher.id)} ({pick.finisher.rarity})");
            FinisherTriggered?.Invoke(gorilla, hunter, pick);
        }

        void OnGorillaConverted(int id)
        {
            if (!gorillas.TryGetValue(id, out var gorilla))
                return;

            bool wasControlled = gorilla.HasControl;
            Vector3 position = gorilla.transform.position;
            string name = gorilla.name;
            gorillas.Remove(id);
            Destroy(gorilla.gameObject);

            var hunter = SpawnHunter(id, position + Vector3.up * 0.5f);
            hunter.name = $"Hunter (was {name})";
            if (wasControlled)
                Possess(hunter);
            Announce($"{name} was dragged to the boat and joins the hunters!");
        }

        void OnLastGorillaStanding(int id)
        {
            if (!gorillas.TryGetValue(id, out var gorilla))
                return;
            gorilla.SetRage(true);
            Announce($"{gorilla.name} is the last gorilla: permanent RAGE");
        }

        void OnRoundEnded(RoundResult result, RoundEndReason reason)
        {
            string why;
            switch (reason)
            {
                case RoundEndReason.AllGorillasConverted: why = "every gorilla was converted"; break;
                case RoundEndReason.TimerExpired: why = "the gorillas outlasted the timer"; break;
                default: why = "the hunters ran out of lives"; break;
            }
            Announce($"{(result == RoundResult.HuntersWin ? "HUNTERS WIN" : "GORILLAS WIN")}: {why}. F5 for a new round.",
                     seconds: 3600f);
        }

        // ---------------------------------------------------------------- Per-frame rules

        void ApplyHolds()
        {
            bool gorillasHeld = Round.GorillasHeld;
            bool huntersHeld = Round.Phase == RoundPhase.Briefing;
            foreach (var g in gorillas.Values)
                g.IsHeld = gorillasHeld;
            foreach (var h in hunters.Values)
                h.IsHeld = huntersHeld;
        }

        void CheckBoatDeliveries()
        {
            deliveries.Clear();
            foreach (var pair in gorillas)
                if (pair.Value.IsBeingDragged && IsInBoatZone(pair.Value.transform.position))
                    deliveries.Add(pair.Key);
            foreach (int id in deliveries)
                Round.ReportGorillaSecured(id);
        }

        bool IsInBoatZone(Vector3 position)
        {
            if (island.boatZones == null)
                return false;
            foreach (var zone in island.boatZones)
            {
                Vector2 d = new Vector2(position.x - zone.x, position.z - zone.z);
                if (d.sqrMagnitude <= BoatZoneRadius * BoatZoneRadius)
                    return true;
            }
            return false;
        }

        // ---------------------------------------------------------------- Spawning

        HunterController SpawnHunter(int id, Vector3 position)
        {
            var hunter = GreyboxCharacterFactory.SpawnHunter(position, 15f);
            hunter.name = $"Hunter {id}";
            hunter.Health.Died += _ => OnHunterDied(id);
            hunters[id] = hunter;
            return hunter;
        }

        Vector3 HunterSpawn(int index)
        {
            var origin = setup.spawnNearTestArea ? island.hunterTestSpawn : island.hunterCampSpawn;
            return origin + Vector3.right * (3f * index);
        }

        Vector3 GorillaSpawn(int index)
        {
            var origin = setup.spawnNearTestArea ? island.gorillaTestSpawn : island.gorillaNestSpawn;
            return origin + Vector3.right * (5f * index);
        }

        void ClearCharacters()
        {
            foreach (var g in gorillas.Values)
                if (g != null)
                    Destroy(g.gameObject);
            foreach (var h in hunters.Values)
                if (h != null)
                    Destroy(h.gameObject);
            gorillas.Clear();
            hunters.Clear();
            Controlled = null;
        }

        void Announce(string text, float seconds = AnnouncementSeconds)
        {
            Announcement = text;
            announcementExpiry = Time.time + seconds;
        }

        static string Pretty(string id) =>
            System.Globalization.CultureInfo.InvariantCulture.TextInfo.ToTitleCase(id.Replace('_', ' '));
    }
}
