using PrimalRaid.Combat;
using PrimalRaid.Config;
using PrimalRaid.Players;
using PrimalRaid.World;
using UnityEngine;

namespace PrimalRaid.DevTools
{
    /// <summary>
    /// Builds greybox gorillas and hunters out of box body parts (head, torso, arms, legs, hat,
    /// rifle), matching the separate-part layout the finisher system will detach later.
    /// </summary>
    public static class GreyboxCharacterFactory
    {
        static readonly Color Fur = new Color(0.12f, 0.11f, 0.12f);
        static readonly Color Face = new Color(0.45f, 0.38f, 0.33f);
        static readonly Color Khaki = new Color(0.66f, 0.6f, 0.42f);
        static readonly Color Vest = new Color(1f, 0.45f, 0.05f);
        static readonly Color Skin = new Color(0.93f, 0.75f, 0.6f);
        static readonly Color Hat = new Color(0.9f, 0.85f, 0.68f);
        static readonly Color Gun = new Color(0.2f, 0.2f, 0.22f);

        public static GorillaController SpawnGorilla(Vector3 position, float yaw)
        {
            var go = new GameObject("Gorilla");
            go.transform.SetPositionAndRotation(position, Quaternion.Euler(0f, yaw, 0f));
            go.AddComponent<CharacterController>();
            go.AddComponent<SedationTarget>();
            var gorilla = go.AddComponent<GorillaController>();

            var visual = new GameObject("Visual").transform;
            visual.SetParent(go.transform, false);
            Part("Leg L", visual, new Vector3(-0.45f, 0.45f, -0.2f), new Vector3(0.6f, 0.9f, 0.6f), Fur);
            Part("Leg R", visual, new Vector3(0.45f, 0.45f, -0.2f), new Vector3(0.6f, 0.9f, 0.6f), Fur);
            Part("Torso", visual, new Vector3(0f, 1.6f, 0f), new Vector3(1.8f, 1.4f, 1.3f), Fur);
            Part("Chest", visual, new Vector3(0f, 1.6f, 0.66f), new Vector3(1f, 0.8f, 0.1f), Face);
            Part("Head", visual, new Vector3(0f, 2.65f, 0.35f), new Vector3(0.9f, 0.85f, 0.9f), Fur);
            Part("Face", visual, new Vector3(0f, 2.55f, 0.81f), new Vector3(0.6f, 0.45f, 0.1f), Face);
            Part("Brow", visual, new Vector3(0f, 2.92f, 0.75f), new Vector3(0.9f, 0.15f, 0.2f), Fur);
            Part("Arm L", visual, new Vector3(-1.15f, 1.3f, 0.25f), new Vector3(0.55f, 2.2f, 0.55f), Fur);
            Part("Arm R", visual, new Vector3(1.15f, 1.3f, 0.25f), new Vector3(0.55f, 2.2f, 0.55f), Fur);

            var cfg = GameConfig.Active.controls;
            var cameraGo = new GameObject("Gorilla Camera") { tag = "MainCamera" };
            var camera = cameraGo.AddComponent<Camera>();
            camera.nearClipPlane = 0.1f;
            camera.farClipPlane = 600f;
            cameraGo.AddComponent<AudioListener>();
            var rig = cameraGo.AddComponent<ThirdPersonCamera>();
            rig.Setup(go.transform, cfg.thirdPersonDistance, cfg.thirdPersonHeight);

            gorilla.Setup(visual, rig);
            gorilla.SetControl(false);
            return gorilla;
        }

        public static HunterController SpawnHunter(Vector3 position, float yaw)
        {
            var stats = GameConfig.Active.hunter;
            var go = new GameObject("Hunter");
            go.transform.SetPositionAndRotation(position, Quaternion.Euler(0f, yaw, 0f));
            go.AddComponent<CharacterController>();
            go.AddComponent<Health>();
            var hunter = go.AddComponent<HunterController>();

            var visual = new GameObject("Visual").transform;
            visual.SetParent(go.transform, false);
            Part("Leg L", visual, new Vector3(-0.12f, 0.4f, 0f), new Vector3(0.18f, 0.8f, 0.2f), Khaki);
            Part("Leg R", visual, new Vector3(0.12f, 0.4f, 0f), new Vector3(0.18f, 0.8f, 0.2f), Khaki);
            Part("Torso", visual, new Vector3(0f, 1.1f, 0f), new Vector3(0.5f, 0.6f, 0.3f), Khaki);
            Part("Vest", visual, new Vector3(0f, 1.12f, 0f), new Vector3(0.54f, 0.45f, 0.34f), Vest);
            Part("Arm L", visual, new Vector3(-0.33f, 1.1f, 0f), new Vector3(0.14f, 0.6f, 0.16f), Khaki);
            Part("Arm R", visual, new Vector3(0.33f, 1.1f, 0f), new Vector3(0.14f, 0.6f, 0.16f), Khaki);
            Part("Head", visual, new Vector3(0f, 1.58f, 0f), new Vector3(0.32f, 0.32f, 0.32f), Skin);
            Part("Hat Brim", visual, new Vector3(0f, 1.78f, 0f), new Vector3(0.46f, 0.06f, 0.46f), Hat);
            Part("Hat Top", visual, new Vector3(0f, 1.86f, 0f), new Vector3(0.3f, 0.14f, 0.3f), Hat);
            Part("Rifle", visual, new Vector3(0.25f, 1.3f, 0.45f), new Vector3(0.08f, 0.08f, 0.9f), Gun);

            var eyes = new GameObject("Hunter Eyes") { tag = "MainCamera" };
            eyes.transform.SetParent(go.transform, false);
            eyes.transform.localPosition = Vector3.up * stats.eyeHeight;
            var camera = eyes.AddComponent<Camera>();
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = 600f;
            eyes.AddComponent<AudioListener>();

            hunter.Setup(visual, camera);
            hunter.SetControl(false);
            return hunter;
        }

        static void Part(string name, Transform parent, Vector3 position, Vector3 size, Color color)
        {
            GreyboxMaterials.Box(name, parent, position, size, color, collider: false);
        }
    }
}
