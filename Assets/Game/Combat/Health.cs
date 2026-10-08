using System;
using UnityEngine;

namespace PrimalRaid.Combat
{
    /// <summary>Implemented by characters that can be shoved by hits (gorilla swipe).</summary>
    public interface IKnockbackReceiver
    {
        void ApplyKnockback(Vector3 velocity);
    }

    /// <summary>Hunter hit points. Gorillas have no health; they use <see cref="SedationTarget"/>.</summary>
    public sealed class Health : MonoBehaviour
    {
        [SerializeField] float maxHealth = 100f;

        public float Current { get; private set; }
        public float Max => maxHealth;
        public bool IsDead => Current <= 0f;

        public event Action<Health> Died;

        void Awake() => Current = maxHealth;

        public void Initialize(float max)
        {
            maxHealth = max;
            Current = max;
        }

        public void TakeDamage(float amount, Vector3 knockback)
        {
            if (IsDead || amount <= 0f)
                return;

            Current = Mathf.Max(0f, Current - amount);
            if (knockback != Vector3.zero && TryGetComponent<IKnockbackReceiver>(out var receiver))
                receiver.ApplyKnockback(knockback);
            if (IsDead)
                Died?.Invoke(this);
        }

        public void Revive() => Current = maxHealth;
    }
}
