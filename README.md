# Primal Raid

Gorillas vs. hunters on a voxel jungle island, infection style. A pack of huge gorillas hunts
a couple of hunters; every gorilla the hunters sedate and drag to the boat joins the hunters. Unity (C#), Steam, Windows first.

The full brief is the "Primal Raid: Full Game Design & Build Plan" doc. Owner decisions that
change it are tracked in [DESIGN_CHANGES.md](DESIGN_CHANGES.md). The greybox scene
runs offline infection rounds: gorillas run, climb, swing and swipe; hunters dart, tie up and
drag gorillas to a boat, where they join the hunters. Characters you are not playing stand
idle until bots exist.

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
| E | | Near a downed gorilla: tap to drag (tap again to drop), hold 3 s to tie up |
| Swipe a downed gorilla | Slap 2 s off his knockout | |
| F5 | New round | |
| F1 / F2 | Possess next gorilla / next hunter | |
| F3 | Debug menu: round control, team sizes, knock out or wake gorillas, teleports, slow motion | |
| Esc | Release the mouse (click to recapture) | |

A round starts on Play: you are a hunter, 3 gorillas stand just north of you, south of the
temple, and the first vine line runs north beside them over the temple. Try a full loop:
dart a gorilla (one dart drops it for 15 s), tap E next to it, and sprint to the nearest
yellow boat beam. The knockout clock runs at 40% while you drag. Reaching the beam turns
the gorilla into a hunter; converting all of them wins. F1 lets you play a gorilla: swipe a
hunter to kill (a finisher name is announced) or swipe a downed gorilla to slap it awake.

## Layout

```
Assets/Game/
  Core/      engine-free logic and tunable stat classes (unit tested)
  Config/    GameConfig ScriptableObject: every tunable number
  World/     climbable and swing-anchor markers, greybox island builder
  Combat/    health, sedation target, tranq dart
  Players/   input, gorilla and hunter controllers, drag/tie-up, camera, character factory
  Match/     MatchManager: runs infection rounds in the scene
  UI/        placeholder HUD
  DevTools/  greybox bootstrap, F3 debug menu
  Editor/    Primal Raid menu
  Tests/     EditMode NUnit tests
  Net/ Finishers/ Bots/ Audio/ Art/   reserved for later milestones
Tools/CoreTests/   runs Core + tests with plain .NET, no Unity needed
```

Each folder has its own assembly definition. `PrimalRaid.Core` has no engine references.

## Tests

- In Unity: **Window > General > Test Runner > EditMode > Run All**.
- Without Unity (.NET 8 SDK): `dotnet test Tools/CoreTests`.
