using System.Collections.Generic;
using PrimalRaid.Combat;
using PrimalRaid.Config;
using PrimalRaid.Core;
using PrimalRaid.World;
using UnityEngine;

namespace PrimalRaid.Players
{
    /// <summary>
    /// Gorilla movement and melee (design doc section 4): knuckle-run, dash, jump, trunk
    /// climbing with mantling onto branches, pendulum vine swinging, and the swipe.
    /// Grab, chest beat and rage arrive with the combat milestones.
    /// </summary>
    [RequireComponent(typeof(CharacterController), typeof(SedationTarget))]
    public sealed class GorillaController : MonoBehaviour, IControllable
    {
        public enum MoveState
        {
            Locomotion,
            Climbing,
            Mantling,
            Swinging,
            Collapsed,
        }

        const float StickToGroundSpeed = -2f;
        const float ClimbStickSpeed = 1.5f;
        const float AnchorReattachDelay = 0.4f;
        const float ReclimbDelay = 0.35f;

        static readonly RaycastHit[] rayHits = new RaycastHit[16];
        static readonly Collider[] overlapHits = new Collider[16];
        static readonly Color RopeColor = new Color(0.25f, 0.45f, 0.15f);

        readonly HashSet<Health> swipeVictims = new HashSet<Health>();

        CharacterController body;
        SedationTarget sedation;
        GorillaStats stats;
        float gravity;
        float sensitivity;

        Transform visual;
        ThirdPersonCamera cameraRig;
        LineRenderer rope;

        Vector3 velocity;
        float stamina;
        float dashTimer;
        float dashCooldownTimer;
        Vector3 dashDirection;
        float landingSlowTimer;
        bool airborneFromSwing;
        float swipeCooldownTimer;

        Vector3 climbNormal;
        float reclimbAllowedTime;
        Vector3 mantleStart;
        Vector3 mantleEnd;
        float mantleProgress;

        SwingAnchor swingAnchor;
        float ropeLength;
        SwingAnchor lastReleasedAnchor;
        float lastReleaseTime;

        public MoveState State { get; private set; }
        public float Stamina => stamina;
        public float StaminaNormalized => stamina / stats.maxStamina;
        public Vector3 Velocity => velocity;
        public SwingAnchor AnchorInRange { get; private set; }
        public float LastSwipeTime { get; private set; } = float.NegativeInfinity;
        public bool IsLandingSlowed => landingSlowTimer > 0f;
        public SedationTarget Sedation => sedation;

        public string DisplayName => "Gorilla";
        public bool HasControl { get; private set; }
        public Camera ViewCamera => cameraRig != null ? cameraRig.Camera : null;

        Vector3 Center => transform.position + Vector3.up * (stats.height * 0.5f);
        Vector3 Forward => Quaternion.Euler(0f, cameraRig != null ? cameraRig.Yaw : transform.eulerAngles.y, 0f) * Vector3.forward;

        void Awake()
        {
            var config = GameConfig.Active;
            stats = config.gorilla;
            gravity = config.world.gravity;
            sensitivity = config.controls.mouseSensitivity;
            stamina = stats.maxStamina;

            body = GetComponent<CharacterController>();
            body.height = stats.height;
            body.radius = stats.radius;
            body.center = Vector3.up * (stats.height * 0.5f);
            body.stepOffset = 0.5f;
            body.slopeLimit = 50f;

            sedation = GetComponent<SedationTarget>();
            sedation.Collapsed += _ => OnCollapsed();
            sedation.Woke += _ => OnWoke();

            rope = gameObject.AddComponent<LineRenderer>();
            rope.positionCount = 2;
            rope.startWidth = rope.endWidth = 0.12f;
            rope.sharedMaterial = GreyboxMaterials.Get(RopeColor);
            rope.enabled = false;
        }

