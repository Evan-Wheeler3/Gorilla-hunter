namespace PrimalRaid.Core
{
    /// <summary>A boat delivery point on the shore: position (x east, z north) and the yaw its pier points out to sea.</summary>
    public readonly struct BoatDock
    {
        public readonly float x;
        public readonly float z;
        public readonly float outwardYaw;

        public BoatDock(float x, float z, float outwardYaw)
        {
            this.x = x;
            this.z = z;
            this.outwardYaw = outwardYaw;
        }
    }

    /// <summary>
    /// Engine-free layout facts the greybox builder and the balance tests share, so the
    /// "can hunters drag a gorilla to a boat in time" check runs against the real map.
    /// </summary>
    public static class IslandLayout
    {
        public const float HalfSize = 150f;

        /// <summary>
        /// One boat per shore: with a single east boat the far side of the island is over 300 m
        /// away, far more than a 15 s knockout allows. South dock sits east of the hunter camp.
        /// </summary>
        public static readonly BoatDock[] BoatDocks =
        {
            new BoatDock(HalfSize, 0f, 0f),       // east
            new BoatDock(0f, HalfSize, -90f),     // north (gorilla nest side)
            new BoatDock(-HalfSize, 0f, 180f),    // west (wildfire side)
            new BoatDock(60f, -HalfSize, 90f),    // south
        };

        /// <summary>Straight-line distance from a point to the nearest boat zone.</summary>
        public static float DistanceToNearestBoat(float x, float z)
        {
            float best = float.MaxValue;
            foreach (var dock in BoatDocks)
            {
                float dx = dock.x - x;
                float dz = dock.z - z;
                float d = (float)System.Math.Sqrt(dx * dx + dz * dz);
                if (d < best)
                    best = d;
            }
            return best;
        }
    }
}
