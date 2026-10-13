import { beforeEach, describe, expect, it } from 'vitest';
import { config, type MatchStats } from '../src/core/config';
import { InfectionRound } from '../src/core/round';

describe('InfectionRound', () => {
  let stats: MatchStats;
  let round: InfectionRound;
  let log: string[];

  const make = (hunters: number[], gorillas: number[]) => {
    round = new InfectionRound(stats, hunters, gorillas, {
      hunterRespawned: (id) => log.push(`respawn ${id}`),
      gorillaConverted: (id) => log.push(`convert ${id}`),
      lastGorillaStanding: (id) => log.push(`last ${id}`),
      ended: (r, why) => log.push(`end ${r} ${why}`),
    });
    round.start();
  };
  const skipBriefing = () => round.tick(stats.briefingSeconds);

  beforeEach(() => {
    stats = { ...config.match };
    log = [];
    make([1], [10, 11, 12]);
  });

  it('runs briefing, head start, hunt, wildfire', () => {
    expect(round.phase).toBe('briefing');
    expect(round.gorillasHeld).toBe(true);
    skipBriefing();
    expect(round.phase).toBe('headStart');
    round.tick(stats.hunterHeadStartSeconds);
    expect(round.phase).toBe('hunt');
    expect(round.gorillasHeld).toBe(false);
    round.tick(stats.fireStartSeconds - stats.hunterHeadStartSeconds);
    expect(round.phase).toBe('wildfire');
  });

  it('carries briefing overshoot into the round clock', () => {
    round.tick(stats.briefingSeconds + 3);
    expect(round.roundTime).toBeCloseTo(3);
  });

  it('gorillas win when the timer runs out', () => {
    skipBriefing();
    for (let i = 0; i < 700; i++) round.tick(1);
    expect(round.result).toBe('gorillasWin');
    expect(round.endReason).toBe('timerExpired');
  });

  it('converts secured gorillas, announces the last one once, and hunters win at zero', () => {
    skipBriefing();
    expect(round.reportGorillaSecured(10)).toBe(true);
    expect(round.aliveHunters.has(10)).toBe(true);
    round.reportGorillaSecured(11);
    expect(round.lastGorilla).toBe(12);
    expect(log.filter((l) => l.startsWith('last'))).toEqual(['last 12']);
    round.reportGorillaSecured(12);
    expect(round.result).toBe('huntersWin');
    expect(round.endReason).toBe('allGorillasConverted');
  });

  it('respawns killed hunters from the shared pool', () => {
    skipBriefing();
    expect(round.reportHunterKilled(1)).toBe(true);
    expect(round.livesRemaining).toBe(stats.sharedHunterLives - 1);
    expect(round.phase).not.toBe('ended');
    round.tick(stats.hunterRespawnSeconds + 0.01);
    expect(round.aliveHunters.has(1)).toBe(true);
    expect(log).toContain('respawn 1');
  });

  it('gorillas win when lives run out and every hunter is dead', () => {
    stats.sharedHunterLives = 1;
    make([1, 2], [10, 11]);
    skipBriefing();
    round.reportHunterKilled(1);
    round.reportHunterKilled(2);
    expect(round.phase).not.toBe('ended');
    round.tick(stats.hunterRespawnSeconds + 0.01);
    round.reportHunterKilled(1);
    expect(round.result).toBe('gorillasWin');
    expect(round.endReason).toBe('huntersEliminated');
  });

  it('ignores reports during briefing, after the end, and for unknown or repeat ids', () => {
    expect(round.reportHunterKilled(1)).toBe(false);
    skipBriefing();
    expect(round.reportHunterKilled(99)).toBe(false);
    expect(round.reportGorillaSecured(10)).toBe(true);
    expect(round.reportGorillaSecured(10)).toBe(false);
    round.reportGorillaSecured(11);
    round.reportGorillaSecured(12);
    expect(round.reportHunterKilled(1)).toBe(false);
  });

  it('hunters win if the last gorilla leaves; a lone gorilla starts raging', () => {
    make([1], [10]);
    expect(log).toContain('last 10');
    round.removePlayer(10);
    expect(round.result).toBe('huntersWin');
  });

  it('rejects bad teams', () => {
    expect(() => new InfectionRound(stats, [1], [1, 2])).toThrow();
    expect(() => new InfectionRound(stats, [], [1])).toThrow();
  });
});
