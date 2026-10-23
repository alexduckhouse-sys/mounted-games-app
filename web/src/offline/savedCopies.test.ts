import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isNoticeablyOld, lastUpdatedText, LIVE_SAVED_COPY_NOTICE_AFTER_MS, readSavedCopy, SAVED_COPY_NOTICE_AFTER_MS, savedCopyKeys,
  serviceWorkerSavedAt, shouldNoticeSavedCopy, writeSavedCopy,
} from './savedCopies';

describe('saved copy notice thresholds', () => {
  const now = new Date(2026, 9, 23, 15, 0);
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  it('uses 30 minutes in general and 10 for live event pages', () => {
    expect(SAVED_COPY_NOTICE_AFTER_MS).toBe(30 * 60_000);
    expect(LIVE_SAVED_COPY_NOTICE_AFTER_MS).toBe(10 * 60_000);
  });

  it('is old only once past the threshold', () => {
    expect(isNoticeablyOld(ago(29), now)).toBe(false);
    expect(isNoticeablyOld(ago(30), now)).toBe(false);
    expect(isNoticeablyOld(ago(31), now)).toBe(true);
    expect(isNoticeablyOld(ago(11), now, LIVE_SAVED_COPY_NOTICE_AFTER_MS)).toBe(true);
    expect(isNoticeablyOld(ago(9), now, LIVE_SAVED_COPY_NOTICE_AFTER_MS)).toBe(false);
  });

  it('reads ISO strings and millisecond times, and never calls an undated copy old by itself', () => {
    expect(isNoticeablyOld(ago(60).toISOString(), now)).toBe(true);
    expect(isNoticeablyOld(ago(60).getTime(), now)).toBe(true);
    for (const undated of [null, undefined, '', 'later']) expect(isNoticeablyOld(undated, now)).toBe(false);
  });

  it('needs a failed refresh as well as an old copy', () => {
    expect(shouldNoticeSavedCopy(ago(60), false, now)).toBe(false);
    expect(shouldNoticeSavedCopy(ago(5), true, now)).toBe(false);
    expect(shouldNoticeSavedCopy(ago(60), true, now)).toBe(true);
  });

  it('counts an undated copy as old only when the refresh failed', () => {
    expect(shouldNoticeSavedCopy(null, false, now)).toBe(false);
    expect(shouldNoticeSavedCopy('', true, now)).toBe(true);
  });

  it('words the time: clock time today, date and time on an earlier day, "earlier" when undated', () => {
    expect(lastUpdatedText(new Date(2026, 9, 23, 14, 5), now)).toBe('Last updated 14:05');
    expect(lastUpdatedText(new Date(2026, 9, 21, 9, 30), now)).toBe('Last updated 21 Oct, 09:30');
    expect(lastUpdatedText(null, now)).toBe('Last updated earlier');
  });
});

const PREFIX = 'mg.saved.v1.';
const INDEX = `${PREFIX}index`;
const index = () => JSON.parse(localStorage.getItem(INDEX) ?? 'null') as string[] | null;
const stored = (key: string) => localStorage.getItem(PREFIX + key);

describe('readSavedCopy', () => {
  it('returns nothing when no copy was saved', () => {
    expect(readSavedCopy('competition.1')).toBeNull();
  });

  it('returns what writeSavedCopy saved, with when it was saved', () => {
    writeSavedCopy('competition.1', { name: 'Spring' }, new Date('2026-06-01T10:00:00Z'));
    expect(readSavedCopy('competition.1')).toEqual({ savedAt: '2026-06-01T10:00:00.000Z', data: { name: 'Spring' } });
  });

  it.each([
    ['not JSON', '{oops'],
    ['not an object', 'null'],
    ['a missing date', JSON.stringify({ data: 1 })],
    ['a non-string date', JSON.stringify({ savedAt: 5, data: 1 })],
    ['an unreadable date', JSON.stringify({ savedAt: 'yesterday-ish', data: 1 })],
    ['missing data', JSON.stringify({ savedAt: '2026-06-01T10:00:00Z' })],
    ['null data', JSON.stringify({ savedAt: '2026-06-01T10:00:00Z', data: null })],
  ])('ignores a saved copy with %s', (_label, raw) => {
    localStorage.setItem(`${PREFIX}k`, raw);
    expect(readSavedCopy('k')).toBeNull();
  });

  it('accepts falsy but present data', () => {
    writeSavedCopy('zero', 0);
    expect(readSavedCopy('zero')?.data).toBe(0);
  });

  it('returns nothing when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readSavedCopy('k')).toBeNull();
  });
});