        /// <summary>Wires the body visual (rotated on collapse) and the orbit camera.</summary>
        public void Setup(Transform visualRoot, ThirdPersonCamera rig)
        {
            visual = visualRoot;
            cameraRig = rig;
        }

        public void SetControl(bool hasControl)
        {
            HasControl = hasControl;
            if (cameraRig != null)
                cameraRig.gameObject.SetActive(hasControl);
        }

        /// <summary>Debug: refill stamina.</summary>
        public void RefillStamina() => stamina = stats.maxStamina;

        /// <summary>Debug: teleport and reset motion.</summary>
        public void Teleport(Vector3 position)
        {
            if (State == MoveState.Swinging)
                ReleaseSwing();
            if (State != MoveState.Collapsed)
                State = MoveState.Locomotion;
            velocity = Vector3.zero;
            SetPosition(position);
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (dt <= 0f)
                return;

            var input = HasControl ? KeyboardMouseInput.Read(sensitivity) : PlayerInput.None;
            if (cameraRig != null)
                cameraRig.Look(input.look);

            dashTimer -= dt;
            dashCooldownTimer -= dt;
            landingSlowTimer -= dt;
            swipeCooldownTimer -= dt;

            var exclude = Time.time - lastReleaseTime < AnchorReattachDelay ? lastReleasedAnchor : null;
            AnchorInRange = State == MoveState.Collapsed
                ? null
                : SwingAnchor.FindNearest(Center, stats.swingAttachRange, Center.y + 0.5f, exclude);

            switch (State)
            {
                case MoveState.Locomotion: UpdateLocomotion(input, dt); break;
                case MoveState.Climbing: UpdateClimbing(input, dt); break;
                case MoveState.Mantling: UpdateMantling(dt); break;
                case MoveState.Swinging: UpdateSwinging(input, dt); break;
                case MoveState.Collapsed: UpdateCollapsed(dt); break;
            }

            rope.enabled = State == MoveState.Swinging;
            if (rope.enabled)
            {
                rope.SetPosition(0, swingAnchor.Point);
                rope.SetPosition(1, Center + Vector3.up * 0.8f);
            }
        }

        // ---------------------------------------------------------------- Locomotion

        void UpdateLocomotion(PlayerInput input, float dt)
        {
            Vector3 forward = Forward;
            Vector3 right = Vector3.Cross(Vector3.up, forward);
            transform.rotation = Quaternion.LookRotation(forward);

            Vector3 wish = forward * input.move.y + right * input.move.x;
            Vector3 horizontal = new Vector3(velocity.x, 0f, velocity.z);
            bool grounded = body.isGrounded;
            float slow = landingSlowTimer > 0f ? stats.swingLandingSlowMultiplier : 1f;

            if (input.dashPressed && dashCooldownTimer <= 0f && stamina >= stats.dashStaminaCost)
            {
                dashTimer = stats.dashDuration;
                dashCooldownTimer = stats.dashCooldown;
                stamina -= stats.dashStaminaCost;
                dashDirection = wish.sqrMagnitude > 0.01f ? wish.normalized : forward;
            }

            if (dashTimer > 0f)
                horizontal = dashDirection * stats.dashSpeed;
            else if (grounded)
                horizontal = Vector3.MoveTowards(horizontal, wish * (stats.groundSpeed * slow), stats.groundAcceleration * dt);
            else
                horizontal = AirAccelerate(horizontal, wish, stats.groundSpeed, stats.airAcceleration * dt);

            float vertical = velocity.y;
            if (grounded)
            {
                stamina = Mathf.Min(stats.maxStamina, stamina + stats.groundStaminaRegenPerSecond * dt);
                vertical = input.jumpPressed ? Mathf.Sqrt(2f * gravity * stats.jumpHeight) : StickToGroundSpeed;
            }
            else
            {
                vertical -= gravity * dt;
            }

            velocity = horizontal + Vector3.up * vertical;
            var flags = body.Move(velocity * dt);
            AfterMove(flags, grounded);

            if (input.move.y > 0.5f && stamina > 0f && Time.time >= reclimbAllowedTime &&
                TryFindClimbable(forward, out var normal))
            {
                EnterClimb(normal);
                return;
            }

            if (input.primaryHeld && AnchorInRange != null && stamina >= stats.swingAttachStaminaCost)
            {
                EnterSwing(AnchorInRange);
                return;
            }

            if (input.primaryPressed)
                Swipe(forward);
        }

