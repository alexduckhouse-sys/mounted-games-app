import { describe, expect, it } from 'vitest';
import { decDraftKey, readDecDraft } from './decForm';
import { isUnder18 } from './riderPrivacy';
import { updateChatMessage, pinnedAnnouncement, sentAnnouncements, tickerAnnouncements } from './announcements';
import { chat } from '../test/factories';
import { readSavedCopy, writeSavedCopy } from '../offline/savedCopies';
import { venueMapUrl } from '../pages/competition/eventDetailRows';

describe('security handoff regressions', () => {
  it('isolates drafts by account and rejects missing, expired, future and mismatched ownership', () => {
    const now = Date.UTC(2026, 9, 29);
    const key = decDraftKey(1, 2, 'fake-user-a');
    const draft = { userId: 'fake-user-a', savedAt: now, teamId: 2, slots: [null, null], phone: '07700 900000' };
    localStorage.setItem(key, JSON.stringify(draft));
    expect(readDecDraft(1, 2, 1, 'fake-user-a', now)?.teamId).toBe(2);
    expect(readDecDraft(1, 2, 1, 'fake-user-b', now)).toBeNull();
    expect(readDecDraft(1, 2, 1, undefined, now)).toBeNull();
    for (const invalid of [{ ...draft, savedAt: now - 86400000 }, { ...draft, savedAt: now + 1 }, { ...draft, userId: 'fake-user-b' }, { ...draft, savedAt: undefined }, { ...draft, teamId: 3 }]) {
      localStorage.setItem(key, JSON.stringify(invalid));
      expect(readDecDraft(1, 2, 1, 'fake-user-a', now)).toBeNull();
      expect(localStorage.getItem(key)).toBeNull();
    }
    localStorage.setItem('mg.draft.decform.v2:1:2', JSON.stringify(draft));
    expect(readDecDraft(1, 2, 1, 'fake-user-a', now)).toBeNull();
    expect(localStorage.getItem('mg.draft.decform.v2:1:2')).toBeNull();
  });

  it('uses the birthday boundary and rejects future or impossible dates', () => {
    const now = new Date(2026, 9, 29);
    expect(isUnder18('2008-10-30', now)).toBe(true);
    expect(isUnder18('2008-10-29', now)).toBe(false);
    expect(isUnder18('2008-10-28', now)).toBe(false);
    expect(isUnder18('2026-10-30', now)).toBe(false);
    expect(isUnder18('2020-02-31', now)).toBe(false);
    expect(isUnder18('', now)).toBe(false);
  });

  it('updates an existing announcement pin without copying its text or exposing private messages', () => {
    const first = chat(1, { tag: 'pinned' });
    const second = chat(2, { body: 'Same words', tag: null });
    const next = updateChatMessage([first, second], { ...second, tag: 'pinned' });
    expect(next).toHaveLength(2);
    expect(next[0].tag).toBeNull();
    expect(pinnedAnnouncement(next)?.id).toBe(2);
    expect(sentAnnouncements(next).map((m) => m.id)).toEqual([1]);
    const hidden = chat(3, { adminOnly: true, tag: 'pinned' });
    expect(tickerAnnouncements([...next, hidden]).map((m) => m.id)).toEqual([1, 2]);
    expect(pinnedAnnouncement([{ ...hidden, recipientUserId: 'fake-user' }])).toBeNull();
  });

  it('removes private payment links from new and legacy offline copies', () => {
    writeSavedCopy('competition.1', { id: 1, paymentLinkUrl: 'https://example.test/private' });
    expect(readSavedCopy('competition.1')?.data).toEqual({ id: 1 });
    localStorage.setItem('mg.saved.v1.competition.2', JSON.stringify({ savedAt: new Date().toISOString(), data: { id: 2, paymentDestination: 'fake details', paymentLinkUrl: 'https://example.test/private' } }));
    expect(readSavedCopy('competition.2')?.data).toEqual({ id: 2 });
    expect(localStorage.getItem('mg.saved.v1.competition.2')).not.toContain('private');
  });

  it('rejects unsafe venue links and keeps a safe coordinate fallback', () => {
    for (const appleMapsUrl of ['javascript:alert(1)', 'data:text/html,hi', 'http://example.test', 'https://name:pass@example.test', 'https://example.test/' + 'a'.repeat(500)]) {
      expect(venueMapUrl({ appleMapsUrl, latitude: null, longitude: null })).toBeNull();
      expect(venueMapUrl({ appleMapsUrl, latitude: 51, longitude: -1 })).toMatch(/^https:\/\//);
    }
    expect(venueMapUrl({ appleMapsUrl: 'https://maps.apple.com/?q=Test', latitude: null, longitude: null })).toBe('https://maps.apple.com/?q=Test');
  });
});
