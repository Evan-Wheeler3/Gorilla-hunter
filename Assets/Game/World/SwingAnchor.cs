using System.Collections.Generic;
using UnityEngine;

namespace PrimalRaid.World
{
    /// <summary>A point gorillas can attach to and swing from (vine, branch).</summary>
    public sealed class SwingAnchor : MonoBehaviour
    {
        static readonly List<SwingAnchor> all = new List<SwingAnchor>();

        public static IReadOnlyList<SwingAnchor> All => all;

        public Vector3 Point => transform.position;

        void OnEnable() => all.Add(this);
        void OnDisable() => all.Remove(this);

        /// <summary>
        /// Nearest anchor within <paramref name="range"/> of <paramref name="from"/> that sits
        /// above <paramref name="minHeight"/>, skipping <paramref name="exclude"/>, or null.
        /// </summary>
        public static SwingAnchor FindNearest(Vector3 from, float range, float minHeight, SwingAnchor exclude = null)
        {
            SwingAnchor best = null;
            float bestSqr = range * range;
            foreach (var anchor in all)
            {
                if (anchor == exclude)
                    continue;
                Vector3 p = anchor.Point;
                if (p.y < minHeight)
                    continue;
                float sqr = (p - from).sqrMagnitude;
                if (sqr <= bestSqr)
                {
                    bestSqr = sqr;
                    best = anchor;
                }
            }
            return best;
        }
    }
}