        /// <summary>Speeds up toward the wish direction without bleeding off swing or dash momentum.</summary>
        static Vector3 AirAccelerate(Vector3 horizontal, Vector3 wish, float maxSpeed, float maxDelta)
        {
            if (wish.sqrMagnitude < 0.0001f)
                return horizontal;
            Vector3 dir = wish.normalized;
            float add = maxSpeed * wish.magnitude - Vector3.Dot(horizontal, dir);
            return add > 0f ? horizontal + dir * Mathf.Min(add, maxDelta) : horizontal;
        }

        void AfterMove(CollisionFlags flags, bool wasGrounded)
        {
            if ((flags & CollisionFlags.Above) != 0 && velocity.y > 0f)
                velocity.y = 0f;
            if ((flags & CollisionFlags.Sides) != 0)
            {
                // Lose momentum into walls instead of sliding along them at swing speed forever.
                Vector3 actual = body.velocity;
                velocity.x = actual.x;
                velocity.z = actual.z;
            }

            if (!wasGrounded && body.isGrounded)
            {
                if (airborneFromSwing)
                    landingSlowTimer = stats.swingLandingSlowDuration;
                airborneFromSwing = false;
            }
        }

        // ---------------------------------------------------------------- Climbing

        bool TryFindClimbable(Vector3 direction, out Vector3 normal)
        {
            normal = Vector3.zero;
            float probeRadius = stats.radius * 0.6f;
            if (!Physics.SphereCast(Center, probeRadius, direction, out var hit, stats.radius * 0.4f + 0.5f, ~0,
                                    QueryTriggerInteraction.Ignore))
                return false;
            if (hit.collider.GetComponent<Climbable>() == null || Mathf.Abs(hit.normal.y) > 0.3f)
                return false;

            normal = new Vector3(hit.normal.x, 0f, hit.normal.z).normalized;
            return true;
        }

        void EnterClimb(Vector3 normal)
        {
            State = MoveState.Climbing;
            climbNormal = normal;
            velocity = Vector3.zero;
            dashTimer = 0f;
        }

        void UpdateClimbing(PlayerInput input, float dt)
        {
            stamina -= stats.climbStaminaDrainPerSecond * dt;
            if (stamina <= 0f)
            {
                stamina = 0f;
                ExitClimb(climbNormal * 2f);
                return;
            }

            if (input.jumpPressed)
            {
                ExitClimb(climbNormal * stats.climbJumpOffSpeed + Vector3.up * (stats.climbJumpOffSpeed * 0.8f));
                return;
            }

            Vector3 facing = -climbNormal;
            Vector3 right = Vector3.Cross(Vector3.up, facing);
            transform.rotation = Quaternion.LookRotation(facing);

            float up = input.move.y * stats.climbSpeed;
            Vector3 move = Vector3.up * up + right * (input.move.x * stats.climbSpeed * 0.6f) + facing * ClimbStickSpeed;
            velocity = Vector3.up * up;
            body.Move(move * dt);

            // A branch, crown or roof overhead: climb up onto it.
            if (up > 0f && IsBlockedAbove() && TryMantleNearby(facing))
                return;

            if (!TryFindClimbable(facing, out var normal))
            {
                // Climbed past the top of the surface: try to step onto it, else let go.
                if (up > 0f && TryMantleNearby(facing))
                    return;
                ExitClimb(Vector3.up * (up > 0f ? 3f : 0f));
                return;
            }
            climbNormal = normal;

            if (up < 0f && body.isGrounded)
                ExitClimb(Vector3.zero);
        }

