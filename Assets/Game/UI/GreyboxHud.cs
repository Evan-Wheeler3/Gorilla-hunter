using PrimalRaid.Core;
using PrimalRaid.Match;
using PrimalRaid.Players;
using UnityEngine;

namespace PrimalRaid.UI
{
    /// <summary>
    /// Placeholder IMGUI HUD for the greybox (design doc section 8 lists the real HUD).
    /// Round bar (phase, clock, lives, gorillas left) and announcements for everyone; stamina,
    /// swing marker and sedation vignette for gorillas; crosshair, reload, drag/tie-up prompts
    /// and respawn countdown for hunters; knockout timers over downed gorillas.
    /// </summary>
    public sealed class GreyboxHud : MonoBehaviour
    {
        const float SedationBarShowSeconds = 10f;

        static readonly Color BarBack = new Color(0f, 0f, 0f, 0.55f);
        static readonly Color StaminaColor = new Color(0.95f, 0.8f, 0.25f);
        static readonly Color SedationColor = new Color(0.95f, 0.25f, 0.65f);
        static readonly Color ReloadColor = new Color(0.4f, 0.85f, 1f);
        static readonly Color BindColor = new Color(1f, 0.6f, 0.2f);
        static readonly Color RageColor = new Color(1f, 0.2f, 0.15f);

        MatchManager match;
        GUIStyle label;
        GUIStyle bigLabel;
        GUIStyle centered;

        public void Bind(MatchManager matchManager) => match = matchManager;

        void OnGUI()
        {
            if (match == null || match.Round == null)
                return;
            EnsureStyles();

            DrawRoundBar();
            if (match.Controlled is GorillaController gorilla && gorilla != null)
                DrawGorillaHud(gorilla);
            else if (match.Controlled is HunterController hunter && hunter != null)
                DrawHunterHud(hunter);

            if (match.HasAnnouncement)
                GUI.Label(new Rect(0, Screen.height * 0.22f, Screen.width, 40), match.Announcement, bigLabel);

            GUI.Label(new Rect(12, Screen.height - 26, 1200, 24),
                      "F1 next gorilla  F2 next hunter  F3 debug  F5 new round  Esc release mouse", label);
        }

        void DrawRoundBar()
        {
            var round = match.Round;
            float t = round.Phase == RoundPhase.Briefing ? round.BriefingRemaining : round.TimeRemaining;
            string clock = $"{(int)t / 60}:{(int)t % 60:00}";
            string text = $"{round.Phase}  {clock}    Gorillas left {round.Gorillas.Count}    " +
                          $"Hunters {round.AliveHunters.Count}    Hunter lives {round.LivesRemaining}";
            Fill(new Rect(Screen.width * 0.5f - 300, 6, 600, 28), BarBack);
            GUI.Label(new Rect(Screen.width * 0.5f - 300, 8, 600, 24), text, centered);
        }

        // ---------------------------------------------------------------- Gorilla

        void DrawGorillaHud(GorillaController gorilla)
        {
            var meter = gorilla.Sedation.Meter;

            // Sedation vignette: screen edges close in as sedation rises.
            float vignette = meter.IsDown ? 0.75f : meter.Normalized * 0.6f;
            if (vignette > 0.01f)
            {
                float edge = Screen.height * 0.18f;
                var tint = new Color(0.25f, 0f, 0.2f, vignette);
                Fill(new Rect(0, 0, Screen.width, edge), tint);
                Fill(new Rect(0, Screen.height - edge, Screen.width, edge), tint);
                Fill(new Rect(0, edge, edge, Screen.height - 2 * edge), tint);
                Fill(new Rect(Screen.width - edge, edge, edge, Screen.height - 2 * edge), tint);
            }

            float w = 320f;
            float x = (Screen.width - w) * 0.5f;
            float y = Screen.height - 70f;
            Bar(new Rect(x, y, w, 16), gorilla.StaminaNormalized, gorilla.RageActive ? RageColor : StaminaColor);
            GUI.Label(new Rect(x, y - 22, w, 20),
                      gorilla.RageActive ? "RAGE: no stamina costs, fast swipes" : $"Stamina {gorilla.Stamina:0}", label);

            var v = gorilla.Velocity;
            float speed = new Vector2(v.x, v.z).magnitude;
            string extra = gorilla.IsLandingSlowed ? "  (landing slow)" : "";
            if (gorilla.IsHeld)
                extra += "  (held in the nest)";
            GUI.Label(new Rect(12, 40, 600, 24), $"{gorilla.State}  {speed:0.0} m/s{extra}", label);

            if (meter.IsDown)
            {
                string dragged = gorilla.IsBeingDragged ? " - being dragged!" : "";
                CenterText($"KNOCKED OUT ({meter.State}) - waking in {meter.RemainingDowntime:0}s{dragged}");
            }
            else if (Time.time - gorilla.LastSwipeTime < 0.15f)
            {
                CenterText("SWIPE");
            }

            var cam = gorilla.ViewCamera;
            if (cam == null)
                return;
            foreach (var other in match.Gorillas)
                if (other != gorilla && other.Sedation.Meter.IsDown)
                    DrawOverhead(cam, other, $"DOWN {other.Sedation.Meter.RemainingDowntime:0}s - swipe to slap awake");

            var anchor = gorilla.AnchorInRange;
            if (anchor != null && gorilla.State != GorillaController.MoveState.Swinging)
            {
                Vector3 screen = cam.WorldToScreenPoint(anchor.Point);
                if (screen.z > 0f)
                    GUI.Label(new Rect(screen.x - 40, Screen.height - screen.y - 30, 120, 24), "[hold LMB]", bigLabel);
            }
        }

