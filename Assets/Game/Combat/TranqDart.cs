using PrimalRaid.Config;
using PrimalRaid.World;
using UnityEngine;

namespace PrimalRaid.Combat
{
    /// <summary>
    /// A tranquilizer dart simulated as a ballistic point with gravity drop. Each frame it
    /// raycasts along its path, so fast darts cannot tunnel. Local-only for now; in week 3 the
    /// host simulates darts and clients show a cosmetic copy.
    /// </summary>
    public sealed class TranqDart : MonoBehaviour
    {
        static readonly RaycastHit[] hits = new RaycastHit[16];
        static readonly Color DartColor = new Color(0.95f, 0.2f, 0.6f);

        Vector3 velocity;
        Transform owner;
        float gravity;
        float dieTime;
        bool stuck;

        public static TranqDart Fire(Vector3 origin, Vector3 direction, Transform owner)
        {
            var cfg = GameConfig.Active.hunter;
            var go = GreyboxMaterials.Box("Tranq Dart", null, origin, new Vector3(0.06f, 0.06f, 0.35f), DartColor,
                                          collider: false);
            var dart = go.AddComponent<TranqDart>();
            dart.velocity = direction.normalized * cfg.dartSpeed;
            dart.owner = owner;
            dart.gravity = cfg.dartGravity;
            dart.dieTime = Time.time + cfg.dartLifetime;
            go.transform.rotation = Quaternion.LookRotation(direction);
            return dart;
        }

        void Update()
        {
            if (Time.time >= dieTime)
            {
                Destroy(gameObject);
                return;
            }
            if (stuck)
                return;

            float dt = Time.deltaTime;
            velocity += Vector3.down * (gravity * dt);
            Vector3 start = transform.position;
            Vector3 step = velocity * dt;

            if (TryHit(start, step, out var hit))
            {
                transform.position = hit.point;
                stuck = true;
                dieTime = Time.time + 3f;

                var target = hit.collider.GetComponentInParent<SedationTarget>();
                if (target != null)
                {
                    target.ApplyDart();
                    transform.SetParent(target.transform, true);
                }
                return;
            }

            transform.position = start + step;
            if (velocity.sqrMagnitude > 0.01f)
                transform.rotation = Quaternion.LookRotation(velocity);
        }

        bool TryHit(Vector3 start, Vector3 step, out RaycastHit closest)
        {
            closest = default;
            float distance = step.magnitude;
            if (distance <= 0f)
                return false;

            int count = Physics.RaycastNonAlloc(start, step / distance, hits, distance, ~0, QueryTriggerInteraction.Ignore);
            bool found = false;
            for (int i = 0; i < count; i++)
            {
                var h = hits[i];
                if (owner != null && h.transform.IsChildOf(owner))
                    continue;
                if (!found || h.distance < closest.distance)
                {
                    closest = h;
                    found = true;
                }
            }
            return found;
        }
    }
}
