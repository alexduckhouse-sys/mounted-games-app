import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chat } from '../test/factories';
import {
  bannerAsNew, bannerMessages, clockTime, initials, markSeen, messageThreads, pinnedAnnouncement, readSeen, sentAnnouncements, sentLabel, threadMessages, tickerAnnouncements,
} from './announcements';

const at = (minutes: number) => new Date(Date.UTC(2026, 5, 1, 12, minutes)).toISOString();

describe('announcements', () => {
  beforeEach(() => localStorage.clear());

  it('gives the ticker every announcement, with only the newest banner copy and that one last', () => {
    const messages = [chat(1, { tag: 'banner' }), chat(2), chat(3, { type: 0 }), chat(4, { tag: 'banner' }), chat(5)];
    expect(tickerAnnouncements(messages).map((m) => m.id)).toEqual([2, 5, 4]);
    expect(tickerAnnouncements([chat(2)]).map((m) => m.id)).toEqual([2]);
  });

  it('counts the pinned banner as just sent, leaving the others as they were', () => {
    const now = new Date(at(30));
    const fresh = bannerAsNew([chat(1, { createdAt: at(0) }), chat(2, { tag: 'banner', createdAt: at(1) })], now);
    expect(fresh.map((m) => m.createdAt)).toEqual([at(0), now.toISOString()]);
    const plain = [chat(1, { createdAt: at(0) })];
    expect(bannerAsNew(plain, now)).toBe(plain);
  });

  it('finds the newest pinned banner and lists every banner copy', () => {
    const messages = [chat(1, { tag: 'banner', createdAt: at(0) }), chat(2, { tag: 'banner', createdAt: at(5) }), chat(3, { createdAt: at(9) }), chat(4, { tag: 'banner', adminOnly: true })];
    expect(pinnedAnnouncement(messages)?.id).toBe(2);
    expect(bannerMessages(messages).map((m) => m.id)).toEqual([1, 2]);
    expect(pinnedAnnouncement([chat(3)])).toBeNull();
  });

  it('lists sent announcements newest first, without the pinned one, banners, ring calls or private messages', () => {
    const messages = [
      chat(1, { body: 'Lunch at one', createdAt: at(1) }),
      chat(2, { body: 'Finals at four', createdAt: at(2) }),
      chat(3, { body: 'Finals at four', tag: 'banner', createdAt: at(3) }),
      chat(4, { body: 'Ring call', tag: 'missing-team:3', createdAt: at(4) }),
      chat(5, { body: 'Chat', type: 0, createdAt: at(5) }),
      chat(6, { body: 'Private', adminOnly: true, createdAt: at(6) }),
      chat(7, { body: 'Parking', createdAt: at(7) }),
    ];
    expect(sentAnnouncements(messages).map((m) => m.id)).toEqual([7, 1]);
  });

  it('keeps everything in Sent when nothing is pinned', () => {
    expect(sentAnnouncements([chat(1, { createdAt: at(1) }), chat(2, { createdAt: at(1) })]).map((m) => m.id)).toEqual([2, 1]);
  });

  it('labels the announcement just sent', () => {
    const message = chat(1, { createdAt: at(5) });
    expect(sentLabel(message, 1)).toBe('Sent just now');
    expect(sentLabel(message, null)).toBe(`Sent ${clockTime(message.createdAt)}`);
  });

  it('groups private messages into threads with unread counts', () => {
    const messages = [
      chat(1, { adminOnly: true, userId: 'u1', authorName: 'Pat Rider', body: 'Hello', createdAt: at(1) }),
      chat(2, { adminOnly: true, userId: 'admin', recipientUserId: 'u1', authorName: 'Org', body: 'Hi Pat', createdAt: at(2) }),
      chat(3, { adminOnly: true, userId: 'u1', authorName: 'Pat Rider', body: 'Thanks', createdAt: at(3) }),
      chat(4, { adminOnly: true, userId: 'u2', authorName: '', body: 'Question', createdAt: at(9) }),
      chat(5, { adminOnly: true, userId: null, body: 'Orphan', createdAt: at(10) }),
      chat(6, { body: 'Public' }),
    ];
    const threads = messageThreads(messages, { u1: at(1) });
    expect(threads.map((t) => [t.userId, t.name, t.lastBody, t.unread])).toEqual([['u2', 'Entrant', 'Question', 1], ['u1', 'Pat Rider', 'Thanks', 1]]);
    expect(messageThreads(messages)[1].unread).toBe(2);
    expect(threadMessages(messages, 'u1').map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it('makes initials', () => {
    expect(initials('Pat Rider')).toBe('PR');
    expect(initials('  anna  ')).toBe('AN');
    expect(initials('Mary Jane Smith')).toBe('MS');
    expect(initials('  ')).toBe('?');
  });

  it('remembers when a thread was last opened, and copes with broken storage', () => {
    expect(readSeen(1)).toEqual({});
    markSeen(1, 'u1', at(5));
    markSeen(1, 'u2', at(6));
    expect(readSeen(1)).toEqual({ u1: at(5), u2: at(6) });
    localStorage.setItem('mg.threadSeen.2', '[1]');
    expect(readSeen(2)).toEqual({});
    localStorage.setItem('mg.threadSeen.3', '{bad');
    expect(readSeen(3)).toEqual({});
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => markSeen(1, 'u3', at(7))).not.toThrow();
    set.mockRestore();
  });
});
