import { describe, expect, it } from 'vitest';
import { RING_WINDOW_MIN, ringLabel, ringState } from './heatRing';

const now = new Date('2026-10-26T10:00:00Z');
const inMinutes = (m: number) => new Date(now.getTime() + m * 60_000);

describe('ringState', () => {
  it('stays away more than an hour out, or with no time', () => {
    expect(ringState(inMinutes(61), false, now)).toBeNull();
    expect(ringState(null, false, now)).toBeNull();
    expect(ringState(undefined, false, now)).toBeNull();
  });

  it('empties as the heat comes closer and turns amber in the last five minutes', () => {
    expect(ringState(inMinutes(RING_WINDOW_MIN), false, now)).toEqual({ minutes: 60, fill: 1, tone: 'wait' });
    expect(ringState(inMinutes(30), false, now)).toEqual({ minutes: 30, fill: 0.5, tone: 'wait' });
    expect(ringState(inMinutes(4.2), false, now)).toEqual({ minutes: 5, fill: 5 / 60, tone: 'soon' });
    expect(ringState(inMinutes(-3), false, now)).toEqual({ minutes: 0, fill: 0, tone: 'due' });
  });

  it('is full and live while the heat is on, whatever the clock says', () => {
    expect(ringState(inMinutes(-10), true, now)).toEqual({ minutes: 0, fill: 1, tone: 'live' });
    expect(ringState(null, true, now)?.tone).toBe('live');
  });
});

it('says the ring in words', () => {
  expect(ringLabel({ minutes: 0, fill: 1, tone: 'live' })).toBe('On now');
  expect(ringLabel({ minutes: 0, fill: 0, tone: 'due' })).toBe('Due now');
  expect(ringLabel({ minutes: 1, fill: 1 / 60, tone: 'soon' })).toBe('Starts in 1 minute');
  expect(ringLabel({ minutes: 12, fill: 0.2, tone: 'wait' })).toBe('Starts in 12 minutes');
});