        // ---------------------------------------------------------------- Hunter

        void DrawHunterHud(HunterController hunter)
        {
            float cx = Screen.width * 0.5f;
            float cy = Screen.height * 0.5f;

            if (hunter.IsDead)
            {
                int id = match.IdOf(hunter);
                CenterText(match.Round.IsRespawning(id)
                    ? $"Torn apart! Respawning in {match.Round.RespawnRemaining(id):0.0}s"
                    : "Torn apart! No hunter lives left.");
                return;
            }

            Fill(new Rect(cx - 8, cy - 1, 16, 2), Color.white);
            Fill(new Rect(cx - 1, cy - 8, 2, 16), Color.white);
            if (hunter.IsReloading)
                Bar(new Rect(cx - 30, cy + 14, 60, 5), hunter.ReloadProgress, ReloadColor);

            if (hunter.IsStunned)
                CenterText("THROWN OFF! The gorilla woke up");
            else if (hunter.IsHeld)
                CenterText("Briefing - hold at camp");

            // Interaction prompt and tie-up progress.
            if (hunter.Dragging != null)
            {
                var meter = hunter.Dragging.Sedation.Meter;
                GUI.Label(new Rect(cx - 250, cy + 40, 500, 24),
                          $"Dragging - get to a boat beam! Wakes in {meter.RemainingDowntime:0}s  [E] drop", centered);
            }
            else if (hunter.InteractTarget != null)
            {
                var meter = hunter.InteractTarget.Sedation.Meter;
                string bind = meter.State == SedationState.Collapsed ? "   hold [E] tie up" : "   (tied up)";
                GUI.Label(new Rect(cx - 200, cy + 40, 400, 24), $"tap [E] drag{bind}", centered);
                if (hunter.BindProgress > 0f)
                    Bar(new Rect(cx - 60, cy + 66, 120, 8), hunter.BindProgress, BindColor);
            }

            float x = 20f;
            float y = Screen.height - 80f;
            string darts = hunter.Dragging != null ? "hands full" :
                           hunter.IsReloading ? "reloading" :
                           hunter.LoadedDarts > 0 ? "dart loaded" : "empty - press R";
            GUI.Label(new Rect(x, y, 400, 24), $"Tranq rifle: {darts}", label);
            if (!hunter.HasUnlimitedSprint)
            {
                GUI.Label(new Rect(x, y + 24, 200, 24), "Sprint", label);
                Bar(new Rect(x + 70, y + 30, 200, 10), hunter.SprintNormalized, StaminaColor);
            }

            var cam = hunter.ViewCamera;
            if (cam == null)
                return;
            foreach (var gorilla in match.Gorillas)
                DrawSedationOverGorilla(cam, gorilla);
        }

        void DrawSedationOverGorilla(Camera cam, GorillaController gorilla)
        {
            var target = gorilla.Sedation;
            var meter = target.Meter;
            if (meter.IsDown)
            {
                string tied = meter.State == SedationState.Bound ? " (tied)" : "";
                DrawOverhead(cam, gorilla, $"DOWN {meter.RemainingDowntime:0}s{tied}");
                return;
            }
            if (meter.Value <= 0f && Time.time - target.LastHitTime > SedationBarShowSeconds)
                return;

            Vector3 screen = cam.WorldToScreenPoint(gorilla.transform.position + Vector3.up * 3.8f);
            if (screen.z > 0f)
                Bar(new Rect(screen.x - 40, Screen.height - screen.y, 80, 8), meter.Normalized, SedationColor);
        }

        // ---------------------------------------------------------------- Helpers

        void DrawOverhead(Camera cam, GorillaController target, string text)
        {
            Vector3 screen = cam.WorldToScreenPoint(target.transform.position + Vector3.up * 2.2f);
            if (screen.z > 0f)
                GUI.Label(new Rect(screen.x - 150, Screen.height - screen.y - 24, 300, 24), text, centered);
        }

        void CenterText(string text)
        {
            GUI.Label(new Rect(0, Screen.height * 0.32f, Screen.width, 40), text, bigLabel);
        }

        static void Bar(Rect rect, float fill, Color color)
        {
            Fill(rect, BarBack);
            Fill(new Rect(rect.x, rect.y, rect.width * Mathf.Clamp01(fill), rect.height), color);
        }

        static void Fill(Rect rect, Color color)
        {
            var previous = GUI.color;
            GUI.color = color;
            GUI.DrawTexture(rect, Texture2D.whiteTexture);
            GUI.color = previous;
        }

        void EnsureStyles()
        {
            if (label != null)
                return;
            label = new GUIStyle(GUI.skin.label) { fontSize = 15 };
            label.normal.textColor = Color.white;
            centered = new GUIStyle(label) { alignment = TextAnchor.MiddleCenter };
            bigLabel = new GUIStyle(label) { fontSize = 22, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter };
        }
    }
}
