using PrimalRaid.Core;
using UnityEngine;

namespace PrimalRaid.Config
{
    /// <summary>
    /// The single home for every tunable number in the game. Gameplay code reads
    /// <see cref="Active"/>; balance changes happen in the GameConfig asset, never in code.
    /// </summary>
    [CreateAssetMenu(menuName = "Primal Raid/Game Config", fileName = "GameConfig")]
    public sealed class GameConfig : ScriptableObject
    {
        /// <summary>Resources path the runtime loads the config asset from.</summary>
        public const string ResourcePath = "GameConfig";

        public GorillaStats gorilla = new GorillaStats();
        public HunterStats hunter = new HunterStats();
        public SedationStats sedation = new SedationStats();
        public TrapStats traps = new TrapStats();
        public DragStats drag = new DragStats();
        public MatchStats match = new MatchStats();
        public WorldStats world = new WorldStats();
        public ControlStats controls = new ControlStats();

        static GameConfig active;

        /// <summary>
        /// The config in use. Loads Resources/GameConfig, or falls back to code defaults so a
        /// fresh checkout still runs before the asset is created.
        /// </summary>
        public static GameConfig Active
        {
            get
            {
                if (active != null)
                    return active;

                active = Resources.Load<GameConfig>(ResourcePath);
                if (active == null)
                {
                    active = CreateInstance<GameConfig>();
                    active.name = "GameConfig (code defaults)";
                    Debug.LogWarning("No Resources/GameConfig asset found; using code defaults. " +
                                     "Create one with Primal Raid > Create GameConfig Asset.");
                }
                return active;
            }
        }

        /// <summary>Clears the cached config, e.g. when domain reload is disabled.</summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetCache() => active = null;
    }
}
