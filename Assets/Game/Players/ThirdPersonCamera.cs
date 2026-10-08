using UnityEngine;

namespace PrimalRaid.Players
{
    /// <summary>Orbit camera for the gorilla. Pulls in when geometry blocks the view.</summary>
    [RequireComponent(typeof(Camera))]
    public sealed class ThirdPersonCamera : MonoBehaviour
    {
        const float MinPitch = -35f;
        const float MaxPitch = 70f;
        const float CollisionRadius = 0.3f;

        static readonly RaycastHit[] hits = new RaycastHit[16];

        Transform target;
        float distance;
        float height;

        public float Yaw { get; private set; }
        public float Pitch { get; private set; } = 12f;
        public Camera Camera { get; private set; }

        void Awake() => Camera = GetComponent<Camera>();

        public void Setup(Transform target, float distance, float height)
        {
            this.target = target;
            this.distance = distance;
            this.height = height;
            Yaw = target.eulerAngles.y;
        }

        public void Look(Vector2 delta)
        {
            Yaw += delta.x;
            Pitch = Mathf.Clamp(Pitch - delta.y, MinPitch, MaxPitch);
        }

        void LateUpdate()
        {
            if (target == null)
                return;

            Vector3 pivot = target.position + Vector3.up * height;
            Vector3 back = Quaternion.Euler(Pitch, Yaw, 0f) * Vector3.back;
            float allowed = distance;

            int count = Physics.SphereCastNonAlloc(pivot, CollisionRadius, back, hits, distance, ~0,
                                                   QueryTriggerInteraction.Ignore);
            for (int i = 0; i < count; i++)
            {
                if (hits[i].transform.IsChildOf(target) || hits[i].distance <= 0f)
                    continue;
                allowed = Mathf.Min(allowed, hits[i].distance);
            }

            transform.position = pivot + back * allowed;
            transform.rotation = Quaternion.LookRotation(pivot - transform.position);
        }
    }
}
