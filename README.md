# Primal Raid

Gorillas vs. hunters on a voxel jungle island, infection style, in the browser. Phones (touch
controls) and desktop (mouse and keyboard). One dart knocks a gorilla out; hunters drag it to
a boat beam and it joins the hunters. One swipe ends a hunter, with a random finisher.

Owner decisions that changed the original design doc are tracked in
[DESIGN_CHANGES.md](DESIGN_CHANGES.md).

## Play locally

```
npm install
npm run dev        # http://localhost:5173 (also reachable from a phone on the same Wi-Fi)
```

`npm run build` writes a static site to `dist/` that any static host can serve.

## Hosting

Every push runs the tests and deploys to GitHub Pages
(`.github/workflows/deploy.yml`): https://evan-wheeler3.github.io/Gorilla-hunter/

One-time setup: repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Controls

| Action | Desktop | Phone |
| --- | --- | --- |
| Move | WASD | Left thumb joystick |
| Look | Mouse (click the game to capture it, Esc frees it) | Drag with the right thumb |
| Jump | Space | JUMP |
| Hunter: sprint | Shift (unlimited) | Push the joystick past half-way |
| Hunter: fire dart | Left click | FIRE (light aim assist; slide your thumb on it to steer) |
| Hunter: aim (shows the dart's drop and landing spot) | Right click (hold) | AIM, by the left thumb: hold, or tap to lock on and tap again to drop |
| Hunter: drag / tie up a knocked-out gorilla | E tap / hold 3 s | GRAB tap / hold |
| Gorilla: swipe (kills a hunter, slaps a downed gorilla awake) | Left click | SWIPE |
| Gorilla: swing on a vine | Hold left click near a vine knot | Hold SWIPE |
| Gorilla: climb | Walk into a trunk or temple wall | Same |
| Gorilla: dash (kills any hunter you dash through) | Shift | DASH |

A red ring under a hunter means a swipe will hit him; an orange ring means a dash will. The bots play every seat nobody is in.

## Code layout

```
src/core/     rules with no rendering: config (every tunable), sedation, round, teams, finishers
src/world/    voxel grid, island generator, chunk mesher
src/physics/  character collision against voxels
src/game/     gorilla and hunter controllers, Match (darts, dragging, boats, kills, rounds)
src/render/   voxel character models and animation, world view, effects
src/input/    keyboard, mouse and touch controls
src/ui/       HUD
src/app/      the game loop and camera
tests/        Vitest: rules, world, and headless play-throughs on the real island
```

`npm test` runs the tests; `npm run typecheck` checks types.
