import { describe, expect, it, vi } from 'vitest';
import { clearEntryDraft, ENTRY_DRAFT_LIFETIME, entryDraftKey, readEntryDraft, saveEntryDraft, type EntryDraft } from './entryDraft';

const key = entryDraftKey('fictional-account', 1, 5, 'standard');
const details: EntryDraft = {
  fullName: 'Example Entrant', club: 'Fictional Pony Club', contact: '', email: 'example@example.test',
  teamName: 'Example Team', wholeTeam: false, lookingForGuestRiders: false, teamsCount: 1,
  stablesCount: 0, stablingClubOrTeam: '', useInitialOnly: false, noFilming: true, requestId: 'example-request',
};

describe('entry drafts', () => {
  it('keeps account, event, section and entry type separate, including punctuation in account ids', () => {
    saveEntryDraft(key, details);
    expect(readEntryDraft(key)).toEqual(details);
    for (const other of [entryDraftKey('other-account', 1, 5, 'standard'), entryDraftKey('fictional-account', 2, 5, 'standard'),
      entryDraftKey('fictional-account', 1, 6, 'standard'), entryDraftKey('fictional-account', 1, 5, 'guest'), entryDraftKey('fictional-account:1', 1, 5, 'standard')]) {
      expect(readEntryDraft(other)).toBeNull();
    }
  });

  it('stores only form fields and the retry id, never terms or marketing consent', () => {
    saveEntryDraft(key, { ...details, agreed: true, acceptTerms: true, optIn: true } as EntryDraft);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ savedAt: expect.any(Number), details });
  });

  it('expires and removes abandoned drafts after seven days, including other accounts and events', () => {
    const now = Date.now();
    saveEntryDraft(key, details, now);
    expect(readEntryDraft(key, now + ENTRY_DRAFT_LIFETIME - 1)).toEqual(details);
    expect(readEntryDraft('unrelated', now + ENTRY_DRAFT_LIFETIME)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it.each(['{', 'null', '{}', JSON.stringify({ savedAt: Date.now(), details: { ...details, teamsCount: 50 } }),
    JSON.stringify({ savedAt: Date.now(), details: { ...details, requestId: null } }),
    JSON.stringify({ savedAt: Date.now(), details: { ...details, fullName: {} } }),
    JSON.stringify({ savedAt: Date.now(), details: { ...details, stablesCount: -1 } }),
    JSON.stringify({ savedAt: Date.now() + 100000, details })])('ignores invalid stored data: %s', (raw) => {
    localStorage.setItem(key, raw);
    expect(readEntryDraft(key)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('clears only the confirmed entry', () => {
    const other = entryDraftKey('fictional-account', 2, 5, 'standard');
    saveEntryDraft(key, details);
    saveEntryDraft(other, details);
    clearEntryDraft(key);
    expect(readEntryDraft(key)).toBeNull();
    expect(readEntryDraft(other)).toEqual(details);
  });

  it('handles unavailable or full storage without breaking the form', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(saveEntryDraft(key, details)).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readEntryDraft(key)).toBeNull();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => clearEntryDraft(key)).not.toThrow();
  });
});
