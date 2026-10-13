import { describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { Rng } from '../src/core/rng';
import { pickStartingHunters, startingHunterCount } from '../src/core/teams';

describe('teams', () => {
  it.each([
    [2, 1],
    [3, 1],
    [4, 1],
    [6, 2],
    [10, 2],
  ])('%i players start with %i hunter(s)', (players, hunters) => {
    expect(startingHunterCount(players, config.match)).toBe(hunters);
  });

  it('always leaves a gorilla', () => {
    expect(startingHunterCount(4, { ...config.match, playersPerStartingHunter: 1 })).toBe(3);
  });

  it('picks whoever hunted least, breaking ties randomly', () => {
    const players = [0, 1, 2, 3].map((id) => ({ id, roundsStartedAsHunter: id === 2 ? 0 : 1 }));
    for (let s = 1; s < 30; s++) {
      const rng = new Rng(s);
      expect(pickStartingHunters(players, config.match, () => rng.next())).toEqual([2]);
    }
    const even = [0, 1, 2, 3].map((id) => ({ id, roundsStartedAsHunter: 0 }));
    const seen = new Set<number>();
    for (let s = 1; s < 100; s++) {
      const rng = new Rng(s);
      pickStartingHunters(even, config.match, () => rng.next()).forEach((id) => seen.add(id));
    }
    expect(seen.size).toBe(4);
  });
});
