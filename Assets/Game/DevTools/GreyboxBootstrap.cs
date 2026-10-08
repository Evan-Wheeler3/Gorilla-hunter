using PrimalRaid.Players;
using PrimalRaid.UI;
using PrimalRaid.World;
using UnityEngine;

namespace PrimalRaid.DevTools
{
    /// <summary>
    /// Entry point of the greybox test scene: builds the island, spawns one gorilla and one
    /// hunter next to each other, and lets one person possess either (F1 / F2).
    /// </summary>
    public sealed class GreyboxBootstrap : MonoBehaviour
    {
        [SerializeField] int islandSeed = 1234;
        [SerializeField] bool startAsGorilla = true;

        public GorillaController Gorilla { get; private set; }
        public HunterController Hunter { get; private set; }
        public IControllable Current { get; private set; }
        public GreyboxIslandBuilder.Result Island { get; private set; }

        DebugMenu debugMenu;

        void Start()
        {
            // The island brings its own sun and the characters bring their own cameras.
            foreach (var cam in Camera.allCameras)
                cam.gameObject.SetActive(false);

            Island = GreyboxIslandBuilder.Build(islandSeed);
            Gorilla = GreyboxCharacterFactory.SpawnGorilla(Island.gorillaTestSpawn, 0f);
            Hunter = GreyboxCharacterFactory.SpawnHunter(Island.hunterTestSpawn, 15f);

            gameObject.AddComponent<GreyboxHud>().Bind(Gorilla, Hunter);
            debugMenu = gameObject.AddComponent<DebugMenu>();
            debugMenu.Bind(this);

            Possess(startAsGorilla ? (IControllable)Gorilla : Hunter);
            SetCursorLocked(true);
        }

        void Update()
        {
            if (Input.GetKeyDown(KeyCode.F1))
                Possess(Gorilla);
            if (Input.GetKeyDown(KeyCode.F2))
                Possess(Hunter);

            if (Input.GetKeyDown(KeyCode.Escape))
                SetCursorLocked(false);
            else if (Input.GetMouseButtonDown(0) && !debugMenu.IsOpen && Cursor.lockState != CursorLockMode.Locked)
                SetCursorLocked(true);
        }

        public void Possess(IControllable target)
        {
            Gorilla.SetControl(ReferenceEquals(target, Gorilla));
            Hunter.SetControl(ReferenceEquals(target, Hunter));
            Current = target;
        }

        public void ResetPositions()
        {
            Gorilla.Teleport(Island.gorillaTestSpawn);
            Hunter.Teleport(Island.hunterTestSpawn);
        }

        public static void SetCursorLocked(bool locked)
        {
            Cursor.lockState = locked ? CursorLockMode.Locked : CursorLockMode.None;
            Cursor.visible = !locked;
        }
    }
}
