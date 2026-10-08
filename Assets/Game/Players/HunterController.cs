using PrimalRaid.Combat;
using PrimalRaid.Config;
using PrimalRaid.Core;
using UnityEngine;
using UnityEngine.Rendering;

namespace PrimalRaid.Players
{
    /// <summary>
    /// Hunter movement and the tranq rifle (design doc section 5): walk, limited sprint, jump,
    /// first-person look, aim down sights, and a one-dart magazine with a long reload.
    /// Pistol, traps, flare, tripwire, bind and drag arrive in week 2.
    /// </summary>
    [RequireComponent(typeof(CharacterController), typeof(Health))]
    public sealed class HunterController : MonoBehaviour, IControllable, IKnockbackReceiver
    {
        const float StickToGroundSpeed = -2f;
        const float MaxPitch = 85f;
        const float FlinchPitch = 6f;
        const float FovLerpSpeed = 12f;
        const float MuzzleForwardOffset = 0.4f;

        CharacterController body;
        Health health;
        HunterStats stats;
        float gravity;
        float sensitivity;

        Transform visual;
        Camera viewCamera;

        Vector3 velocity;
        Vector3 knockback;
        float yaw;
        float pitch;
        float sprintStamina;
        int loadedDarts;
        float reloadTimer;

        public float SprintNormalized => sprintStamina / stats.sprintStaminaSeconds;
        public int LoadedDarts => loadedDarts;
        public bool IsReloading => reloadTimer > 0f;
        public float ReloadProgress => IsReloading ? 1f - reloadTimer / stats.rifleReloadSeconds : 1f;
        public bool IsAiming { get; private set; }
        public bool IsSprinting { get; private set; }
        public bool IsDead => health.IsDead;
        public Health Health => health;
        public Vector3 Velocity => body.velocity;

        public string DisplayName => "Hunter";
        public bool HasControl { get; private set; }
        public Camera ViewCamera => viewCamera;

        void Awake()
        {
            var config = GameConfig.Active;
            stats = config.hunter;
            gravity = config.world.gravity;
            sensitivity = config.controls.mouseSensitivity;

            body = GetComponent<CharacterController>();
            body.height = stats.height;
            body.radius = stats.radius;
            body.center = Vector3.up * (stats.height * 0.5f);
            body.stepOffset = 0.35f;

            health = GetComponent<Health>();
            health.Initialize(stats.maxHealth);
            health.Died += _ => OnDied();

            sprintStamina = stats.sprintStaminaSeconds;
            loadedDarts = stats.rifleMagazine;
            yaw = transform.eulerAngles.y;
        }

        /// <summary>Wires the body visual and the first-person camera (a child at eye height).</summary>
        public void Setup(Transform visualRoot, Camera eyeCamera)
        {
            visual = visualRoot;
            viewCamera = eyeCamera;
            viewCamera.fieldOfView = stats.hipFieldOfView;
            ApplyBodyVisibility();
        }

        public void SetControl(bool hasControl)
        {
            HasControl = hasControl;
            if (viewCamera != null)
                viewCamera.gameObject.SetActive(hasControl);
            ApplyBodyVisibility();
        }

        public void Revive()
        {
            health.Revive();
            if (visual != null)
                visual.localRotation = Quaternion.identity;
        }

        public void Teleport(Vector3 position)
        {
            velocity = Vector3.zero;
            knockback = Vector3.zero;
            body.enabled = false;
            transform.position = position;
            body.enabled = true;
        }

        public void ApplyKnockback(Vector3 impulse)
        {
            knockback += new Vector3(impulse.x, 0f, impulse.z);
            velocity.y = Mathf.Max(velocity.y, impulse.y);
            pitch = Mathf.Clamp(pitch - FlinchPitch, -MaxPitch, MaxPitch); // flinch
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (dt <= 0f)
                return;

            var input = HasControl && !IsDead ? KeyboardMouseInput.Read(sensitivity) : PlayerInput.None;

            if (!IsDead)
                UpdateLook(input, dt);
            UpdateMovement(input, dt);
            if (!IsDead)
                UpdateRifle(input, dt);
        }

