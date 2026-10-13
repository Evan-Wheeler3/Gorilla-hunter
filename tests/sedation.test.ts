import { describe, expect, it, beforeEach } from 'vitest';
import { config } from '../src/core/config';
import { SedationMeter } from '../src/core/sedation';

const stats = config.sedation;

describe('SedationMeter', () => {
  let meter: SedationMeter;
  beforeEach(() => (meter = new SedationMeter(stats)));
  const half = stats.maxSedation / 2;

  it('drops a gorilla with one dart (owner rule)', () => {
    expect(meter.add(stats.dartSedation)).toBe(true);
    expect(meter.state).toBe('collapsed');
    expect(meter.remainingDowntime).toBe(stats.collapseSeconds);
  });

  it('holds a partial dose, then wears it off', () => {
    meter.add(half);
    meter.tick(stats.decayDelaySeconds);
    expect(meter.value).toBe(half);
    meter.tick(0.2);
    expect(meter.value).toBeCloseTo(half - stats.decayPerSecond * 0.2, 4);
    meter.tick(10);
    expect(meter.value).toBe(0);
  });

  it('splits hold and decay inside one tick', () => {
    meter.add(half);
    meter.tick(stats.decayDelaySeconds + 0.2);
    expect(meter.value).toBeCloseTo(half - stats.decayPerSecond * 0.2, 4);
  });

  it('two partial doses inside the hold knock out', () => {
    meter.add(half);
    meter.tick(stats.decayDelaySeconds * 0.9);
    expect(meter.add(half)).toBe(true);
  });

  it('slows in proportion to the meter', () => {
    expect(meter.speedMultiplier).toBe(1);
    meter.add(half);
    expect(meter.speedMultiplier).toBeCloseTo(1 - stats.maxSlow * 0.5);
  });

  it('ignores darts and does not decay while down', () => {
    meter.add(stats.dartSedation);
    expect(meter.add(stats.dartSedation)).toBe(false);
    meter.tick(5);
    expect(meter.value).toBe(stats.maxSedation);
    expect(meter.remainingDowntime).toBeCloseTo(stats.collapseSeconds - 5);
  });

  it('wakes after the knockout with an empty meter', () => {
    meter.add(stats.dartSedation);
    expect(meter.tick(stats.collapseSeconds - 1)).toBe('none');
    expect(meter.tick(1.5)).toBe('woke');
    expect(meter.state).toBe('awake');
    expect(meter.value).toBe(0);
  });

  it('binding sets the knockout to the bound duration, once', () => {
    expect(meter.bind()).toBe(false);
    meter.add(stats.dartSedation);
    meter.tick(5);
    expect(meter.bind()).toBe(true);
    expect(meter.state).toBe('bound');
    expect(meter.remainingDowntime).toBe(stats.boundSeconds);
    expect(meter.bind()).toBe(false);
  });

  it('slaps knock time off and enough of them wake the gorilla', () => {
    meter.add(stats.dartSedation);
    expect(meter.slap()).toBe('none');
    expect(meter.remainingDowntime).toBe(stats.collapseSeconds - stats.slapWakeSeconds);
    let slaps = 1;
    while (meter.isDown && slaps < 100) {
      meter.slap();
      slaps++;
    }
    expect(slaps).toBe(Math.ceil(stats.collapseSeconds / stats.slapWakeSeconds));
    expect(meter.slap()).toBe('none');
  });

  it('runs the knockout clock slower while dragged', () => {
    meter.add(stats.dartSedation);
    meter.tick(10, stats.draggedDowntimeRate);
    expect(meter.remainingDowntime).toBeCloseTo(stats.collapseSeconds - 10 * stats.draggedDowntimeRate);
  });
});
