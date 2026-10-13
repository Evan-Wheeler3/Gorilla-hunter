import { describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { FinisherSelector, LAUNCH_FINISHERS } from '../src/core/finishers';

const make = (seed = 7) => new FinisherSelector(LAUNCH_FINISHERS, config.finishers, seed);

describe('FinisherSelector', () => {
  it('never repeats for a gorilla or within the last 3 match kills', () => {
    const s = make();
    const history: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const id = s.pick(i % 3, false).finisher.id;
      expect(history.slice(-3)).not.toContain(id);
      history.push(id);
    }
  });

  it('uses every launch finisher', () => {
    const s = make();
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(s.pick(i % 3, false).finisher.id);
    expect(seen.size).toBe(LAUNCH_FINISHERS.length);
  });

  it('rage makes the legendary more common', () => {
    const count = (rage: boolean) => {
      const s = make(123);
      let n = 0;
      for (let i = 0; i < 20000; i++) if (s.pick(i % 3, rage).finisher.rarity === 'legendary') n++;
      return n;
    };
    expect(count(true)).toBeGreaterThan(count(false) * 1.5);
  });

  it('is deterministic per seed and survives a one-item catalog', () => {
    const a = make(42), b = make(42);
    for (let i = 0; i < 100; i++) expect(a.pick(i % 3, i % 5 === 0)).toEqual(b.pick(i % 3, i % 5 === 0));
    const one = new FinisherSelector([{ id: 'only', name: 'Only', rarity: 'common' }], config.finishers, 1);
    expect(one.pick(1, false).finisher.id).toBe('only');
    expect(one.pick(1, false).finisher.id).toBe('only');
  });
});