        void ExitClimb(Vector3 launchVelocity)
        {
            State = MoveState.Locomotion;
            velocity = launchVelocity;
            reclimbAllowedTime = Time.time + ReclimbDelay;
        }

        bool IsBlockedAbove()
        {
            float probeRadius = stats.radius * 0.8f;
            float distance = stats.height * 0.5f - probeRadius + 0.3f;
            int count = Physics.SphereCastNonAlloc(Center, probeRadius, Vector3.up, rayHits, distance, ~0,
                                                   QueryTriggerInteraction.Ignore);
            for (int i = 0; i < count; i++)
                if (rayHits[i].collider != body && rayHits[i].distance > 0f)
                    return true;
            return false;
        }

        /// <summary>Tries ledges directly overhead (branch, crown), then over the climbed surface (wall top, roof).</summary>
        bool TryMantleNearby(Vector3 facing)
        {
            return TryMantle(transform.position)
                || TryMantle(transform.position + facing * (stats.radius + 0.6f))
                || TryMantle(transform.position + facing * (stats.radius + 1.5f));
        }

        /// <summary>Finds a flat ledge above the gorilla near <paramref name="probe"/> and starts a mantle onto it.</summary>
        bool TryMantle(Vector3 probe)
        {
            float top = transform.position.y + stats.height + 3f;
            var from = new Vector3(probe.x, top, probe.z);
            if (!RaycastIgnoringSelf(from, Vector3.down, stats.height + 4f, out var hit) || hit.normal.y < 0.7f)
                return false;

            Vector3 target = hit.point + Vector3.up * 0.05f;
            if (target.y < transform.position.y + 0.5f || !IsSpaceFree(target))
                return false;

            State = MoveState.Mantling;
            mantleStart = transform.position;
            mantleEnd = target;
            mantleProgress = 0f;
            velocity = Vector3.zero;
            body.enabled = false;
            return true;
        }

        void UpdateMantling(float dt)
        {
            mantleProgress += dt / Mathf.Max(0.01f, stats.mantleDuration);
            float t = Mathf.Clamp01(mantleProgress);
            // Rise first, then move over the ledge, so the body clears the edge.
            Vector3 position = new Vector3(
                Mathf.Lerp(mantleStart.x, mantleEnd.x, t * t),
                Mathf.Lerp(mantleStart.y, mantleEnd.y, Mathf.Sqrt(t)),
                Mathf.Lerp(mantleStart.z, mantleEnd.z, t * t));
            transform.position = position;

            if (t >= 1f)
            {
                body.enabled = true;
                State = MoveState.Locomotion;
            }
        }

        bool RaycastIgnoringSelf(Vector3 origin, Vector3 direction, float distance, out RaycastHit closest)
        {
            closest = default;
            bool found = false;
            int count = Physics.RaycastNonAlloc(origin, direction, rayHits, distance, ~0, QueryTriggerInteraction.Ignore);
            for (int i = 0; i < count; i++)
            {
                if (rayHits[i].collider == body)
                    continue;
                if (!found || rayHits[i].distance < closest.distance)
                {
                    closest = rayHits[i];
                    found = true;
                }
            }
            return found;
        }

        bool IsSpaceFree(Vector3 feet)
        {
            float r = stats.radius * 0.95f;
            int count = Physics.OverlapCapsuleNonAlloc(feet + Vector3.up * (stats.radius + 0.05f),
                                                       feet + Vector3.up * (stats.height - stats.radius),
                                                       r, overlapHits, ~0, QueryTriggerInteraction.Ignore);
            for (int i = 0; i < count; i++)
                if (overlapHits[i] != body)
                    return false;
            return true;
        }

        // ---------------------------------------------------------------- Swinging