describe('writeSavedCopy', () => {
  it('records the key in the index, newest last, without duplicating a re-saved key', () => {
    writeSavedCopy('a', 1);
    writeSavedCopy('b', 2);
    writeSavedCopy('a', 3);
    expect(index()).toEqual(['b', 'a']);
    expect(readSavedCopy('a')?.data).toBe(3);
  });

  it('uses the current time unless one is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    writeSavedCopy('a', 1);
    vi.useRealTimers();
    expect(readSavedCopy('a')?.savedAt).toBe('2026-06-01T12:00:00.000Z');
  });

  it('keeps at most 24 copies, dropping the least recently saved', () => {
    for (let i = 0; i < 26; i++) writeSavedCopy(`k${i}`, i);
    expect(index()).toHaveLength(24);
    expect(stored('k0')).toBeNull();
    expect(stored('k1')).toBeNull();
    expect(readSavedCopy('k2')?.data).toBe(2);
    expect(readSavedCopy('k25')?.data).toBe(25);
  });

  it('does not save data that cannot be serialised', () => {
    writeSavedCopy('a', 1);
    writeSavedCopy('big', BigInt(1));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    writeSavedCopy('loop', circular);
    expect(stored('big')).toBeNull();
    expect(stored('loop')).toBeNull();
    expect(index()).toEqual(['a']);
  });

  it('treats a corrupt index as empty', () => {
    localStorage.setItem(INDEX, '{not json');
    writeSavedCopy('a', 1);
    expect(index()).toEqual(['a']);
    localStorage.setItem(INDEX, JSON.stringify({ not: 'an array' }));
    writeSavedCopy('b', 1);
    expect(index()).toEqual(['b']);
    localStorage.setItem(INDEX, JSON.stringify(['ok', 5, null]));
    writeSavedCopy('c', 1);
    expect(index()).toEqual(['ok', 'c']);
  });

  describe('when the storage quota is reached', () => {
    const realSetItem = Storage.prototype.setItem;
    beforeEach(() => {
      // Room for the index plus three copies; anything more throws like a full quota.
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(this: Storage, key: string, value: string) {
        if (this.length >= 4 && this.getItem(key) === null) throw new DOMException('full', 'QuotaExceededError');
        realSetItem.call(this, key, value);
      });
    });

    it('drops the oldest copies one at a time until the new one fits', () => {
      writeSavedCopy('a', 1);
      writeSavedCopy('b', 2);
      writeSavedCopy('c', 3);
      writeSavedCopy('d', 4);
      expect(stored('a')).toBeNull();
      expect(readSavedCopy('d')?.data).toBe(4);
      expect(index()).toEqual(['b', 'c', 'd']);
    });
  });

  it('gives up cleanly when even an empty store cannot hold the copy', () => {
    const realSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(this: Storage, key: string, value: string) {
      if (key === `${PREFIX}huge` || key === `${PREFIX}other`) throw new DOMException('full', 'QuotaExceededError');
      realSetItem.call(this, key, value);
    });
    writeSavedCopy('a', 1);
    writeSavedCopy('huge', 'x');
    expect(stored('huge')).toBeNull();
    expect(stored('a')).toBeNull();
    expect(index()).toEqual([]);
  });

  it('carries on silently when storage is blocked altogether', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => writeSavedCopy('a', 1)).not.toThrow();
  });

  it('carries on silently when the index cannot be written', () => {
    const realSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(this: Storage, key: string, value: string) {
      if (key === INDEX) throw new Error('index blocked');
      realSetItem.call(this, key, value);
    });
    expect(() => writeSavedCopy('a', 1)).not.toThrow();
    expect(readSavedCopy('a')?.data).toBe(1);
  });

  afterEach(() => { vi.restoreAllMocks(); });
});

describe('savedCopyKeys', () => {
  it('builds one stable key per page', () => {
    expect(savedCopyKeys.competition(7)).toBe('competition.7');
    expect(savedCopyKeys.standings(7, 3)).toBe('standings.7.3');
    expect(savedCopyKeys.picker(true)).toBe('picker.past');
    expect(savedCopyKeys.picker(false)).toBe('picker.upcoming');
  });
});

describe('serviceWorkerSavedAt', () => {
  it('is null for an ordinary network response', () => {
    expect(serviceWorkerSavedAt({})).toBeNull();
    expect(serviceWorkerSavedAt({ 'x-mg-saved-copy': '0' })).toBeNull();
  });

  it('gives the time the service worker saved the copy', () => {
    const saved = serviceWorkerSavedAt({ 'x-mg-saved-copy': '1', 'x-mg-saved-at': '2026-06-01T10:00:00.000Z' });
    expect(saved).toEqual(new Date('2026-06-01T10:00:00.000Z'));
  });

  it('says "unknown" when a fallback copy has no readable time', () => {
    expect(serviceWorkerSavedAt({ 'x-mg-saved-copy': '1' })).toBe('unknown');
    expect(serviceWorkerSavedAt({ 'x-mg-saved-copy': '1', 'x-mg-saved-at': 'later' })).toBe('unknown');
  });
});
