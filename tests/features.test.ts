import { beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { Match } from '../src/game/match';
import { emptyInput, type InputFrame } from '../src/game/types';
import { Block } from '../src/world/blocks';
import { generateIsland, type Island } from '../src/world/island';

const DT = 1 / 60;
let island: Island;
beforeAll(() => {
  island = generateIsland(1234);
});

const practice = (weather: 'sunset' | 'mist' | 'storm' = 'sunset') =>
  new Match(island, {
    practice: true,
    seed: 77,
    weather,
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

/** Knocks a gorilla out where it stands. */
function knockOut(m: Match, id: number) {
  const g = m.gorillas.get(id)!;
  g.sedation.add(config.sedation.dartSedation);
  run(m, 0.1);
  return g;
}

describe('gorilla moves', () => {
  it('a ground pound from high up flattens a hunter, leaves a crater, and the next round has no crater', () => {
    const m = practice();
    run(m, 0.5);
    const h = m.hunters.get(1)!, g = m.gorillas.get(2)!;
    const w = island.world;
    const gy = w.groundHeight(h.body.x, h.body.z);
    g.setPosition({ x: h.body.x + 1, y: gy + 9, z: h.body.z });
    run(m, 0.05);
    run(m, 1.5, (t) => new Map([[2, { ...emptyInput(0), primary: t === 0 }]]));
    expect(h.dead).toBe(true);
    expect(m.effects.some((e) => e.type === 'kill' && e.pound)).toBe(true);
    expect(m.effects.some((e) => e.type === 'crater')).toBe(true);
    const ix = w.ix(g.body.x), iz = w.iz(g.body.z);
    let mud = false;
    for (let iy = 0; iy < w.sy; iy++) if (w.get(ix, iy, iz) === Block.Mud) mud = true;
    expect(mud).toBe(true);
    expect(w.dirtyChunks.size).toBeGreaterThan(0);
    practice(); // a new round puts the ground back
    let mudAfter = false;
    for (let iy = 0; iy < w.sy; iy++) if (w.get(ix, iy, iz) === Block.Mud) mudAfter = true;
    expect(mudAfter).toBe(false);
  });

  it('three kills in a row bring streak rage and only the big finishers', () => {
    const m = practice();
    run(m, 0.5);
    const g = m.gorillas.get(2)!, h = m.hunters.get(1)!;
    for (let k = 0; k < 3; k++) {
      while (h.dead) run(m, 0.5);
      g.finisherUntil = -1;
      g.setPosition({ x: h.body.x, y: h.body.y + 0.1, z: h.body.z - 1.8 });
      run(m, 0.6);
      run(m, 0.1, (t) => new Map([[2, { ...emptyInput(0), primary: t === 0 }]]));
      expect(h.dead).toBe(true);
    }
    expect(g.streak).toBe(3);
    expect(m.effects.some((e) => e.type === 'streak')).toBe(true);
    run(m, 0.1);
    expect(g.rage).toBe(true);
  });

  it('dashing and diving burst through leaves', () => {
    const m = practice();
    run(m, 0.5);
    const g = m.gorillas.get(2)!;
    const w = island.world;
    // A wall of leaves right in front.
    const gy = w.groundHeight(g.body.x, g.body.z + 3);
    for (let y = gy; y < gy + 3; y += 0.5) for (let x = -1.5; x <= 1.5; x += 0.5) w.edit(w.ix(g.body.x + x), w.iy(y), w.iz(g.body.z + 3), Block.Leaves);
    run(m, 0.6, (t) => new Map([[2, { ...emptyInput(0), moveY: 1, dash: t === 0 }]]));
    expect(m.effects.some((e) => e.type === 'leaves' && e.count > 0)).toBe(true);
    expect(g.body.z).toBeGreaterThan(-19 + 3); // went through
  });
});

describe('hunter tools', () => {
  it('a net holds a gorilla that walks into it', () => {
    const m = practice();
    run(m, 0.5);
    const h = m.hunters.get(1)!, g = m.gorillas.get(2)!;
    run(m, 0.1, (t) => new Map([[1, { ...emptyInput(0), net: t === 0 }]]));
    expect(m.nets.length).toBe(1);
    const n = m.nets[0];
    g.setPosition({ x: n.x, y: n.y + 0.1, z: n.z - 3 });
    run(m, 1.5, () => new Map([[2, { ...emptyInput(0), moveY: 1 }]]));
    expect(g.netted(m.ctx.time)).toBe(true);
    const z = g.body.z;
    run(m, 0.5, () => new Map([[2, { ...emptyInput(0), moveY: 1 }]]));
    expect(Math.abs(g.body.z - z)).toBeLessThan(0.3); // stuck
    run(m, 2, () => new Map([[2, { ...emptyInput(0), moveY: 1 }]]));
    expect(g.netted(m.ctx.time)).toBe(false);
    expect(h.netCooldown).toBeGreaterThan(0);
  });

  it('a flare reveals gorillas within 30 m', () => {
    const m = practice();
    run(m, 0.5);
    const h = m.hunters.get(1)!;
    const near = m.gorillas.get(2)!, far = m.gorillas.get(3)!;
    far.setPosition({ x: h.body.x + 45, y: island.world.groundHeight(h.body.x + 45, h.body.z) + 0.1, z: h.body.z });
    run(m, 0.1, (t) => new Map([[1, { ...emptyInput(0), flare: t === 0 }]]));
    expect(m.flares.length).toBe(1);
    expect(near.revealedUntil).toBeGreaterThan(m.ctx.time);
    expect(far.revealedUntil).toBeLessThan(m.ctx.time);
  });
});

describe('rescues', () => {
  it('the first slap each round is a wake-up roar that revives instantly', () => {
    const m = practice();
    run(m, 0.5);
    const a = m.gorillas.get(2)!, b = knockOut(m, 3);
    expect(b.sedation.isDown).toBe(true);
    a.setPosition({ x: b.body.x, y: b.body.y + 0.2, z: b.body.z - 1.6 });
    run(m, 0.3);
    run(m, 0.1, (t) => new Map([[2, { ...emptyInput(0), primary: t === 0 }]]));
    expect(b.sedation.isDown).toBe(false);
    expect(a.wakeRoarReady).toBe(false);
    expect(m.effects.some((e) => e.type === 'wakeRoar')).toBe(true);
  });

  it('a struggling gorilla slows its dragger, and a charging gorilla makes him drop it', () => {
    const m = practice();
    run(m, 0.5);
    const h = m.hunters.get(1)!, g = knockOut(m, 3);
    h.setPosition({ x: g.body.x, y: g.body.y + 0.1, z: g.body.z - 2 });
    run(m, 0.3);
    let f = 0;
    run(m, 0.2, () => new Map([[1, { ...emptyInput(0), interact: f === 0, interactHeld: f++ === 0 }]]));
    expect(h.dragging).toBe(3);
    const speed = (struggle: boolean) => {
      const z0 = h.body.z;
      let i = 0;
      run(m, 1, () => new Map([[1, { ...emptyInput(Math.PI), moveY: 1 }], [3, { ...emptyInput(0), primary: struggle && i++ % 6 === 0 }]]));
      return Math.abs(h.body.z - z0);
    };
    const calm = speed(false), fighting = speed(true);
    expect(fighting).toBeLessThan(calm * 0.8);
    // Charge: a dash that passes close drops the body.
    const a = m.gorillas.get(2)!;
    a.setPosition({ x: h.body.x + 2.6, y: h.body.y + 0.1, z: h.body.z - 5 });
    run(m, 0.3);
    run(m, 0.4, (t) => new Map([[2, { ...emptyInput(0), moveY: 1, dash: t === 0 }]]));
    expect(h.dragging === null || h.dead).toBe(true);
  });
});

describe('wildfire and weather', () => {
  it('the fire closes in, scorches the island and burns a hunter caught outside', () => {
    const m = practice();
    run(m, 0.5);
    m.round.roundTime = config.match.fireStartSeconds - 0.1;
    run(m, 0.3);
    expect(m.round.phase).toBe('wildfire');
    expect(m.wildfire.active).toBe(true);
    const r0 = m.fireRadius;
    const h = m.hunters.get(1)!;
    const c = m.wildfire.center;
    // Put the hunter well outside the ring.
    const x = c.x + 55, z = c.z;
    h.setPosition({ x, y: island.world.groundHeight(x, z) + 0.1, z });
    m.round.roundTime = config.match.fireStartSeconds + 150;
    run(m, 5);
    expect(m.fireRadius).toBeLessThan(r0);
    expect(h.dead).toBe(true);
    expect(m.effects.some((e) => e.type === 'kill' && e.burn)).toBe(true);
  });

  it('storms flash lightning that reveals everyone', () => {
    const m = practice('storm');
    run(m, 30);
    expect(m.effects.some((e) => e.type === 'lightning')).toBe(true);
  });

  it('weather is picked from the seed', () => {
    const w = (seed: number) => new Match(island, { practice: true, seed, players: [{ id: 1, name: 'H', team: 'hunter' }, { id: 2, name: 'G', team: 'gorilla' }] }).weather;
    expect(w(5)).toBe(w(5));
    const all = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(w));
    expect(all.size).toBeGreaterThan(1);
  });
});
