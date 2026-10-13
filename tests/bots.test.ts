import { beforeAll, describe, expect, it } from 'vitest';
import { Bots } from '../src/game/bots';
import { Match } from '../src/game/match';
import { generateIsland, type Island } from '../src/world/island';

const DT = 1 / 60;
let island: Island;
beforeAll(() => {
  island = generateIsland(1234);
});

/** Runs a match where bots play every seat and tallies what happened. */
function botMatch(players: { id: number; name: string; team: 'hunter' | 'gorilla' }[], seconds: number, humans = new Set<number>()) {
  const m = new Match(island, { practice: true, players });
  const bots = new Bots();
  const tally = { kills: 0, dashKills: 0, shots: 0, dartHits: 0, knockouts: 0, converts: 0, slaps: 0 };
  for (let i = 0; i < seconds / DT; i++) {
    m.step(DT, bots.inputs(m, DT, humans));
    for (const e of m.effects.splice(0)) {
      if (e.type === 'kill') {
        tally.kills++;
        if (e.dash) tally.dashKills++;
      }
      if (e.type === 'shot') tally.shots++;
      if (e.type === 'dartHit' && e.target !== null) tally.dartHits++;
      if (e.type === 'knockout') tally.knockouts++;
      if (e.type === 'convert') tally.converts++;
      if (e.type === 'slap') tally.slaps++;
    }
    if (m.round.phase === 'ended') break;
  }
  return { m, tally };
}

describe('bots', () => {
  it('play a real match: hunters shoot and deliver, gorillas fight back', () => {
    const { tally } = botMatch(
      [
        { id: 1, name: 'H1', team: 'hunter' },
        { id: 2, name: 'G1', team: 'gorilla' },
        { id: 3, name: 'G2', team: 'gorilla' },
        { id: 4, name: 'G3', team: 'gorilla' },
      ],
      120,
    );
    console.log(JSON.stringify(tally));
    expect(tally.shots).toBeGreaterThan(3);
    expect(tally.kills).toBeGreaterThan(0);
    expect(tally.dartHits + tally.knockouts).toBeGreaterThan(0);
  });
});
