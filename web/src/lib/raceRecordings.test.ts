import { describe, expect, it } from 'vitest';
import type { SavedReplayClip } from '../live/replayBuffer';
import { heat, race, session } from '../test/factories';
import { groupRaceRecordings } from './raceRecordings';

const clip = (id: string, extra: Partial<SavedReplayClip> = {}): SavedReplayClip => ({
  id, competitionId: 1, arenaName: 'Main Arena', label: id, createdAt: '2026-06-01T10:00:00Z', durationSeconds: 45, mimeType: 'video/webm',
  blob: new Blob(['x']), url: `blob:${id}`, source: 'race', ...extra,
});

const sessions = [
  session(2, { orderIndex: 2, sectionName: 'Under 12', arenaName: 'Main Arena', heats: [heat(21, { orderIndex: 1, races: [race(211, { name: 'Bending' })] })] }),
  session(1, { orderIndex: 1, sectionName: 'Under 12', arenaName: ' Main Arena ', heats: [
    heat(12, { orderIndex: 2, label: 'Final', races: [race(122, { name: 'Mug', orderIndex: 2 }), race(121, { name: 'Bending', orderIndex: 1 })] }),
    heat(11, { orderIndex: 1, races: [race(111, { name: 'Bending' }), race(112, { name: 'Mug' })] }),
    heat(13, { orderIndex: 3, races: [] }),
  ] }),
  session(3, { orderIndex: 3, isBreak: true, kind: 1, heats: [heat(31, { races: [race(311)] })] }),
  session(4, { orderIndex: 4, heats: [] }),
];

describe('groupRaceRecordings', () => {
  it('lists every race by session, heat and race order, with the sessions of an age group numbered', () => {
    const { sessions: grouped, recorded, other } = groupRaceRecordings(sessions, []);
    expect(grouped.map((s) => [s.title, s.arenaName])).toEqual([['Under 12 Session 1', 'Main Arena'], ['Under 12 Session 2', 'Main Arena']]);
    expect(grouped[0].heats.map((h) => [h.title, h.heading, h.races.map((r) => r.race.name)])).toEqual([
      ['Heat 1', 'Under 12 Session 1 · Heat 1', ['Bending', 'Mug']],
      ['Final', 'Under 12 Session 1 · Final', ['Bending', 'Mug']],
    ]);
    expect(grouped[0].heats.flatMap((h) => h.races).every((r) => r.clips.length === 0)).toBe(true);
    expect(recorded).toBe(0);
    expect(other).toEqual([]);
  });

  it('matches a recording to its race by the race it was made for', () => {
    const made = clip('a', { raceId: 112, label: 'anything' });
    const { sessions: grouped, recorded } = groupRaceRecordings(sessions, [made]);
    expect(grouped[0].heats[0].races[1].clips).toEqual([made]);
    expect(grouped[0].heats[0].races[0].clips).toEqual([]);
    expect(recorded).toBe(1);
  });

  it('matches an older recording by its name', () => {
    const old = clip('Under 12 Session 1 · Final · Mug');
    const { sessions: grouped } = groupRaceRecordings(sessions, [old]);
    expect(grouped[0].heats[1].races[1].clips).toEqual([old]);
  });

  it('keeps every recording of a race, newest first, and counts the race once', () => {
    const first = clip('first', { raceId: 111, createdAt: '2026-06-01T09:00:00Z' });
    const second = clip('second', { raceId: 111, createdAt: '2026-06-01T09:30:00Z' });
    const { sessions: grouped, recorded } = groupRaceRecordings(sessions, [first, second]);
    expect(grouped[0].heats[0].races[0].clips.map((c) => c.id)).toEqual(['second', 'first']);
    expect(recorded).toBe(1);
  });

  it('puts recordings that fit no race under other, and ignores clips that are not race recordings', () => {
    const lost = clip('lost', { raceId: 999 });
    const renamed = clip('Under 12 Session 1 · Heat 9 · Bending');
    const instant = clip('Instant replay 10:00', { source: 'instant', raceId: 111 });
    const saved = clip('Cut', { source: undefined });
    const { other, recorded } = groupRaceRecordings(sessions, [lost, renamed, instant, saved]);
    expect(other.map((c) => c.id).sort()).toEqual(['Under 12 Session 1 · Heat 9 · Bending', 'lost']);
    expect(recorded).toBe(0);
  });

  it('is empty for a competition with no sessions', () => {
    expect(groupRaceRecordings([], [])).toEqual({ sessions: [], other: [], recorded: 0 });
  });
});
