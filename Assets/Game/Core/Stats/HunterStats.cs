using System;

namespace PrimalRaid.Core
{
    /// <summary>
    /// Hunter tunables (design doc section 5). Values marked "assumption" are not in the
    /// design doc and were picked as starting points for playtesting.
    /// </summary>
    [Serializable]
    public sealed class HunterStats
    {
        // Body
        public float height = 1.8f;          // ~18 voxels at 0.1 m
        public float radius = 0.35f;
        public float eyeHeight = 1.62f;

        public float maxHealth = 100f;

        // Movement
        public float walkSpeed = 4f;
        public float sprintSpeed = 6f;
        public float sprintStaminaSeconds = 3f;
        public float sprintRechargePerSecond = 1f;   // assumption: full recharge in 3 s
        public float groundAcceleration = 40f;       // assumption
        public float airAcceleration = 8f;           // assumption
        public float jumpHeight = 1.1f;              // assumption
        public float knockbackDamping = 6f;          // assumption, 1/s

        // Tranq rifle
        public int rifleMagazine = 1;
        public float rifleReloadSeconds = 5f;
        public float dartSpeed = 80f;
        public float dartGravity = 4f;               // "slight drop"; assumption
        public float dartLifetime = 4f;              // assumption
        public bool rifleAutoReload = false;         // assumption: doc maps reload to R

        // Pistol
        public int pistolMagazine = 12;
        public float pistolReloadSeconds = 0.6f;
        public float pistolFlinchSeconds = 0.3f;

        // Equipment counts
        public int trapsPerHunter = 2;
        public int flaresPerHunter = 1;
        public int tripwiresPerHunter = 2;

        // Flare
        public float flareCanopyBurnSeconds = 8f;

        // Camera
        public float hipFieldOfView = 75f;           // assumption
        public float adsFieldOfView = 45f;           // assumption
    }
}
