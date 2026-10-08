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

        public float maxHealth = 100f;               // gorilla swipe does 100: one hit kills

        // Movement
        public float walkSpeed = 4f;
        public float sprintSpeed = 6f;
        public bool unlimitedSprint = true;          // hunters are the hunted minority; see DESIGN_CHANGES.md
        public float sprintStaminaSeconds = 10f;     // used only when unlimitedSprint is off
        public float sprintRechargePerSecond = 2.5f; // assumption: full recharge in 4 s
        public float groundAcceleration = 40f;       // assumption
        public float airAcceleration = 8f;           // assumption
        public float jumpHeight = 1.1f;              // assumption
        public float knockbackDamping = 6f;          // assumption, 1/s

        // Tranq rifle
        public int rifleMagazine = 1;
        public float rifleReloadSeconds = 3.5f;      // owner: 3 to 4 s
        public float dartSpeed = 80f;
        public float dartGravity = 4f;               // "slight drop"; assumption
        public float dartLifetime = 10f;             // owner: no real range limit, only drop; ~800 m of flight
        public bool rifleAutoReload = true;          // owner

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
