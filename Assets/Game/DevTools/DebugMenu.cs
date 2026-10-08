using System.Linq;
using PrimalRaid.Config;
using PrimalRaid.Players;
using UnityEngine;

namespace PrimalRaid.DevTools
{
    /// <summary>
    /// F3 debug window (design doc section 9 testing hooks): round control, possession,
    /// sedation, stamina, teleports and slow motion. Finisher forcing, fire triggering and
    /// bot matches are added with those systems.
    /// </summary>
    public sealed class DebugMenu : MonoBehaviour
    {
        GreyboxBootstrap bootstrap;
        Rect window = new Rect(20, 50, 320, 560);

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
            if (IsOpen && bootstrap != null && bootstrap.Match != null && bootstrap.Match.Round != null)
                window = GUI.Window(GetInstanceID(), window, DrawWindow, "Primal Raid debug (F3)");
        }

        void DrawWindow(int id)
        {
            var match = bootstrap.Match;
            var round = match.Round;
            var setup = match.CurrentSetup;

            GUILayout.Label($"Round: {round.Phase}, {round.TimeRemaining:0}s left, lives {round.LivesRemaining}");
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("New round (F5)")) match.BeginRound();
            if (GUILayout.Button("Jump to 0:30 left")) round.Tick(Mathf.Max(0f, round.TimeRemaining - 30f));
            GUILayout.EndHorizontal();
            GUILayout.BeginHorizontal();
            GUILayout.Label($"Gorillas {setup.gorillas}", GUILayout.Width(90));
            if (GUILayout.Button("-")) setup.gorillas = Mathf.Max(1, setup.gorillas - 1);
            if (GUILayout.Button("+")) setup.gorillas = Mathf.Min(11, setup.gorillas + 1);
            GUILayout.Label($"Hunters {setup.hunters}", GUILayout.Width(80));
            if (GUILayout.Button("-")) setup.hunters = Mathf.Max(1, setup.hunters - 1);
            if (GUILayout.Button("+")) setup.hunters = Mathf.Min(6, setup.hunters + 1);
            GUILayout.EndHorizontal();
            setup.startAsHunter = GUILayout.Toggle(setup.startAsHunter, "Start next round as hunter");
            setup.spawnNearTestArea = GUILayout.Toggle(setup.spawnNearTestArea, "Spawn near test area (off: nest and camp)");
            setup.quickStart = GUILayout.Toggle(setup.quickStart, "Skip briefing and head start");

            GUILayout.Space(6);
            GUILayout.Label($"Controlling: {(match.Controlled as Component)?.name}");
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Next gorilla (F1)")) match.PossessNextGorilla();
            if (GUILayout.Button("Next hunter (F2)")) match.PossessNextHunter();
            GUILayout.EndHorizontal();

            var gorillas = match.Gorillas.ToList();
            GUILayout.Space(6);
            if (GUILayout.Button("Knock out every gorilla I'm not playing"))
                foreach (var g in gorillas)
                    if (!g.HasControl)
                        g.Sedation.ApplyDart();
            if (GUILayout.Button("Wake every gorilla"))
                foreach (var g in gorillas)
                    g.Sedation.DebugWake();
            if (GUILayout.Button("Bring every other character in front of me"))
                BringOthersToMe(match);

            if (match.Controlled is GorillaController me)
            {
                GUILayout.Label($"Me: {me.State}, stamina {me.Stamina:0}, sedation {me.Sedation.Meter.Value:0}");
                GUILayout.BeginHorizontal();
                if (GUILayout.Button("Dart me")) me.Sedation.ApplyDart();
                if (GUILayout.Button("Wake me")) me.Sedation.DebugWake();
                if (GUILayout.Button("Refill stamina")) me.RefillStamina();
                GUILayout.EndHorizontal();
                if (GUILayout.Button("Toggle rage")) me.SetRage(!me.RageActive);
            }
            else if (match.Controlled is HunterController hunter)
            {
                GUILayout.Label($"Me: {(hunter.IsDead ? "dead" : "alive")}, dragging {(hunter.Dragging != null ? hunter.Dragging.name : "nothing")}");
                if (GUILayout.Button("Teleport me next to the east boat"))
                    hunter.Teleport(match.Island.boatZones[0] + new Vector3(-12f, 0.5f, 0f));
            }

            GUILayout.Space(6);
            GUILayout.Label($"Time scale {Time.timeScale:0.00}");
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("1x")) Time.timeScale = 1f;
            if (GUILayout.Button("0.5x")) Time.timeScale = 0.5f;
            if (GUILayout.Button("0.25x")) Time.timeScale = 0.25f;
            GUILayout.EndHorizontal();

            GUI.DragWindow();
        }

        static void BringOthersToMe(PrimalRaid.Match.MatchManager match)
        {
            if (!(match.Controlled is Component me))
                return;
            Vector3 front = me.transform.position + me.transform.forward * 8f;
            int i = 0;
            foreach (var g in match.Gorillas)
                if (!g.HasControl)
                    g.Teleport(front + me.transform.right * (5f * i++ - 5f) + Vector3.up * 0.5f);
            foreach (var h in match.Hunters)
                if (!h.HasControl)
                    h.Teleport(front + me.transform.right * (3f * i++ - 5f) + Vector3.up * 0.5f);
        }
    }
}
