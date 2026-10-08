using PrimalRaid.Config;
using UnityEngine;

namespace PrimalRaid.DevTools
{
    /// <summary>
    /// F3 debug window (design doc section 9 testing hooks). Covers what exists so far:
    /// possession, sedation, stamina, revive, teleports and slow motion. Finisher forcing,
    /// fire triggering and bot matches are added with those systems.
    /// </summary>
    public sealed class DebugMenu : MonoBehaviour
    {
        GreyboxBootstrap bootstrap;
        Rect window = new Rect(20, 60, 300, 520);

        public bool IsOpen { get; private set; }

        public void Bind(GreyboxBootstrap owner) => bootstrap = owner;

        void Update()
        {
            if (!Input.GetKeyDown(KeyCode.F3))
                return;
            IsOpen = !IsOpen;
            GreyboxBootstrap.SetCursorLocked(!IsOpen);
        }

        void OnDisable() => Time.timeScale = 1f;

        void OnGUI()
        {
            if (IsOpen && bootstrap != null)
                window = GUI.Window(GetInstanceID(), window, DrawWindow, "Primal Raid debug (F3)");
        }

        void DrawWindow(int id)
        {
            var gorilla = bootstrap.Gorilla;
            var hunter = bootstrap.Hunter;
            var meter = gorilla.Sedation.Meter;

            GUILayout.Label($"Controlling: {bootstrap.Current?.DisplayName}");
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Gorilla (F1)")) bootstrap.Possess(gorilla);
            if (GUILayout.Button("Hunter (F2)")) bootstrap.Possess(hunter);
            GUILayout.EndHorizontal();

            GUILayout.Space(6);
            GUILayout.Label($"Gorilla: {gorilla.State}, stamina {gorilla.Stamina:0}");
            GUILayout.Label($"Sedation {meter.Value:0.0} ({meter.State}, down {meter.RemainingDowntime:0.0}s)");
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("+1 dart")) gorilla.Sedation.ApplyDart();
            if (GUILayout.Button("Set 0")) gorilla.Sedation.DebugSet(0f);
            if (GUILayout.Button("Set 90")) gorilla.Sedation.DebugSet(90f);
            GUILayout.EndHorizontal();
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Collapse")) gorilla.Sedation.DebugSet(GameConfig.Active.sedation.maxSedation);
            if (GUILayout.Button("Wake")) gorilla.Sedation.DebugWake();
            if (GUILayout.Button("Bind")) meter.Bind();
            GUILayout.EndHorizontal();
            if (GUILayout.Button("Refill gorilla stamina")) gorilla.RefillStamina();
            var buddy = bootstrap.Teammate.Sedation;
            GUILayout.Label($"Teammate: {buddy.Meter.State}, down {buddy.Meter.RemainingDowntime:0.0}s");
            if (GUILayout.Button("Knock out teammate (then swipe him)")) buddy.ApplyDart();

            GUILayout.Space(6);
            GUILayout.Label($"Hunter: health {hunter.Health.Current:0}, {(hunter.IsDead ? "dead" : "alive")}");
            if (GUILayout.Button("Revive hunter")) hunter.Revive();

            GUILayout.Space(6);
            if (GUILayout.Button("Reset both to test spawns")) bootstrap.ResetPositions();
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Gorilla to nest")) gorilla.Teleport(bootstrap.Island.gorillaNestSpawn);
            if (GUILayout.Button("Hunter to camp")) hunter.Teleport(bootstrap.Island.hunterCampSpawn);
            GUILayout.EndHorizontal();
            if (GUILayout.Button("Hunter in front of gorilla"))
                hunter.Teleport(gorilla.transform.position + gorilla.transform.forward * 12f);

            GUILayout.Space(6);
            GUILayout.Label($"Time scale {Time.timeScale:0.00}");
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("1x")) Time.timeScale = 1f;
            if (GUILayout.Button("0.5x")) Time.timeScale = 0.5f;
            if (GUILayout.Button("0.25x")) Time.timeScale = 0.25f;
            GUILayout.EndHorizontal();

            GUI.DragWindow();
        }
    }
}
