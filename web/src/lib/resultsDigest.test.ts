import { describe, expect, it } from 'vitest';
import type { ResultsBook } from '../pages/eventTools/resultsBookTypes';
import { resultsDigest } from './resultsDigest';

const book = (): ResultsBook => ({
  competition: { id: 1, name: 'Test Games', location: null, startDate: '2031-05-04T09:00:00Z', endDate: null },
  isProvisional: true, includesPrivate: false, generatedAt: '2031-05-04T18:00:00Z',
  sections: [{
    sectionId: 2, sectionName: 'Test Teams', format: 2,
    standings: [
      { rank: 1, teamId: 3, teamName: 'Test A', clubName: 'Test Club', finalLabel: 'A Final', totalPoints: 12.5, bonusPoints: 0, racesRun: 3, wins: 1, eliminations: 0, withdrawn: false },
      { rank: 1, teamId: 4, teamName: 'Test B', clubName: 'Test Club', finalLabel: 'A Final', totalPoints: 12.5, bonusPoints: 0, racesRun: 3, wins: 1, eliminations: 0, withdrawn: true },
    ],
    finals: [],
    awards: [{ id: 5, competitionSectionId: 2, title: 'Test award', recipient: 'Test A', note: 'Award note' }],
  }],
  eventAwards: [{ id: 6, competitionSectionId: null, title: 'Test event award', recipient: 'Test B', note: null }],
  refereeNotes: [{ sectionName: 'Test Teams', heatLabel: 'Test heat', raceName: 'Test game', teamName: 'Test A', statusLetter: null, note: 'PRIVATE TEST NOTE' }],
});

describe('resultsDigest', () => {
  it('shares public standings in their existing order, retaining ties, finals, half points and withdrawal', () => {
    const text = resultsDigest(book());
    expect(text).toContain('Test Games');
    expect(text).toContain('Provisional results');
    expect(text).toContain('Test Teams\n1. Test A · 12.5 pts · A Final\n1. Test B · 12.5 pts · A Final (withdrawn)');
    expect(text).toContain('Test award: Test A');
    expect(text).toContain('Test event award: Test B');
    expect(text).not.toContain('PRIVATE TEST NOTE');
    expect(text).not.toContain('Award note');
  });

  it('refuses the organiser copy rather than accidentally sharing private data', () => {
    expect(() => resultsDigest({ ...book(), includesPrivate: true })).toThrow('Use the public results book for sharing.');
  });

  it('marks final results and includes an optional official reference', () => {
    const data = book();
    data.isProvisional = false;
    data.competition.competitionNumber = 'TEST-42';
    const text = resultsDigest(data);
    expect(text).toContain('Competition reference: TEST-42');
    expect(text).toContain('Final results');
    expect(text).not.toContain('Provisional');
  });

  it('handles empty events, empty sections and sections without awards', () => {
    expect(resultsDigest({ ...book(), sections: [], eventAwards: [] })).toContain('No results yet.');
    const data = book();
    data.sections[0] = { ...data.sections[0], standings: [], awards: [] };
    expect(resultsDigest(data)).toContain('Test Teams\nNo results yet.');
  });

  it('shares a section without finals without inventing a final label', () => {
    const data = book();
    data.sections[0].standings[0].finalLabel = null;
    expect(resultsDigest(data)).toContain('1. Test A · 12.5 pts\n');
  });

  it('keeps each user-supplied value on one line and omits a blank reference', () => {
    const data = book();
    data.competition.name = ' Test\r\n Games ';
    data.competition.competitionNumber = '  ';
    data.sections[0].sectionName = ' Test\n Teams ';
    const text = resultsDigest(data);
    expect(text).toMatch(/^Test Games\n/);
    expect(text).toContain('Test Teams\n');
    expect(text).not.toContain('Competition reference');
  });
});
