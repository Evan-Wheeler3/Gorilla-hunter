using UnityEngine;

namespace PrimalRaid.Players
{
    /// <summary>
    /// One frame of player intent. Controllers consume this instead of reading devices, so the
    /// same struct can later come from the network (clients send inputs, never outcomes) or a bot.
    /// </summary>
    public struct PlayerInput
    {
        public Vector2 move;          // x = strafe, y = forward
        public Vector2 look;          // mouse delta, already scaled by sensitivity
        public bool jumpPressed;
        public bool sprintHeld;       // hunter sprint
        public bool dashPressed;      // gorilla dash (same key as sprint)
        public bool primaryPressed;
        public bool primaryHeld;
        public bool secondaryHeld;
        public bool interactHeld;
        public bool reloadPressed;
        public bool abilityPressed;   // gorilla chest beat (Q)

        public static readonly PlayerInput None = default;
    }

    /// <summary>
    /// Reads keyboard and mouse through the legacy Input Manager (doc section 4 and 5 bindings).
    /// Requires Player Settings > Active Input Handling to be "Input Manager (Old)" or "Both".
    /// </summary>
    public static class KeyboardMouseInput
    {
        public static PlayerInput Read(float sensitivity)
        {
            if (Cursor.lockState != CursorLockMode.Locked)
                return PlayerInput.None;

            var move = Vector2.zero;
            if (Input.GetKey(KeyCode.W)) move.y += 1f;
            if (Input.GetKey(KeyCode.S)) move.y -= 1f;
            if (Input.GetKey(KeyCode.D)) move.x += 1f;
            if (Input.GetKey(KeyCode.A)) move.x -= 1f;

            return new PlayerInput
            {
                move = Vector2.ClampMagnitude(move, 1f),
                look = new Vector2(Input.GetAxisRaw("Mouse X"), Input.GetAxisRaw("Mouse Y")) * sensitivity,
                jumpPressed = Input.GetKeyDown(KeyCode.Space),
                sprintHeld = Input.GetKey(KeyCode.LeftShift),
                dashPressed = Input.GetKeyDown(KeyCode.LeftShift),
                primaryPressed = Input.GetMouseButtonDown(0),
                primaryHeld = Input.GetMouseButton(0),
                secondaryHeld = Input.GetMouseButton(1),
                interactHeld = Input.GetKey(KeyCode.E),
                reloadPressed = Input.GetKeyDown(KeyCode.R),
                abilityPressed = Input.GetKeyDown(KeyCode.Q),
            };
        }
    }

    /// <summary>A character the local player can possess (debug switching, later spectating).</summary>
    public interface IControllable
    {
        string DisplayName { get; }
        bool HasControl { get; }
        void SetControl(bool hasControl);
        Camera ViewCamera { get; }
    }
}
