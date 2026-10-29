import { describe, expect, it } from 'vitest';
import { normaliseTeamCsvHeaders } from './teamImportHeaders';
describe('team import headers', () => {
  it('maps team-export aliases without touching quoted data or accents', () => {
    const result = normaliseTeamCsvHeaders('\uFEFF"Pony Club","Class Name","Team Name"\r\n"Demo, Club",Open,Demo A');
    expect(result.csv).toBe('club,section,team\r\n"Demo, Club",Open,Demo A');
    expect(result.mapped).toHaveLength(3);
  });
  it('keeps canonical team exports and rejects ambiguous aliases', () => {
    expect(normaliseTeamCsvHeaders('club,section,suffix\nDemo,Open,A').mapped).toEqual([]);
    expect(() => normaliseTeamCsvHeaders('club,Pony Club,section')).toThrow('same field');
  });
  it('does not turn rider exports into public teams', () => {
    expect(() => normaliseTeamCsvHeaders('Club,Class,Rider Name\nDemo,Open,Example Rider')).toThrow('rider entry sheet');
    expect(() => normaliseTeamCsvHeaders('Rider,Class')).toThrow('rider entry sheet');
    expect(() => normaliseTeamCsvHeaders('Something,Else')).toThrow('Club');
    expect(() => normaliseTeamCsvHeaders('"Club,Section')).toThrow('quote');
  });
});
