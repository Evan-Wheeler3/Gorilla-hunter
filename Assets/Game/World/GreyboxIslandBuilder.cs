using System.Collections.Generic;
using PrimalRaid.Core;
using UnityEngine;

namespace PrimalRaid.World
{
    /// <summary>
    /// Builds the greybox island from primitives at runtime (design doc section 7 zones,
    /// 300 x 300 m). Layout only: no art, no burnable trees, no fire yet.
    /// Axes: +X east, +Z north, ground top at y = 0.
    /// </summary>
    public static class GreyboxIslandBuilder
    {
        public const float HalfSize = IslandLayout.HalfSize;
        const float DockClearRadius = 28f;

        public struct Result
        {
            public Transform root;
            /// <summary>Test spawns placed close together beside the first swing line.</summary>
            public Vector3 gorillaTestSpawn;
            public Vector3 hunterTestSpawn;
            /// <summary>Real match spawns (north canopy and south camp).</summary>
            public Vector3 gorillaNestSpawn;
            public Vector3 hunterCampSpawn;
            /// <summary>Centre of each boat delivery zone (one per shore).</summary>
            public Vector3[] boatZones;
        }

        static readonly Color Grass = new Color(0.36f, 0.62f, 0.27f);
        static readonly Color Sand = new Color(0.86f, 0.78f, 0.55f);
        static readonly Color Water = new Color(0.16f, 0.38f, 0.72f);
        static readonly Color Trunk = new Color(0.45f, 0.29f, 0.16f);
        static readonly Color Leaves = new Color(0.18f, 0.5f, 0.2f);
        static readonly Color LeavesDark = new Color(0.12f, 0.38f, 0.16f);
        static readonly Color Stone = new Color(0.58f, 0.57f, 0.52f);
        static readonly Color Wood = new Color(0.6f, 0.43f, 0.26f);
        static readonly Color Khaki = new Color(0.64f, 0.6f, 0.42f);
        static readonly Color Vine = new Color(0.25f, 0.45f, 0.15f);
        static readonly Color Beam = new Color(1f, 0.85f, 0.3f);
        static readonly Color FireEdge = new Color(0.95f, 0.4f, 0.1f);

        // Areas kept clear of random trees, as (xMin, zMin, width, depth).
        static readonly Rect[] clearAreas =
        {
            new Rect(-14f, -14f, 28f, 28f),     // temple
            new Rect(-99f, -150f, 18f, 300f),   // river
            new Rect(-40f, -150f, 80f, 45f),    // hunter camp
            new Rect(-12f, -50f, 24f, 22f),     // test spawn clearing
        };

        public static Result Build(int seed = 1234)
        {
            var root = new GameObject("Greybox Island").transform;
            var rng = new System.Random(seed);

            BuildGround(root);
            BuildLighting(root);
            BuildTemple(root);
            var boatZones = new Vector3[IslandLayout.BoatDocks.Length];
            for (int i = 0; i < boatZones.Length; i++)
                boatZones[i] = BuildBoatDock(root, IslandLayout.BoatDocks[i]);
            BuildHunterCamp(root);
            BuildFireEdgeMarker(root);

            var trees = new GameObject("Trees").transform;
            trees.SetParent(root, false);
            // Mid-jungle: mixed trees and clearings.
            ScatterTrees(trees, rng, new Rect(-80f, -100f, 220f, 180f), 110, 10f, 16f);
            // Gorilla nest: dense, tall canopy.
            ScatterTrees(trees, rng, new Rect(-80f, 80f, 220f, 65f), 70, 15f, 22f);

            BuildSwingLines(root, rng);

            return new Result
            {
                root = root,
                gorillaTestSpawn = new Vector3(4f, 0.1f, -32f),
                hunterTestSpawn = new Vector3(-2f, 0.1f, -46f),
                gorillaNestSpawn = new Vector3(20f, 0.1f, 120f),
                hunterCampSpawn = new Vector3(0f, 0.1f, -125f),
                boatZones = boatZones,
            };
        }