        void EnterSwing(SwingAnchor anchor)
        {
            State = MoveState.Swinging;
            swingAnchor = anchor;
            ropeLength = Mathf.Max(stats.swingMinRopeLength, Vector3.Distance(Center, anchor.Point));
            stamina -= stats.swingAttachStaminaCost;
            dashTimer = 0f;
        }

        void UpdateSwinging(PlayerInput input, float dt)
        {
            if (!input.primaryHeld)
            {
                ReleaseSwing();
                return;
            }

            Vector3 forward = Forward;
            Vector3 right = Vector3.Cross(Vector3.up, forward);
            transform.rotation = Quaternion.LookRotation(forward);

            Vector3 anchor = swingAnchor.Point;
            Vector3 center = Center;
            Vector3 ropeDir = (center - anchor).normalized;

            // Gravity plus a pump along the rope's tangent plane, then the rope constraint.
            velocity += Vector3.down * (gravity * dt);
            Vector3 wish = forward * input.move.y + right * input.move.x;
            velocity += Vector3.ProjectOnPlane(wish, ropeDir) * (stats.swingPumpAcceleration * dt);

            Vector3 next = center + velocity * dt;
            Vector3 offset = next - anchor;
            if (offset.magnitude > ropeLength)
                next = anchor + offset.normalized * ropeLength;

            Vector3 delta = next - center;
            velocity = Vector3.ClampMagnitude(delta / dt, stats.swingMaxSpeed);
            body.Move(delta);

            if (body.isGrounded)
            {
                ReleaseSwing();
                airborneFromSwing = false;
            }
        }

        void ReleaseSwing()
        {
            lastReleasedAnchor = swingAnchor;
            lastReleaseTime = Time.time;
            swingAnchor = null;
            airborneFromSwing = true;
            State = MoveState.Locomotion;
        }

        // ---------------------------------------------------------------- Swipe

        void Swipe(Vector3 forward)
        {
            if (swipeCooldownTimer > 0f)
                return;
            swipeCooldownTimer = stats.swipeCooldown;
            LastSwipeTime = Time.time;

            float reach = stats.swipeRange * 0.6f;
            Vector3 point = Center + forward * reach;
            Vector3 knockback = (forward + Vector3.up * 0.35f).normalized * stats.swipeKnockback;

            swipeVictims.Clear();
            int count = Physics.OverlapSphereNonAlloc(point, reach, overlapHits, ~0, QueryTriggerInteraction.Ignore);
            for (int i = 0; i < count; i++)
            {
                var health = overlapHits[i].GetComponentInParent<Health>();
                if (health == null || health.transform == transform || !swipeVictims.Add(health))
                    continue;
                health.TakeDamage(stats.swipeDamage, knockback);
            }
        }

        // ---------------------------------------------------------------- Sedation

        void OnCollapsed()
        {
            if (State == MoveState.Swinging)
                ReleaseSwing();
            if (State == MoveState.Mantling)
                body.enabled = true;
            State = MoveState.Collapsed;
            velocity = new Vector3(0f, Mathf.Min(0f, velocity.y), 0f);
            if (visual != null)
            {
                visual.localRotation = Quaternion.Euler(0f, 0f, 90f);
                visual.localPosition = Vector3.up * 0.9f;
            }
        }

        void OnWoke()
        {
            State = MoveState.Locomotion;
            if (visual != null)
            {
                visual.localRotation = Quaternion.identity;
                visual.localPosition = Vector3.zero;
            }
        }

        void UpdateCollapsed(float dt)
        {
            // Placeholder for the ragdoll: lie still under gravity. Dragging arrives in week 2.
            velocity.x = 0f;
            velocity.z = 0f;
            velocity.y = body.isGrounded ? StickToGroundSpeed : velocity.y - gravity * dt;
            body.Move(velocity * dt);
        }

        void SetPosition(Vector3 position)
        {
            body.enabled = false;
            transform.position = position;
            body.enabled = true;
        }
    }
}
