using System.IO;
using System.Linq;
using PrimalRaid.Config;
using PrimalRaid.DevTools;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace PrimalRaid.EditorTools
{
    /// <summary>Editor menu: one-click setup for the greybox scene and the config asset.</summary>
    public static class PrimalRaidMenu
    {
        const string ScenePath = "Assets/Game/Scenes/Greybox.unity";
        const string ConfigPath = "Assets/Game/Config/Resources/GameConfig.asset";

        [MenuItem("Primal Raid/Open Greybox Scene", priority = 0)]
        public static void OpenGreyboxScene()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
                return;

            if (!File.Exists(ScenePath))
                CreateGreyboxScene();

            EditorSceneManager.OpenScene(ScenePath);
        }

        [MenuItem("Primal Raid/Create GameConfig Asset", priority = 1)]
        public static void CreateConfigAsset()
        {
            var existing = AssetDatabase.LoadAssetAtPath<GameConfig>(ConfigPath);
            if (existing != null)
            {
                Selection.activeObject = existing;
                return;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(ConfigPath));
            var config = ScriptableObject.CreateInstance<GameConfig>();
            AssetDatabase.CreateAsset(config, ConfigPath);
            AssetDatabase.SaveAssets();
            Selection.activeObject = config;
            Debug.Log($"Created {ConfigPath} with the design-doc defaults.");
        }

        static void CreateGreyboxScene()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            new GameObject("Greybox Bootstrap").AddComponent<GreyboxBootstrap>();
            EditorSceneManager.SaveScene(scene, ScenePath);

            var scenes = EditorBuildSettings.scenes.ToList();
            if (scenes.All(s => s.path != ScenePath))
            {
                scenes.Insert(0, new EditorBuildSettingsScene(ScenePath, true));
                EditorBuildSettings.scenes = scenes.ToArray();
            }
            Debug.Log($"Created {ScenePath}. Press Play to test movement.");
        }
    }
}
