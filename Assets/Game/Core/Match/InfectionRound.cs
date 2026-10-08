using System;
using System.Collections.Generic;

namespace PrimalRaid.Core
{
    public enum RoundPhase
    {
        Briefing,
        HunterHeadStart,
        Hunt,
        Wildfire,
        Ended,
    }

    public enum RoundResult
    {
        None,
        HuntersWin,
        GorillasWin,
    }

    public enum RoundEndReason
    {
        None,
        AllGorillasConverted,
        TimerExpired,
        HuntersEliminated,
    }

    /// <summary>
    /// Host-side rules for one infection round (see DESIGN_CHANGES.md). Engine-free: the match
    /// manager reports kills and boat deliveries, ticks the clock, and reacts to the events.
    /// Hunters win by converting every gorilla; gorillas win when the timer runs out, or when
    /// the shared life pool is empty and every hunter is dead.
    /// </summary>
    public sealed class InfectionRound
    {
        readonly MatchStats stats;
        readonly HashSet<int> gorillas;
        readonly HashSet<int> aliveHunters = new HashSet<int>();
        readonly HashSet<int> deadHunters = new HashSet<int>();
        readonly Dictionary<int, float> respawnTimers = new Dictionary<int, float>();
        readonly List<int> respawnedThisTick = new List<int>();

        public InfectionRound(MatchStats stats, IEnumerable<int> hunters, IEnumerable<int> gorillaIds)
        {
            this.stats = stats ?? throw new ArgumentNullException(nameof(stats));
            gorillas = new HashSet<int>(gorillaIds);
            foreach (int id in hunters)
            {
                if (gorillas.Contains(id))
                    throw new ArgumentException($"Player {id} is on both teams.");
                aliveHunters.Add(id);
            }
            if (gorillas.Count == 0 || aliveHunters.Count == 0)
                throw new ArgumentException("A round needs at least one hunter and one gorilla.");

            LivesRemaining = stats.sharedHunterLives;
            UpdateLastGorilla();
        }

        public RoundPhase Phase { get; private set; } = RoundPhase.Briefing;
        public RoundResult Result { get; private set; }
        public RoundEndReason EndReason { get; private set; }

        /// <summary>Seconds since the briefing ended (the round clock, head start included).</summary>
        public float RoundTime { get; private set; }
        public float BriefingRemaining { get; private set; }
        public float TimeRemaining => Math.Max(0f, stats.roundSeconds - RoundTime);
        public int LivesRemaining { get; private set; }

        /// <summary>The only gorilla left, or null. It gets permanent rage when the config allows.</summary>
        public int? LastGorilla { get; private set; }

        public IReadOnlyCollection<int> Gorillas => gorillas;
        public IReadOnlyCollection<int> AliveHunters => aliveHunters;
        public IReadOnlyCollection<int> DeadHunters => deadHunters;

        /// <summary>Gorillas may not leave the nest yet.</summary>
        public bool GorillasHeld => Phase == RoundPhase.Briefing || Phase == RoundPhase.HunterHeadStart;
        bool InPlay => Phase == RoundPhase.Hunt || Phase == RoundPhase.Wildfire || Phase == RoundPhase.HunterHeadStart;

        public event Action<RoundPhase> PhaseChanged;
        public event Action<int> HunterRespawned;
        public event Action<int> GorillaConverted;
        public event Action<int> LastGorillaStanding;
        public event Action<RoundResult, RoundEndReason> Ended;

        public void Start()
        {
            BriefingRemaining = stats.briefingSeconds;
            SetPhase(RoundPhase.Briefing);
            if (LastGorilla.HasValue)
                LastGorillaStanding?.Invoke(LastGorilla.Value);
        }

        public void Tick(float deltaTime)
        {
            if (Phase == RoundPhase.Ended || deltaTime <= 0f)
                return;

            if (Phase == RoundPhase.Briefing)
            {
                BriefingRemaining -= deltaTime;
                if (BriefingRemaining > 0f)
                    return;
                deltaTime = -BriefingRemaining; // carry the overshoot into the round clock
                BriefingRemaining = 0f;
                SetPhase(RoundPhase.HunterHeadStart);
            }

            RoundTime += deltaTime;
            TickRespawns(deltaTime);

            if (Phase == RoundPhase.HunterHeadStart && RoundTime >= stats.hunterHeadStartSeconds)
                SetPhase(RoundPhase.Hunt);
            if (Phase == RoundPhase.Hunt && RoundTime >= stats.fireStartSeconds)
                SetPhase(RoundPhase.Wildfire);
            if (RoundTime >= stats.roundSeconds)
                End(RoundResult.GorillasWin, RoundEndReason.TimerExpired);
        }