        static void BuildGround(Transform root)
        {
            var ground = GreyboxMaterials.Box("Ground", root, new Vector3(0f, -0.5f, 0f),
                                              new Vector3(HalfSize * 2f, 1f, HalfSize * 2f), Grass);
            ground.isStatic = true;

            // Sand ring and sea so the island reads as an island.
            GreyboxMaterials.Box("Beach East", root, new Vector3(HalfSize + 10f, -0.55f, 0f),
                                 new Vector3(20f, 1f, HalfSize * 2f + 40f), Sand);
            GreyboxMaterials.Box("Beach West", root, new Vector3(-HalfSize - 10f, -0.55f, 0f),
                                 new Vector3(20f, 1f, HalfSize * 2f + 40f), Sand);
            GreyboxMaterials.Box("Beach North", root, new Vector3(0f, -0.55f, HalfSize + 10f),
                                 new Vector3(HalfSize * 2f, 1f, 20f), Sand);
            GreyboxMaterials.Box("Beach South", root, new Vector3(0f, -0.55f, -HalfSize - 10f),
                                 new Vector3(HalfSize * 2f, 1f, 20f), Sand);
            GreyboxMaterials.Box("Sea", root, new Vector3(0f, -1.6f, 0f), new Vector3(900f, 1f, 900f), Water);

            // River (west-centre): visual strip for now; slow-down comes with the map pass.
            GreyboxMaterials.Box("River", root, new Vector3(-90f, 0.02f, 0f),
                                 new Vector3(12f, 0.06f, HalfSize * 2f), Water, collider: false);
            var rocks = new GameObject("River Rocks").transform;
            rocks.SetParent(root, false);
            for (int i = 0; i < 9; i++)
            {
                float z = -110f + i * 27f;
                GreyboxMaterials.Box("Boulder", rocks, new Vector3(-90f + (i % 2 == 0 ? -4f : 4f), 1f, z),
                                     new Vector3(3f, 2.5f, 3f), Stone);
            }
        }

        static void BuildLighting(Transform root)
        {
            var sun = new GameObject("Sun (late afternoon)").AddComponent<Light>();
            sun.transform.SetParent(root, false);
            sun.type = LightType.Directional;
            sun.color = new Color(1f, 0.88f, 0.72f);
            sun.intensity = 1.25f;
            sun.shadows = LightShadows.Soft;
            sun.transform.rotation = Quaternion.Euler(28f, 125f, 0f);

            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.55f, 0.58f, 0.62f);
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = new Color(0.78f, 0.84f, 0.88f);
            RenderSettings.fogStartDistance = 90f;
            RenderSettings.fogEndDistance = 320f;
        }

        static void BuildTemple(Transform root)
        {
            // Ruined temple (centre): climbable stone with a walkable roof.
            var temple = new GameObject("Temple").transform;
            temple.SetParent(root, false);
            var walls = new[]
            {
                (new Vector3(0f, 3f, 7f), new Vector3(16f, 6f, 2f)),
                (new Vector3(-7f, 3f, 0f), new Vector3(2f, 6f, 12f)),
                (new Vector3(7f, 3f, 0f), new Vector3(2f, 6f, 12f)),
                (new Vector3(-5f, 3f, -7f), new Vector3(6f, 6f, 2f)),
                (new Vector3(5f, 3f, -7f), new Vector3(6f, 6f, 2f)),
            };
            foreach (var (pos, size) in walls)
                GreyboxMaterials.Box("Wall", temple, pos, size, Stone).AddComponent<Climbable>();

            GreyboxMaterials.Box("Roof", temple, new Vector3(0f, 6.4f, 0f), new Vector3(17f, 0.8f, 17f), Stone);
            for (int i = 0; i < 6; i++)
                GreyboxMaterials.Box("Step", temple, new Vector3(0f, 0.5f * i + 0.25f, -10.5f + i * 0.6f),
                                     new Vector3(4f, 0.5f, 1.2f), Stone);
        }

