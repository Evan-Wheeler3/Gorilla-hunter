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

  it('rage makes rare and legendary finishers more common', () => {
    const count = (rage: boolean) => {
      const s = make(123);
      let n = 0;
      for (let i = 0; i < 20000; i++) {
        const r = s.pick(i % 3, rage).finisher.rarity;
        if (r === 'rare' || r === 'legendary') n++;
      }
      return n;
    };
    expect(count(true)).toBeGreaterThan(count(false) * 1.4);
  });

  it('a kill streak only picks rare and legendary finishers, never the same twice running', () => {
    const s = make(5);
    let last = '';
    for (let i = 0; i < 200; i++) {
      const f = s.pickTop(1).finisher;
      expect(['rare', 'legendary']).toContain(f.rarity);
      expect(f.id).not.toBe(last);
      last = f.id;
    }
  });

  it('is deterministic per seed and survives a one-item catalog', () => {
    const a = make(42), b = make(42);
    for (let i = 0; i < 100; i++) expect(a.pick(i % 3, i % 5 === 0)).toEqual(b.pick(i % 3, i % 5 === 0));
    const one = new FinisherSelector([{ id: 'only', name: 'Only', rarity: 'common', duration: 1 }], config.finishers, 1);
    expect(one.pick(1, false).finisher.id).toBe('only');
    expect(one.pick(1, false).finisher.id).toBe('only');
  });
});
