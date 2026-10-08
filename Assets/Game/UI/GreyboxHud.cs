using PrimalRaid.Combat;
using PrimalRaid.Core;
using PrimalRaid.Players;
using UnityEngine;

namespace PrimalRaid.UI
{
    /// <summary>
    /// Placeholder IMGUI HUD for the greybox (design doc section 8 lists the real HUD).
    /// Gorilla: stamina, swing-anchor marker, sedation vignette. Hunter: crosshair, reload,
    /// sprint, health, and the sedation bar over gorillas.
    /// </summary>
    public sealed class GreyboxHud : MonoBehaviour
    {
        const float SedationBarShowSeconds = 10f;

        static readonly Color BarBack = new Color(0f, 0f, 0f, 0.55f);
        static readonly Color StaminaColor = new Color(0.95f, 0.8f, 0.25f);
        static readonly Color SedationColor = new Color(0.95f, 0.25f, 0.65f);
        static readonly Color ReloadColor = new Color(0.4f, 0.85f, 1f);
        static readonly Color HealthColor = new Color(0.4f, 0.9f, 0.4f);

        GorillaController gorilla;
        GorillaController teammate;
        HunterController hunter;
        GUIStyle label;
        GUIStyle bigLabel;

        /// <param name="teammate">A second, uncontrolled gorilla for testing slaps (may be null).</param>
        public void Bind(GorillaController gorilla, GorillaController teammate, HunterController hunter)
        {
            this.gorilla = gorilla;
            this.teammate = teammate;
            this.hunter = hunter;
        }

        void OnGUI()
        {
            EnsureStyles();
            if (gorilla != null && gorilla.HasControl)
                DrawGorillaHud();
            else if (hunter != null && hunter.HasControl)
                DrawHunterHud();

            GUI.Label(new Rect(12, 8, 900, 24),
                      "F1 gorilla  F2 hunter  F3 debug menu  Esc release mouse  (click to recapture)", label);
        }

        void DrawGorillaHud()
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
            float y = Screen.height - 60f;
            Bar(new Rect(x, y, w, 16), gorilla.StaminaNormalized, StaminaColor);
            GUI.Label(new Rect(x, y - 22, w, 20), $"Stamina {gorilla.Stamina:0}", label);
            Bar(new Rect(x, y + 22, w, 8), meter.Normalized, SedationColor);

            var v = gorilla.Velocity;
            float speed = new Vector2(v.x, v.z).magnitude;
            string extra = gorilla.IsLandingSlowed ? "  (landing slow)" : "";
            GUI.Label(new Rect(12, 32, 600, 24), $"{gorilla.State}  {speed:0.0} m/s{extra}", label);

            if (meter.IsDown)
                CenterText($"SEDATED ({meter.State}) - waking in {meter.RemainingDowntime:0}s");
            else if (Time.time - gorilla.LastSwipeTime < 0.15f)
                CenterText("SWIPE");

            var anchor = gorilla.AnchorInRange;
            var cam = gorilla.ViewCamera;
            if (teammate != null && teammate.Sedation.Meter.IsDown && cam != null)
                DrawDownedLabel(cam, teammate, "swipe to slap awake");

            if (anchor != null && cam != null && gorilla.State != GorillaController.MoveState.Swinging)
            {
                Vector3 screen = cam.WorldToScreenPoint(anchor.Point);
                if (screen.z > 0f)
                    GUI.Label(new Rect(screen.x - 40, Screen.height - screen.y - 30, 120, 24), "[hold LMB]", bigLabel);
            }
        }

        void DrawHunterHud()
        {
            float cx = Screen.width * 0.5f;
            float cy = Screen.height * 0.5f;

            if (hunter.IsDead)
            {
                CenterText("You were torn apart. F3 > Revive hunter");
                return;
            }

            // Crosshair with the reload bar underneath.
            Fill(new Rect(cx - 8, cy - 1, 16, 2), Color.white);
            Fill(new Rect(cx - 1, cy - 8, 2, 16), Color.white);
            if (hunter.IsReloading)
                Bar(new Rect(cx - 30, cy + 14, 60, 5), hunter.ReloadProgress, ReloadColor);

            float x = 20f;
            float y = Screen.height - 90f;
            string darts = hunter.IsReloading ? "reloading" : hunter.LoadedDarts > 0 ? "dart loaded" : "empty - press R";
            GUI.Label(new Rect(x, y, 400, 24), $"Tranq rifle: {darts}", label);
            GUI.Label(new Rect(x, y + 24, 200, 24), "Health", label);
            Bar(new Rect(x + 70, y + 30, 200, 10), hunter.Health.Current / hunter.Health.Max, HealthColor);
            if (!hunter.HasUnlimitedSprint)
            {
                GUI.Label(new Rect(x, y + 44, 200, 24), "Sprint", label);
                Bar(new Rect(x + 70, y + 50, 200, 10), hunter.SprintNormalized, StaminaColor);
            }

            if (gorilla != null)
                DrawSedationOverGorilla(hunter.ViewCamera, gorilla);
            if (teammate != null)
                DrawSedationOverGorilla(hunter.ViewCamera, teammate);
        }

        void DrawDownedLabel(Camera cam, GorillaController target, string text)
        {
            Vector3 screen = cam.WorldToScreenPoint(target.transform.position + Vector3.up * 3.8f);
            if (screen.z > 0f)
                GUI.Label(new Rect(screen.x - 90, Screen.height - screen.y - 24, 220, 24),
                          $"DOWN {target.Sedation.Meter.RemainingDowntime:0}s - {text}", label);
        }

        void DrawSedationOverGorilla(Camera cam, GorillaController gorilla)
        {
            var target = gorilla.Sedation;
            if (cam == null || (target.Meter.Value <= 0f && Time.time - target.LastHitTime > SedationBarShowSeconds))
                return;

            Vector3 screen = cam.WorldToScreenPoint(gorilla.transform.position + Vector3.up * 3.8f);
            if (screen.z <= 0f)
                return;
            var rect = new Rect(screen.x - 40, Screen.height - screen.y, 80, 8);
            Bar(rect, target.Meter.Normalized, SedationColor);
            if (target.Meter.State != SedationState.Awake)
                GUI.Label(new Rect(rect.x - 20, rect.y - 22, 160, 20), $"DOWN {target.Meter.RemainingDowntime:0}s", label);
        }

        void CenterText(string text)
        {
            GUI.Label(new Rect(0, Screen.height * 0.3f, Screen.width, 40), text, bigLabel);
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
            bigLabel = new GUIStyle(label) { fontSize = 22, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter };
        }
    }
}