        /// <summary>
        /// A boat dock: the delivery zone at the shoreline, a pier running inland, the boat out at
        /// sea and a light beam to navigate by. Local +X points out to sea. Returns the zone centre.
        /// </summary>
        static Vector3 BuildBoatDock(Transform root, BoatDock spec)
        {
            var dock = new GameObject("Boat Dock").transform;
            dock.SetParent(root, false);
            dock.localPosition = new Vector3(spec.x, 0f, spec.z);
            dock.localRotation = Quaternion.Euler(0f, spec.outwardYaw, 0f);

            GreyboxMaterials.Box("Pier", dock, new Vector3(-10f, 0.6f, 0f), new Vector3(30f, 0.4f, 6f), Wood);
            for (int i = 0; i < 6; i++)
                GreyboxMaterials.Box("Post", dock, new Vector3(-23f + i * 5f, 0f, 3.2f), new Vector3(0.4f, 2f, 0.4f), Wood);
            GreyboxMaterials.Box("Boat Hull", dock, new Vector3(8f, 0f, -5f), new Vector3(16f, 2.2f, 6f), Wood);
            GreyboxMaterials.Box("Boat Cabin", dock, new Vector3(11f, 2.1f, -5f), new Vector3(5f, 2f, 4f), Khaki);
            var zone = GreyboxMaterials.Box("Boat Zone", dock, new Vector3(0f, 1.5f, 0f), new Vector3(10f, 3f, 10f),
                                            Beam, collider: false);
            zone.GetComponent<Renderer>().enabled = false; // zone volume, gameplay hooks come with dragging
            GreyboxMaterials.Box("Boat Beam", dock, new Vector3(0f, 40f, 0f), new Vector3(1.2f, 80f, 1.2f),
                                 Beam, collider: false);
            return dock.position;
        }

        static void BuildHunterCamp(Transform root)
        {
            // Hunter camp (south): trucks, tents and crates.
            var camp = new GameObject("Hunter Camp").transform;
            camp.SetParent(root, false);
            GreyboxMaterials.Box("Truck", camp, new Vector3(-18f, 1.4f, -130f), new Vector3(3f, 2.8f, 7f), Khaki);
            GreyboxMaterials.Box("Truck", camp, new Vector3(16f, 1.4f, -132f), new Vector3(3f, 2.8f, 7f), Khaki);
            GreyboxMaterials.Box("Tent", camp, new Vector3(-6f, 1.2f, -138f), new Vector3(5f, 2.4f, 4f), Sand);
            GreyboxMaterials.Box("Tent", camp, new Vector3(6f, 1.2f, -139f), new Vector3(5f, 2.4f, 4f), Sand);
            for (int i = 0; i < 5; i++)
                GreyboxMaterials.Box("Crate", camp, new Vector3(-10f + i * 5f, 0.5f, -118f), Vector3.one, Wood);
        }

        static void BuildFireEdgeMarker(Transform root)
        {
            // Wildfire edge (west): marker only; the fire system arrives in week 5.
            GreyboxMaterials.Box("Fire Start Line", root, new Vector3(-HalfSize + 1f, 0.05f, 0f),
                                 new Vector3(2f, 0.1f, HalfSize * 2f), FireEdge, collider: false);
        }

        static void ScatterTrees(Transform parent, System.Random rng, Rect area, int count,
                                 float minHeight, float maxHeight)
        {
            var placed = new List<Vector2>();
            int attempts = 0;
            while (placed.Count < count && attempts++ < count * 20)
            {
                var p = new Vector2(Range(rng, area.xMin, area.xMax), Range(rng, area.yMin, area.yMax));
                if (IsCleared(p) || TooClose(placed, p, 7f))
                    continue;
                placed.Add(p);
                BuildTree(parent, new Vector3(p.x, 0f, p.y), Range(rng, minHeight, maxHeight), rng);
            }
        }

