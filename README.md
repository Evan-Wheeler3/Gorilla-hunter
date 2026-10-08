# Primal Raid

Gorillas vs. hunters on a voxel jungle island, infection style. A pack of huge gorillas hunts
a couple of hunters; every gorilla the hunters sedate and drag to the boat joins the hunters. Unity (C#), Steam, Windows first.

The full brief is the "Primal Raid: Full Game Design & Build Plan" doc. Owner decisions that
change it are tracked in [DESIGN_CHANGES.md](DESIGN_CHANGES.md). This repo is currently
at the doc's **first task**: project structure, the GameConfig, and a greybox scene where a
gorilla and a hunter can run, climb, swing, jump and shoot a sedation dart.

## Run the greybox

1. Install **Unity 6 LTS** (6000.0.x) with Unity Hub. Neither the exact version nor the
   project has been opened in Unity yet, so expect Unity to generate `ProjectSettings/`,
   `Packages/` and `.meta` files on first open. Commit those after the first open.
2. Unity Hub > **Add** > **Add project from disk** > choose this repository's root folder.
3. If the Console shows `InvalidOperationException: You are trying to read Input using the
   UnityEngine.Input class`, set **Edit > Project Settings > Player > Active Input Handling**
   to **Both** (the greybox uses the legacy Input Manager) and let Unity restart.
4. Menu **Primal Raid > Create GameConfig Asset** (optional; without it the code defaults
   are used and a warning is logged). Tune numbers in that asset, never in code.
5. Menu **Primal Raid > Open Greybox Scene** (creates `Assets/Game/Scenes/Greybox.unity`
   the first time), then press **Play**.

## Controls

| Key | Gorilla | Hunter |
| --- | --- | --- |
| WASD / mouse | Knuckle-run, look (third person) | Walk, look (first person) |
| Shift | Dash | Sprint (10 s) |
| Space | Jump (6 m); jump off a trunk while climbing | Jump |
| W into a trunk or temple wall | Climb (S down, A/D sideways); reaching a branch, crown or roof mantles onto it | |
| Left mouse | Swipe; **hold** near a vine knot (shown as "[hold LMB]") to swing, release to launch | Fire tranq dart |
| Right mouse | | Aim down sights |
| R | | Reload (also automatic after each shot, 3.5 s) |
| F1 / F2 | Possess gorilla / hunter | |
| F3 | Debug menu: sedation, collapse/wake/bind, stamina, revive, teleports, slow motion | |
| Esc | Release the mouse (click to recapture) | |

The two characters spawn next to each other south of the temple. The first vine line runs
north from just beside the gorilla, over the temple. To test darts: press F2, shoot the
gorilla (F1 back to see the sedation vignette). Two darts within about 4 s drop it, and a
dropped gorilla wakes after 15 s.

## Layout

```
Assets/Game/
  Core/      engine-free logic and tunable stat classes (unit tested)
  Config/    GameConfig ScriptableObject: every tunable number
  World/     climbable and swing-anchor markers, greybox island builder
  Combat/    health, sedation target, tranq dart
  Players/   input, gorilla and hunter controllers, third-person camera
  UI/        placeholder HUD
  DevTools/  greybox bootstrap, character factory, F3 debug menu
  Editor/    Primal Raid menu
  Tests/     EditMode NUnit tests
  Net/ Finishers/ Bots/ Audio/ Art/   reserved for later milestones
Tools/CoreTests/   runs Core + tests with plain .NET, no Unity needed
```

Each folder has its own assembly definition. `PrimalRaid.Core` has no engine references.

## Tests

- In Unity: **Window > General > Test Runner > EditMode > Run All**.
- Without Unity (.NET 8 SDK): `dotnet test Tools/CoreTests`.