        /// <summary>A hunter died. Spends a life from the shared pool to respawn them, if any are left.</summary>
        public bool ReportHunterKilled(int hunterId)
        {
            if (!InPlay || !aliveHunters.Remove(hunterId))
                return false;

            deadHunters.Add(hunterId);
            if (LivesRemaining > 0)
            {
                LivesRemaining--;
                respawnTimers[hunterId] = stats.hunterRespawnSeconds;
            }
            CheckHuntersEliminated();
            return true;
        }

        /// <summary>A sedated gorilla reached a boat: it joins the hunters immediately.</summary>
        public bool ReportGorillaSecured(int gorillaId)
        {
            if (!InPlay || !gorillas.Remove(gorillaId))
                return false;

            aliveHunters.Add(gorillaId);
            GorillaConverted?.Invoke(gorillaId);

            if (gorillas.Count == 0)
            {
                End(RoundResult.HuntersWin, RoundEndReason.AllGorillasConverted);
                return true;
            }
            UpdateLastGorilla();
            if (LastGorilla.HasValue)
                LastGorillaStanding?.Invoke(LastGorilla.Value);
            return true;
        }

        /// <summary>A player disconnected mid-round.</summary>
        public void RemovePlayer(int playerId)
        {
            if (Phase == RoundPhase.Ended)
                return;

            if (gorillas.Remove(playerId))
            {
                if (gorillas.Count == 0)
                {
                    End(RoundResult.HuntersWin, RoundEndReason.AllGorillasConverted);
                    return;
                }
                int? previous = LastGorilla;
                UpdateLastGorilla();
                if (LastGorilla.HasValue && LastGorilla != previous)
                    LastGorillaStanding?.Invoke(LastGorilla.Value);
                return;
            }

            aliveHunters.Remove(playerId);
            deadHunters.Remove(playerId);
            respawnTimers.Remove(playerId);
            CheckHuntersEliminated();
        }

        public bool IsRespawning(int hunterId) => respawnTimers.ContainsKey(hunterId);

        public float RespawnRemaining(int hunterId) =>
            respawnTimers.TryGetValue(hunterId, out float t) ? Math.Max(0f, t) : 0f;

        void TickRespawns(float deltaTime)
        {
            if (respawnTimers.Count == 0)
                return;

            respawnedThisTick.Clear();
            foreach (int id in new List<int>(respawnTimers.Keys))
            {
                float t = respawnTimers[id] - deltaTime;
                respawnTimers[id] = t;
                if (t <= 0f)
                    respawnedThisTick.Add(id);
            }
            foreach (int id in respawnedThisTick)
            {
                respawnTimers.Remove(id);
                deadHunters.Remove(id);
                aliveHunters.Add(id);
                HunterRespawned?.Invoke(id);
            }
        }

        void CheckHuntersEliminated()
        {
            if (Phase != RoundPhase.Ended && aliveHunters.Count == 0 && respawnTimers.Count == 0)
                End(RoundResult.GorillasWin, RoundEndReason.HuntersEliminated);
        }

        void UpdateLastGorilla()
        {
            LastGorilla = null;
            if (!stats.lastGorillaGetsPermanentRage || gorillas.Count != 1)
                return;
            foreach (int id in gorillas)
                LastGorilla = id;
        }

        void SetPhase(RoundPhase phase)
        {
            Phase = phase;
            PhaseChanged?.Invoke(phase);
        }

        void End(RoundResult result, RoundEndReason reason)
        {
            if (Phase == RoundPhase.Ended)
                return;
            Result = result;
            EndReason = reason;
            respawnTimers.Clear();
            SetPhase(RoundPhase.Ended);
            Ended?.Invoke(result, reason);
        }
    }
}
