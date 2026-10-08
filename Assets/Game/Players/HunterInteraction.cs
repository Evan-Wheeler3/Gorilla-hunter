using PrimalRaid.Config;
using PrimalRaid.Core;
using UnityEngine;

namespace PrimalRaid.Players
{
    /// <summary>
    /// The hunter's E key on downed gorillas: tap to grab and drag the body (tap again to drop),
    /// hold to tie it up (extends the knockout). Dragging blocks firing; the body follows behind.
    /// </summary>
    internal sealed class HunterInteraction
    {
        const float TapMaxSeconds = 0.3f;
        const float Reach = 2.8f;

        static readonly Collider[] hits = new Collider[16];

        readonly HunterController owner;
        readonly SedationStats sedation;
        float holdTime;
        bool holding;

        public HunterInteraction(HunterController owner)
        {
            this.owner = owner;
            sedation = GameConfig.Active.sedation;
        }

        /// <summary>Nearest downed, undragged gorilla within reach (what E would act on).</summary>
        public GorillaController Target { get; private set; }
        public GorillaController Dragging { get; private set; }

        /// <summary>0 to 1 while E is held on a gorilla that can still be tied up.</summary>
        public float BindProgress =>
            holding && Target != null && Target.Sedation.Meter.State == SedationState.Collapsed
                ? Mathf.Clamp01(holdTime / sedation.bindSeconds)
                : 0f;

        public void Tick(PlayerInput input, float dt)
        {
            if (Dragging != null)
            {
                Target = null;
                if (input.interactPressed || !Dragging.Sedation.Meter.IsDown)
                    Release();
                return;
            }

            Target = FindDownedGorilla();
            if (Target == null)
            {
                holding = false;
                return;
            }

            if (input.interactPressed)
            {
                holding = true;
                holdTime = 0f;
            }
            if (!holding)
                return;

            if (input.interactHeld)
            {
                holdTime += dt;
                if (holdTime >= sedation.bindSeconds && Target.Sedation.Meter.Bind())
                    holding = false;
                return;
            }

            // Released: a quick tap grabs the body.
            holding = false;
            if (holdTime <= TapMaxSeconds && Target.TryBeginDrag(owner))
                Dragging = Target;
        }

        /// <summary>Drop the body (E again, death, or the body being removed).</summary>
        public void Release()
        {
            if (Dragging != null)
                Dragging.EndDrag(owner);
            Dragging = null;
            holding = false;
        }

        /// <summary>The gorilla already ended the drag itself (it woke up).</summary>
        public void Clear()
        {
            Dragging = null;
            holding = false;
        }

        GorillaController FindDownedGorilla()
        {
            Vector3 origin = owner.transform.position + Vector3.up;
            int count = Physics.OverlapSphereNonAlloc(origin, Reach, hits, ~0, QueryTriggerInteraction.Ignore);
            GorillaController best = null;
            float bestSqr = float.MaxValue;
            for (int i = 0; i < count; i++)
            {
                var gorilla = hits[i].GetComponentInParent<GorillaController>();
                if (gorilla == null || !gorilla.Sedation.Meter.IsDown || gorilla.IsBeingDragged)
                    continue;
                float sqr = (gorilla.transform.position - owner.transform.position).sqrMagnitude;
                if (sqr < bestSqr)
                {
                    bestSqr = sqr;
                    best = gorilla;
                }
            }
            return best;
        }
    }
}
