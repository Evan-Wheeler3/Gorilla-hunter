using PrimalRaid.Match;
using PrimalRaid.UI;
using PrimalRaid.World;
using UnityEngine;

namespace PrimalRaid.DevTools
{
    /// <summary>
    /// Entry point of the greybox test scene: builds the island and runs offline infection
    /// rounds. One person can possess any character (F1 / F2); the others stand idle until
    /// bots exist.
    /// </summary>
    public sealed class GreyboxBootstrap : MonoBehaviour
    {
        [SerializeField] int islandSeed = 1234;
        [SerializeField] MatchManager.Setup setup = new MatchManager.Setup();

        DebugMenu debugMenu;

        public MatchManager Match { get; private set; }

        void Start()
        {
            // The island brings its own sun and the characters bring their own cameras.
            foreach (var cam in Camera.allCameras)
                cam.gameObject.SetActive(false);

            var island = GreyboxIslandBuilder.Build(islandSeed);
            Match = gameObject.AddComponent<MatchManager>();
            Match.Init(island, setup);
            Match.BeginRound();

            gameObject.AddComponent<GreyboxHud>().Bind(Match);
            debugMenu = gameObject.AddComponent<DebugMenu>();
            debugMenu.Bind(this);

            SetCursorLocked(true);
        }

        void Update()
        {
            if (Input.GetKeyDown(KeyCode.F1))
                Match.PossessNextGorilla();
            if (Input.GetKeyDown(KeyCode.F2))
                Match.PossessNextHunter();
            if (Input.GetKeyDown(KeyCode.F5))
                Match.BeginRound();

            if (Input.GetKeyDown(KeyCode.Escape))
                SetCursorLocked(false);
            else if (Input.GetMouseButtonDown(0) && !debugMenu.IsOpen && Cursor.lockState != CursorLockMode.Locked)
                SetCursorLocked(true);
        }

        public static void SetCursorLocked(bool locked)
        {
            Cursor.lockState = locked ? CursorLockMode.Locked : CursorLockMode.None;
            Cursor.visible = !locked;
        }
    }
}
