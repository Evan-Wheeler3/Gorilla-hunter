// Every tunable number in the game lives here (design doc rule: never hard-code balance values).
// Values marked "owner" are the owner's decisions; "assumption" ones are starting points for playtests.

export const config = {
  world: {
    voxelSize: 0.5, // metres per voxel
    sizeX: 256, // voxels: 128 m island area, sized for 4 friends
    sizeY: 64, // voxels: 32 m tall
    sizeZ: 256,
    waterLevel: 2, // metres
    gravity: 20, // m/s^2, snappier than 9.81 (assumption)
  },

  gorilla: {
    height: 2.8,
    halfWidth: 0.7,
    groundSpeed: 9,
    groundAcceleration: 60,
    airAcceleration: 14,
    jumpHeight: 4.5,
    dashSpeed: 18,
    dashDuration: 0.2,
    dashCooldown: 1.5,
    dashStaminaCost: 20,
    maxStamina: 100,
    climbStaminaDrainPerSecond: 8,
    swingAttachStaminaCost: 15,
    groundStaminaRegenPerSecond: 12,
    climbSpeed: 4.5,
    climbJumpOffSpeed: 7,
    mantleDuration: 0.3,
    swingAttachRange: 6,
    swingMinRopeLength: 2.5,
    swingMaxSpeed: 22,
    swingPumpAcceleration: 9,
    swingLandingSlowDuration: 0.4,
    swingLandingSlowMultiplier: 0.5,
    swipeCooldown: 0.6,
    swipeRange: 2.6,
    swipeDamage: 100, // owner: one hit kills a hunter
    swipeKnockback: 9,
    rageSwipeCooldownMultiplier: 0.5,
  },

  hunter: {
    height: 1.8,
    halfWidth: 0.3,
    maxHealth: 100,
    walkSpeed: 4.5,
    sprintSpeed: 6.5,
    unlimitedSprint: true, // owner-approved: hunters are the hunted minority
    groundAcceleration: 40,
    airAcceleration: 8,
    jumpHeight: 1.1,
    knockbackDamping: 6,
    rifleReloadSeconds: 3.5, // owner: 3 to 4 s
    rifleAutoReload: true, // owner
    dartSpeed: 80,
    dartGravity: 4, // owner: no range limit, only drop
    dartLifetime: 6,
    interactReach: 2.8,
    dragDistance: 2.4,
    tapMaxSeconds: 0.3,
  },

  sedation: {
    maxSedation: 100,
    dartSedation: 100, // owner: one dart drops a gorilla
    decayDelaySeconds: 4,
    decayPerSecond: 50,
    maxSlow: 0.3,
    collapseSeconds: 15, // owner
    boundSeconds: 30,
    bindSeconds: 3,
    draggedDowntimeRate: 0.4,
    slapWakeSeconds: 2, // owner: each slap knocks time off a downed teammate
    wakeThrowStunSeconds: 1.5,
  },

  match: {
    minPlayers: 2,
    maxPlayers: 4,
    playersPerStartingHunter: 5, // hunters = ceil(players / 5): 4 players = 1 v 3
    sharedHunterLives: 100,
    hunterRespawnSeconds: 5,
    lastGorillaGetsPermanentRage: true,
    briefingSeconds: 5,
    hunterHeadStartSeconds: 10,
    roundSeconds: 600, // owner: 10 minutes
    fireStartSeconds: 300,
    boatZoneRadius: 5,
  },

  finishers: {
    commonWeight: 50,
    uncommonWeight: 30,
    rareWeight: 15,
    legendaryWeight: 5,
    rageRareAndLegendaryMultiplier: 2,
    matchNoRepeatWindow: 3,
  },

  controls: {
    mouseSensitivity: 0.0025, // radians per pixel
    touchSensitivity: 0.006,
    cameraDistanceGorilla: 6.5,
    cameraHeightGorilla: 3.4,
    cameraDistanceHunter: 3.6,
    cameraHeightHunter: 1.75,
    cameraShoulderHunter: 0.7,
  },
};

export type Config = typeof config;
export type SedationStats = Config['sedation'];
export type MatchStats = Config['match'];
export type FinisherStats = Config['finishers'];
