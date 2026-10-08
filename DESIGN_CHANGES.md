# Design changes from the original doc

Owner decisions that override the "Primal Raid: Full Game Design & Build Plan" doc. All numbers
live in `GameConfig` and are starting points for playtests.

## Mode: infection (replaces doc section 3 teams and win conditions)

| Rule | Doc | Now |
| --- | --- | --- |
| Starting teams | gorillas = ceil(players / 4), the rest hunters | hunters = ceil(players / 5), the rest gorillas (10 players = 2 hunters v 8 gorillas) |
| Captured gorilla | becomes a spectator | becomes a hunter |
| Dead hunter | spectates | respawns at camp after 5 s while the team's shared pool has lives (100 lives) |
| Hunters win | all gorillas secured | every gorilla converted |
| Gorillas win | all hunters dead, or timer | timer runs out, or the life pool is empty and every hunter is dead |
| Last gorilla | — | permanent rage mode |
| Boats | 1, east shore | 4, one per shore (tested: worst trip ~158 m, ~30 s at sprint with detours, inside the 37.5 s window) |
| Round length | 12:00, fire at 6:00 | 10:00, fire at 5:00 |

Status: config values are in; the round loop that enforces these rules is the next milestone.

## Combat and movement

| Rule | Doc | Now | Status |
| --- | --- | --- | --- |
| Darts to drop a gorilla | 3 within ~5 s (math actually needed 2.5 s) | 1 dart | built and tested |
| Sedation slow | none | partial doses slow up to 30%; unused until something deals partial doses | built |
| Rifle reload | 5 s, manual R | 3.5 s, automatic | built |
| Dart range | — | no practical limit (10 s flight), gravity drop | built |
| Collapse / bound time | 40 s / 90 s | 15 s / 30 s | built (bind UI comes with dragging) |
| Knockout clock while dragged | runs normally | runs at 40% speed, so a 15 s knockout lasts 37.5 s of dragging | built in the meter, used once dragging lands |
| Gorilla slaps a downed teammate | only cut a binding (3 s) | every swipe on a downed gorilla knocks 2 s off its timer (8 slaps wake it from 15 s) | built |
| Hunter sprint | 3 s | unlimited (can be switched back to a 10 s bar) | built |
| Gorilla swipe | 50 dmg, two hits kill | 100 dmg, one hit kills | built |
| Dragging | 40% speed alone, no sprint | full speed, sprint allowed | config only, drag arrives next milestone |

Playtest check: with one-dart drops and one-hit kills, every fight is decided by who lands
the first hit. If hunters dominate, lengthen the reload; if gorillas do, shorten it.
