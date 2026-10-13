import { beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { Gorilla } from '../src/game/gorilla';
import { Match } from '../src/game/match';
import { emptyInput, type InputFrame } from '../src/game/types';
import { Block } from '../src/world/blocks';
import { generateIsland, type Island } from '../src/world/island';

const DT = 1 / 60;
let island: Island;
beforeAll(() => {
  island = generateIsland(1234);
});

const practice = () =>
  new Match(island, {
    practice: true,
    players: [
      { id: 1, name: 'Hunter', team: 'hunter' },
      { id: 2, name: 'Gorilla A', team: 'gorilla' },
      { id: 3, name: 'Gorilla B', team: 'gorilla' },
      { id: 4, name: 'Gorilla C', team: 'gorilla' },
    ],
  });

function run(match: Match, seconds: number, inputs: (t: number) => Map<number, InputFrame> = () => new Map()) {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) match.step(DT, inputs(i * DT));
}

describe('practice match', () => {
  it('starts in the hunt with everyone standing on the ground', () => {
    const m = practice();
    run(m, 1);
    expect(m.round.phase).toBe('hunt');
    for (const c of [...m.gorillas.values(), ...m.hunters.values()]) expect(c.body.onGround).toBe(true);
  });

  it('one dart knocks a gorilla out; dragging it to a boat converts it', () => {
    const m = practice();
    run(m, 0.5);
    const h = m.hunters.get(1)!, g = m.gorillas.get(3)!;
    const aim = { x: g.body.x, y: g.body.y + 1.4, z: g.body.z };
    const yaw = Math.atan2(aim.x - h.body.x, aim.z - h.body.z);
    let fired = false;
    run(m, 1.5, () => {
      const frame = { ...emptyInput(yaw), primary: !fired, aimPoint: aim };
      fired = true;
      return new Map([[1, frame]]);
    });
    expect(g.sedation.isDown).toBe(true);
    expect(m.effects.some((e) => e.type === 'knockout' && e.gorilla === 3)).toBe(true);
    expect(h.loaded).toBe(false); // auto-reload running

    // Walk up, tap E (press one frame, release the next).
    h.setPosition({ x: g.body.x, y: g.body.y + 0.1, z: g.body.z - 2 });
    run(m, 0.3);
    let frame = 0;
    run(m, 0.2, () => new Map([[1, { ...emptyInput(0), interact: frame === 0, interactHeld: frame++ === 0 }]]));
    expect(h.dragging).toBe(3);
    expect(g.draggedBy).toBe(1);

    // Carry it to the east boat: the body follows behind the hunter, then converts.
    const dock = island.docks[0];
    h.setPosition({ x: dock.zone.x - dock.outX * 3, y: dock.zone.y + 0.2, z: dock.zone.z - dock.outZ * 3 });
    g.setPosition({ x: dock.zone.x - dock.outX * 5, y: dock.zone.y + 0.2, z: dock.zone.z - dock.outZ * 5 });
    const yawOut = Math.atan2(dock.outX, dock.outZ);
    run(m, 3, () => new Map([[1, { ...emptyInput(yawOut), moveY: 1 }]]));
    expect(m.gorillas.has(3)).toBe(false);
    expect(m.hunters.has(3)).toBe(true);
    expect(m.round.gorillas.size).toBe(2);
  });

  it('a gorilla swipe kills a hunter, spends a life and the hunter respawns', () => {
    const m = practice();
    run(m, 0.5);
    const h = m.hunters.get(1)!, g = m.gorillas.get(2)!;
    g.setPosition({ x: h.body.x, y: h.body.y + 0.1, z: h.body.z - 1.8 });
    run(m, 0.3);
    run(m, 0.1, (t) => new Map([[2, { ...emptyInput(0), primary: t === 0 }]]));
    expect(h.dead).toBe(true);
    expect(m.round.livesRemaining).toBe(config.match.sharedHunterLives - 1);
    const kill = m.effects.find((e) => e.type === 'kill');
    expect(kill && kill.type === 'kill' && kill.pick.finisher.name.length > 0).toBe(true);
    run(m, config.match.hunterRespawnSeconds + 0.2);
    expect(h.dead).toBe(false);
  });

  it('slapping a downed teammate knocks time off and can wake him', () => {
    const m = practice();
    run(m, 0.5);
    const a = m.gorillas.get(2)!, b = m.gorillas.get(3)!;
    b.sedation.add(100);
    a.setPosition({ x: b.body.x, y: b.body.y + 0.1, z: b.body.z - 2 });
    run(m, 0.3);
    const before = b.sedation.remainingDowntime;
    let i = 0;
    run(m, 0.05, () => new Map([[2, { ...emptyInput(0), primary: i++ === 0 }]]));
    expect(b.sedation.remainingDowntime).toBeLessThan(before - 1.5);
  });
});

describe('gorilla movement on the real island', () => {
  const findTree = () => {
    const w = island.world;
    // A trunk with clear ground on its south side.
    for (let z = -30; z < 40; z += 0.5)
      for (let x = -40; x < 40; x += 0.5) {
        const gy = w.groundHeight(x, z - 2.5);
        if (w.blockAt(x, gy + 1, z) !== Block.Wood) continue;
        if (!w.solidAt(x, gy + 0.5, z - 1.5) && !w.solidAt(x, gy + 2.5, z - 1.5) && !w.solidAt(x, gy + 2.5, z - 2.5))
          return { x, z, gy };
      }
    throw new Error('no tree');
  };

  it('runs, climbs a trunk and mantles onto the canopy', () => {
    const m = practice();
    const g = m.gorillas.get(2)!;
    const tree = findTree();
    g.setPosition({ x: Math.floor(tree.x / 0.5) * 0.5 + 0.25, y: tree.gy + 0.1, z: tree.z - 2.2 });
    const startY = g.body.y;
    let sawClimb = false, sawMantle = false, highestStanding = -Infinity;
    // Hold forward until standing on top, then let go.
    run(m, 6, () => {
      if (g.state === 'climb') sawClimb = true;
      if (g.state === 'mantle') sawMantle = true;
      if (g.state === 'ground' && g.body.onGround) highestStanding = Math.max(highestStanding, g.body.y);
      return new Map([[2, { ...emptyInput(0), moveY: sawMantle && g.state === 'ground' ? 0 : 1 }]]);
    });
    expect(sawClimb).toBe(true);
    expect(sawMantle).toBe(true);
    expect(highestStanding).toBeGreaterThan(startY + 6); // stood on the canopy
    expect(g.body.y).toBeGreaterThan(startY + 6); // and stayed up there
  });

  it('jumps, grabs a vine and swings', () => {
    const m = practice();
    const g: Gorilla = m.gorillas.get(2)!;
    const w = island.world;
    const anchor = island.anchors.find((a) => {
      const gy = w.groundHeight(a.x, a.z);
      return a.y - gy > 5 && a.y - gy < 8 && !w.solidAt(a.x, gy + 1, a.z - 1.5) && !w.solidAt(a.x, gy + 3, a.z - 1.5);
    })!;
    expect(anchor).toBeTruthy();
    g.setPosition({ x: anchor.x, y: w.groundHeight(anchor.x, anchor.z - 1.5) + 0.1, z: anchor.z - 1.5 });
    run(m, 0.3);
    let swung = false, frame = 0;
    run(m, 1.2, () => {
      if (g.state === 'swing') swung = true;
      return new Map([[2, { ...emptyInput(0), jump: frame++ === 0, primaryHeld: true, moveY: 1 }]]);
    });
    expect(swung).toBe(true);
  });
});
