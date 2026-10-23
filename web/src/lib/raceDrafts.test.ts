import { describe, expect, it, vi } from 'vitest';
import { readRaceDrafts, writeRaceDraft } from './raceDrafts';

describe('race drafts', () => {
  it('starts empty and keeps each competition apart', () => {
    expect(readRaceDrafts(1)).toEqual({});
    writeRaceDraft(1, 10, ['Bending', 'Bottle']);
    expect(readRaceDrafts(1)).toEqual({ 10: ['Bending', 'Bottle'] });
    expect(readRaceDrafts(2)).toEqual({});
  });

  it('adds a session without losing the others, and forgets one when asked', () => {
    writeRaceDraft(1, 10, ['Bending']);
    expect(writeRaceDraft(1, 11, ['Litter'])).toEqual({ 10: ['Bending'], 11: ['Litter'] });
    expect(writeRaceDraft(1, 10, null)).toEqual({ 11: ['Litter'] });
    expect(writeRaceDraft(1, 11, null)).toEqual({});
    expect(localStorage.getItem('mg.format.races.v1.1')).toBeNull();
  });

  it('ignores anything stored that is not a list of names per session', () => {
    localStorage.setItem('mg.format.races.v1.1', JSON.stringify({ 5: ['Bending'], x: ['Bad id'], 6: [1, 2], 7: 'text' }));
    expect(readRaceDrafts(1)).toEqual({ 5: ['Bending'] });
    localStorage.setItem('mg.format.races.v1.1', '[1,2]');
    expect(readRaceDrafts(1)).toEqual({});
    localStorage.setItem('mg.format.races.v1.1', 'not json');
    expect(readRaceDrafts(1)).toEqual({});
  });

  it('still hands back the list when storage refuses it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(writeRaceDraft(1, 10, ['Bending'])).toEqual({ 10: ['Bending'] });
  });
});