        void UpdateLook(PlayerInput input, float dt)
        {
            yaw += input.look.x;
            pitch = Mathf.Clamp(pitch - input.look.y, -MaxPitch, MaxPitch);
            transform.rotation = Quaternion.Euler(0f, yaw, 0f);

            IsAiming = input.secondaryHeld;
            if (viewCamera != null)
            {
                viewCamera.transform.localRotation = Quaternion.Euler(pitch, 0f, 0f);
                float targetFov = IsAiming ? stats.adsFieldOfView : stats.hipFieldOfView;
                viewCamera.fieldOfView = Mathf.Lerp(viewCamera.fieldOfView, targetFov, 1f - Mathf.Exp(-FovLerpSpeed * dt));
            }
        }

        void UpdateMovement(PlayerInput input, float dt)
        {
            Vector3 forward = transform.forward;
            Vector3 right = transform.right;
            Vector3 wish = forward * input.move.y + right * input.move.x;
            bool grounded = body.isGrounded;

            IsSprinting = input.sprintHeld && input.move.y > 0.1f && sprintStamina > 0f && !IsAiming;
            sprintStamina = IsSprinting
                ? Mathf.Max(0f, sprintStamina - dt)
                : Mathf.Min(stats.sprintStaminaSeconds, sprintStamina + stats.sprintRechargePerSecond * dt);
            float speed = IsSprinting ? stats.sprintSpeed : stats.walkSpeed;

            Vector3 horizontal = new Vector3(velocity.x, 0f, velocity.z);
            float accel = grounded ? stats.groundAcceleration : stats.airAcceleration;
            horizontal = Vector3.MoveTowards(horizontal, wish * speed, accel * dt);

            float vertical = velocity.y;
            if (grounded && vertical <= 0f)
                vertical = input.jumpPressed ? Mathf.Sqrt(2f * gravity * stats.jumpHeight) : StickToGroundSpeed;
            else
                vertical -= gravity * dt;

            velocity = horizontal + Vector3.up * vertical;
            knockback *= Mathf.Exp(-stats.knockbackDamping * dt);

            var flags = body.Move((velocity + knockback) * dt);
            if ((flags & CollisionFlags.Above) != 0 && velocity.y > 0f)
                velocity.y = 0f;
        }

        void UpdateRifle(PlayerInput input, float dt)
        {
            if (reloadTimer > 0f)
            {
                reloadTimer -= dt;
                if (reloadTimer <= 0f)
                {
                    reloadTimer = 0f;
                    loadedDarts = stats.rifleMagazine;
                }
                return;
            }

            if (input.reloadPressed && loadedDarts < stats.rifleMagazine)
            {
                reloadTimer = stats.rifleReloadSeconds;
                return;
            }

            if (input.primaryPressed && loadedDarts > 0 && viewCamera != null)
            {
                var muzzle = viewCamera.transform;
                TranqDart.Fire(muzzle.position + muzzle.forward * MuzzleForwardOffset, muzzle.forward, transform);
                loadedDarts--;
                if (loadedDarts == 0 && stats.rifleAutoReload)
                    reloadTimer = stats.rifleReloadSeconds;
            }
        }

        void OnDied()
        {
            reloadTimer = 0f;
            IsAiming = false;
            IsSprinting = false;
            if (visual != null)
                visual.localRotation = Quaternion.Euler(-80f, 0f, 0f); // placeholder for the finisher/ragdoll
        }

        /// <summary>Own body casts shadows only in first person so it does not block the view.</summary>
        void ApplyBodyVisibility()
        {
            if (visual == null)
                return;
            var mode = HasControl ? ShadowCastingMode.ShadowsOnly : ShadowCastingMode.On;
            foreach (var r in visual.GetComponentsInChildren<Renderer>())
                r.shadowCastingMode = mode;
        }
    }
}
