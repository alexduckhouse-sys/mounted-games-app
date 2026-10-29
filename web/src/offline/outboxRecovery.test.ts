import { describe, expect, it } from 'vitest';
import { backupFrames, joinBackupFrames, readBackupFrame, recoveryText, scoreBackupPdf } from './outboxRecovery';
import { parseOutboxBackup, serializeOutboxBackup, type QueuedScore } from './scoreOutbox';
const score: QueuedScore = { saveId: 'example-save', raceId: 4, competitionId: 2, sessionId: 3, label: 'Heat 1 · Example race',
  queuedAt: '2026-10-29T10:00:00Z', state: 'waiting', places: [{ teamId: 1, place: 1, eliminated: false, points: 4 }],
  expected: [], teamNames: { 1: 'Équipe exemple' } };
const raw = () => serializeOutboxBackup([score], 2, '2026-10-29T10:00:00Z');
const blobText = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob); });
describe('offline QR recovery', () => {
  it('round trips UTF-8, out-of-order frames and repeated scans without changing conflict expectations or save IDs', () => {
    const data = JSON.stringify({ notes: 'é'.repeat(1000), raw: raw() });
    const frames = backupFrames(data);
    expect(frames.length).toBeGreaterThan(1);
    expect(joinBackupFrames([frames[0]])).toEqual({ received: 1, total: frames.length });
    expect(joinBackupFrames([...frames].reverse().concat(frames[0])).raw).toBe(data);
    expect(parseOutboxBackup(recoveryText(backupFrames(raw()).join('\n')), 2)?.[0]).toMatchObject(score);
  });
  it('refuses mixed, damaged, malformed, oversized and partial backups', () => {
    const frames = backupFrames('a'.repeat(2000));
    expect(() => joinBackupFrames([frames[0], backupFrames('different')[0]])).toThrow(/different backups/);
    expect(() => joinBackupFrames([...frames.slice(0, -1), frames.at(-1)!.slice(0, -1) + 'Z'])).toThrow(/damaged/);
    expect(() => joinBackupFrames([frames[0], frames[0].slice(0, -1) + 'Z'])).toThrow(/damaged/);
    expect(() => readBackupFrame('https://example.test')).toThrow();
    expect(() => readBackupFrame('MG-SCORES-1:12345678:0:1:QQ==')).toThrow();
    expect(() => readBackupFrame('MG-SCORES-1:12345678:1:999:QQ==')).toThrow();
    expect(() => recoveryText(frames[0])).toThrow(/incomplete/);
    expect(() => backupFrames('x'.repeat(500000))).toThrow(/too large/);
    expect(joinBackupFrames([])).toEqual({ received: 0, total: 0 });
    expect(recoveryText(raw())).toBe(raw());
  });
  it('creates a real self-contained PDF whose original backup imports losslessly', async () => {
    const pdf = scoreBackupPdf(raw(), [score], 'Example Event', '2026-10-29T10:00:00Z');
    const text = await blobText(pdf);
    expect(pdf.type).toBe('application/pdf');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('Example Event');
    expect(text).toContain('Place 1 | Points 4');
    expect(text).toContain('Points shown are provisional until synced.');
    expect(text).toContain('/Type /Page');
    expect(text.endsWith('%%EOF')).toBe(true);
    expect(recoveryText(text)).toBe(raw());
    const offset = Number(text.match(/startxref\n(\d+)/)?.[1]);
    expect(text.slice(offset, offset + 4)).toBe('xref');
    expect(parseOutboxBackup(recoveryText(text), 999)).toBeNull();
  });
  it('shows finite provisional points without changing the recoverable score overrides', async () => {
    const queued = { ...score, previewPoints: { 1: 6, 2: 2.5, 3: 0, 4: 20 }, places: [
      ...score.places,
      { teamId: 2, place: 2, eliminated: false },
      { teamId: 3, place: 3, eliminated: false },
      { teamId: 4, place: 0, eliminated: true },
    ] };
    const data = serializeOutboxBackup([queued], 2);
    const text = await blobText(scoreBackupPdf(data, [queued], 'Example Event', 'now'));
    expect(text).toContain('Place 1 | Points 6');
    expect(text).toContain('Place 2 | Points 2.5');
    expect(text).toContain('Place 3 | Points 0');
    expect(text).toContain('Place E | Points 0');
    expect(recoveryText(text)).toBe(data);
    expect(parseOutboxBackup(recoveryText(text), 2)?.[0].places).toEqual(queued.places);
    expect(queued.places[0].points).toBe(4);
    expect(queued.places[1]).not.toHaveProperty('points');
  });
  it.each([NaN, Infinity, -1, '6'])('ignores invalid provisional points %s', async preview => {
    const queued = { ...score, previewPoints: { 1: preview, 2: preview } as Record<number, number>, places: [
      ...score.places, { teamId: 2, place: 2, eliminated: false },
    ] };
    const text = await blobText(scoreBackupPdf(raw(), [queued], 'Example Event', 'now'));
    expect(text).toContain('Place 1 | Points 4');
    expect(text).toContain('Place 2 | Points calculated on sync');
  });
  it('paginates long readable backups and includes eliminated status without inventing points', async () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ ...score, raceId: i + 1, places: [{ teamId: 5, place: 0, eliminated: true, status: 3 }, { teamId: 1, place: 1, eliminated: false }] }));
    const data = serializeOutboxBackup(rows, 2);
    const text = await blobText(scoreBackupPdf(data, rows, '(Example) \\ event', 'now'));
    expect(text).toContain('Place DNF | Points 0');
    expect(text).toContain('calculated on sync');
    expect(recoveryText(text)).toBe(data);
    expect(text.match(/\/Type \/Page /g)!.length).toBeGreaterThan(3);
  });
});
