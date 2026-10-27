import { describe, expect, it } from 'vitest';
import {
  applyGateCheckTag,
  countHeatAtGate,
  GATE_CHECK_LABELS,
  GATE_CHECK_STATUSES,
  getGateCheckStatus,
  isHeatReadyAtGate,
  nextGateCheckStatus,
  parseGateChecks,
  stripInternalSessionNotes,
} from './gateCheck';

describe('gateCheck helpers', () => {
  it('exposes the three gate check statuses and human labels', () => {
    expect(GATE_CHECK_STATUSES).toEqual(['at-gate', 'warming-up', 'missing']);
    expect(GATE_CHECK_LABELS['at-gate']).toBe('At gate');
    expect(GATE_CHECK_LABELS['warming-up']).toBe('Warming up');
    expect(GATE_CHECK_LABELS.missing).toBe('Missing');
  });

  it('parses and updates gate check tags inside session notes without losing human notes or other tags', () => {
    expect(parseGateChecks(null)).toEqual({});
    expect(parseGateChecks('')).toEqual({});

    let notes: string | null = 'Sponsor: Countryside Feed [paused:2026-06-01T10:00:00Z]';
    notes = applyGateCheckTag(notes, 12, 101, 'at-gate');
    notes = applyGateCheckTag(notes, 12, 102, 'warming-up');
    notes = applyGateCheckTag(notes, 12, 103, 'missing');

    expect(parseGateChecks(notes)).toEqual({
      '12:101': 'at-gate',
      '12:102': 'warming-up',
      '12:103': 'missing',
    });
    expect(getGateCheckStatus(notes, 12, 101)).toBe('at-gate');
    expect(getGateCheckStatus(notes, 12, 999)).toBeNull();

    // Updating an existing lane replaces its tag cleanly
    notes = applyGateCheckTag(notes, 12, 102, 'at-gate');
    expect(getGateCheckStatus(notes, 12, 102)).toBe('at-gate');

    // Clearing a lane removes its tag
    notes = applyGateCheckTag(notes, 12, 103, null);
    expect(getGateCheckStatus(notes, 12, 103)).toBeNull();

    // Clearing the only tag on an otherwise empty note returns null
    const single = applyGateCheckTag(null, 5, 10, 'at-gate');
    expect(single).toBe('[gate:5:10=at-gate]');
    expect(applyGateCheckTag(single, 5, 10, null)).toBeNull();
  });

  it('cycles through gate check statuses in order', () => {
    expect(nextGateCheckStatus(null)).toBe('at-gate');
    expect(nextGateCheckStatus('at-gate')).toBe('warming-up');
    expect(nextGateCheckStatus('warming-up')).toBe('missing');
    expect(nextGateCheckStatus('missing')).toBeNull();
  });

  it('counts lane statuses and detects when all lanes in a heat are at the gate', () => {
    const heat = {
      id: 20,
      entries: [
        { id: 1, teamId: 10, teamName: 'Alpha', laneIndex: 1 },
        { id: 2, teamId: 11, teamName: 'Bravo', laneIndex: 2 },
        { id: 3, teamId: 12, teamName: 'Charlie', laneIndex: 3 },
      ],
    };

    expect(isHeatReadyAtGate(null, { id: 20, entries: [] })).toBe(false);
    expect(isHeatReadyAtGate(null, heat)).toBe(false);

    let notes = applyGateCheckTag(null, 20, 10, 'at-gate');
    notes = applyGateCheckTag(notes, 20, 11, 'warming-up');
    notes = applyGateCheckTag(notes, 20, 12, 'missing');

    expect(countHeatAtGate(notes, heat)).toEqual({
      atGate: 1,
      warmingUp: 1,
      missing: 1,
      total: 3,
    });
    expect(isHeatReadyAtGate(notes, heat)).toBe(false);

    notes = applyGateCheckTag(notes, 20, 11, 'at-gate');
    notes = applyGateCheckTag(notes, 20, 12, 'at-gate');
    expect(isHeatReadyAtGate(notes, heat)).toBe(true);
  });

  it('strips internal session tags while keeping human notes intact', () => {
    expect(stripInternalSessionNotes(null)).toBe('');
    expect(
      stripInternalSessionNotes(
        'Prize giving afterwards [paused:123] [shift:+5] [scoring:live] [gate:20:10=at-gate]',
      ),
    ).toBe('Prize giving afterwards');
  });
});
