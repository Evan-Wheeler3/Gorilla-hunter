using System;

namespace PrimalRaid.Core
{
    /// <summary>Round, team and world tunables (design doc sections 3 and 7).</summary>
    [Serializable]
    public sealed class MatchStats
    {
        public int minPlayers = 4;
        public int maxPlayers = 12;
        public int playersPerGorilla = 4;     // gorillas = ceil(players / 4)
        public int roundsPerMatch = 3;

        public float briefingSeconds = 20f;
        public float hunterHeadStartSeconds = 20f;
        public float roundSeconds = 720f;     // 12:00
        public float fireStartSeconds = 360f; // 6:00
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
        public float thirdPersonDistance = 6.5f;
        public float thirdPersonHeight = 2.4f;
    }
}
