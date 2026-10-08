using System;

namespace PrimalRaid.Core
{
    /// <summary>Round, team and world tunables (design doc sections 3 and 7).</summary>
    [Serializable]
    public sealed class MatchStats
    {
        public int minPlayers = 4;
        public int maxPlayers = 12;
        // Infection mode (owner): few hunters start; a gorilla dragged to the boat becomes a hunter.
        public int playersPerStartingHunter = 5;      // hunters = ceil(players / 5): 10 players = 2 v 8
        public int sharedHunterLives = 100;           // team respawn pool, battlefield-style
        public float hunterRespawnSeconds = 5f;       // assumption
        public bool lastGorillaGetsPermanentRage = true;
        public int roundsPerMatch = 3;

        public float briefingSeconds = 20f;
        public float hunterHeadStartSeconds = 20f;
        public float roundSeconds = 600f;     // owner: 10:00
        public float fireStartSeconds = 300f; // 5:00
        public float fireSpeed = 1.5f;        // m/s, west to east
        public float fireLethalSeconds = 2f;

        public float spectatorPingCooldown = 20f;
    }

    [Serializable]
    public sealed class WorldStats
    {
        /// <summary>Shared gravity for characters, m/s^2. Higher than 9.81 for snappier jumps (assumption).</summary>
        public float gravity = 20f;
    }

    [Serializable]
    public sealed class ControlStats
    {
        public float mouseSensitivity = 2f;
        public float thirdPersonDistance = 7.5f;
        public float thirdPersonHeight = 3.6f;   // above the 3.2 m gorilla's head so it doesn't block the view
    }
}