        /// <summary>
        /// A climbable trunk, a standable leafy crown on top, and one or two side branches.
        /// Gorillas climbing into the crown or a branch mantle onto it.
        /// </summary>
        public static void BuildTree(Transform parent, Vector3 basePosition, float height, System.Random rng)
        {
            var tree = new GameObject("Tree").transform;
            tree.SetParent(parent, false);
            tree.localPosition = basePosition;

            GreyboxMaterials.Box("Trunk", tree, new Vector3(0f, height * 0.5f, 0f), new Vector3(1.2f, height, 1.2f), Trunk)
                .AddComponent<Climbable>();
            GreyboxMaterials.Box("Crown", tree, new Vector3(0f, height + 0.75f, 0f), new Vector3(6f, 1.5f, 6f),
                                 rng.Next(2) == 0 ? Leaves : LeavesDark);

            int branches = 1 + rng.Next(2);
            for (int i = 0; i < branches; i++)
            {
                float y = height * Range(rng, 0.4f, 0.7f);
                float angle = rng.Next(4) * 90f;
                var dir = Quaternion.Euler(0f, angle, 0f) * Vector3.forward;
                var branch = GreyboxMaterials.Box("Branch", tree, dir * 2.2f + Vector3.up * y,
                                                  new Vector3(1.4f, 0.4f, 3.4f), Trunk);
                branch.transform.localRotation = Quaternion.Euler(0f, angle, 0f);
            }
        }

        static void BuildSwingLines(Transform root, System.Random rng)
        {
            // 7 vine lines through the mid-jungle (doc asks for 6 to 8). The first one runs past
            // the test spawn so swinging is testable without travelling.
            var lines = new GameObject("Swing Lines").transform;
            lines.SetParent(root, false);
            var starts = new[]
            {
                (new Vector3(-6f, 0f, -26f), 0f),
                (new Vector3(-60f, 0f, -70f), 30f),
                (new Vector3(40f, 0f, -80f), -20f),
                (new Vector3(-55f, 0f, 20f), 75f),
                (new Vector3(30f, 0f, 30f), 10f),
                (new Vector3(70f, 0f, -20f), -60f),
                (new Vector3(-20f, 0f, 55f), 100f),
            };

            foreach (var (start, heading) in starts)
            {
                var dir = Quaternion.Euler(0f, heading, 0f) * Vector3.forward;
                var line = new GameObject("Swing Line").transform;
                line.SetParent(lines, false);
                for (int i = 0; i < 6; i++)
                {
                    float height = 12f + Range(rng, -1f, 1.5f);
                    var point = start + dir * (i * 9f) + Vector3.up * height;
                    BuildAnchor(line, point);
                }
            }
        }

        static void BuildAnchor(Transform parent, Vector3 point)
        {
            var anchor = new GameObject("Swing Anchor").transform;
            anchor.SetParent(parent, false);
            anchor.localPosition = point;
            anchor.gameObject.AddComponent<SwingAnchor>();

            var knot = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            knot.name = "Knot";
            Object.DestroyImmediate(knot.GetComponent<Collider>());
            knot.transform.SetParent(anchor, false);
            knot.transform.localScale = Vector3.one * 0.8f;
            knot.GetComponent<Renderer>().sharedMaterial = GreyboxMaterials.Get(Vine);

            GreyboxMaterials.Box("Vine", anchor, new Vector3(0f, 3f, 0f), new Vector3(0.15f, 6f, 0.15f), Vine,
                                 collider: false);
        }

        static bool IsCleared(Vector2 p)
        {
            if (IslandLayout.DistanceToNearestBoat(p.x, p.y) < DockClearRadius)
                return true;
            foreach (var r in clearAreas)
                if (r.Contains(p))
                    return true;
            return false;
        }

        static bool TooClose(List<Vector2> placed, Vector2 p, float minDistance)
        {
            float sqr = minDistance * minDistance;
            foreach (var q in placed)
                if ((q - p).sqrMagnitude < sqr)
                    return true;
            return false;
        }

        static float Range(System.Random rng, float min, float max) => min + (float)rng.NextDouble() * (max - min);
    }
}
