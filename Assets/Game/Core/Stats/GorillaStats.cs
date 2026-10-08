using System;

namespace PrimalRaid.Core
{
    /// <summary>
    /// Gorilla tunables (design doc section 4). Values marked "assumption" are not in the
    /// design doc and were picked as starting points for playtesting.
    /// </summary>
    [Serializable]
    public sealed class GorillaStats
    {
        // Body
        public float height = 3.2f;          // ~32 voxels at 0.1 m
        public float radius = 0.9f;

        // Ground movement
        public float groundSpeed = 9f;       // knuckle-run, m/s
        public float groundAcceleration = 60f;   // assumption
        public float airAcceleration = 14f;      // assumption
        public float jumpHeight = 6f;            // vertical, m

        // Dash (doc says "short dash"; numbers are assumptions)
        public float dashSpeed = 20f;
        public float dashDuration = 0.2f;
        public float dashCooldown = 1.5f;
        public float dashStaminaCost = 20f;

        // Stamina
        public float maxStamina = 100f;
        public float climbStaminaDrainPerSecond = 8f;
        public float swingAttachStaminaCost = 15f;
        public float groundStaminaRegenPerSecond = 12f;

        // Climbing
        public float climbSpeed = 4.5f;          // assumption
        public float climbJumpOffSpeed = 7f;     // assumption, push away from trunk
        public float mantleDuration = 0.25f;     // assumption

        // Swinging (pendulum constraint, clamped for control)
        public float swingAttachRange = 7f;      // assumption
        public float swingMinRopeLength = 2.5f;  // assumption
        public float swingMaxSpeed = 24f;        // assumption
        public float swingPumpAcceleration = 8f; // assumption
        public float swingLandingSlowDuration = 0.4f;
        public float swingLandingSlowMultiplier = 0.5f; // assumption

        // Swipe
        public float swipeCooldown = 0.6f;
        public float swipeDamage = 100f;         // owner: one hit kills a hunter
        public float swipeRange = 2.6f;          // assumption
        public float swipeKnockback = 9f;        // assumption

        // Grab and finishers
        public float grabWindup = 0.8f;

        // Rage
        public float maxRage = 100f;
        public float ragePerKill = 25f;
        public float rageDecayPerSecond = 1f;    // doc says "decays slowly"; assumption
        public float rageModeDuration = 15f;
        public float rageSwipeCooldownMultiplier = 0.5f; // "faster swipes"; assumption

        // Chest beat
        public float chestBeatCooldown = 20f;
        public float chestBeatRevealRadius = 40f;
        public float chestBeatRevealDuration = 4f;
        public float chestBeatAimShakeDuration = 3f;
    }
}
