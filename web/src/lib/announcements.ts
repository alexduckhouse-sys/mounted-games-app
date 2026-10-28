import { activeLocale } from '../i18n/translate.ts';
import type { ChatMessage } from '../types';

/** Tag on the copy of an announcement that is pinned: it is the notice on the bar at the top of the event. */
export const BANNER_TAG = 'banner';

const byTime = (a: ChatMessage, b: ChatMessage) =>
  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id;

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(activeLocale(), { hour: '2-digit', minute: '2-digit' });
}

const isPublicAnnouncement = (message: ChatMessage) =>
  message.type === 2 && !message.adminOnly && !message.recipientUserId;

/** The announcement pinned to the top of the event, if any (the newest banner). */
export function pinnedAnnouncement(messages: ChatMessage[]): ChatMessage | null {
  return messages.filter((m) => isPublicAnnouncement(m) && m.tag === BANNER_TAG).sort(byTime).at(-1) ?? null;
}

/** Every banner copy, so pinning a new one or unpinning can clear the old ones. */
export function bannerMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => isPublicAnnouncement(m) && m.tag === BANNER_TAG);
}

/**
 * Announcements already sent, newest first. The pinned one is left out (it shows under Pinned), and so are ring calls,
 * which clear themselves when the heat starts.
 */
export function sentAnnouncements(messages: ChatMessage[]): ChatMessage[] {
  const sent = messages
    .filter((m) => isPublicAnnouncement(m) && m.tag !== BANNER_TAG && !m.tag?.startsWith('missing-team'))
    .sort(byTime);
  const pinned = pinnedAnnouncement(messages);
  const pinnedSource = pinned ? sent.findLast((m) => m.body === pinned.body) : undefined;
  return sent.filter((m) => m !== pinnedSource).reverse();
}

/** The announcements the ticker shows: every one in the list, with only the newest banner copy, which goes last. */
export function tickerAnnouncements(messages: ChatMessage[]): ChatMessage[] {
  const announcements = messages.filter((message) => message.type === 2);
  const activeBanner = announcements.filter((message) => message.tag === BANNER_TAG).at(-1);
  return [...announcements.filter((message) => message.tag !== BANNER_TAG), ...(activeBanner ? [activeBanner] : [])];
}

/** The pinned banner stays on the ticker for as long as it is pinned, so it counts as just sent. */
export function bannerAsNew(announcements: ChatMessage[], now: Date): ChatMessage[] {
  const activeBanner = announcements.filter((message) => message.tag === BANNER_TAG).at(-1);
  return activeBanner
    ? announcements.map((message) => message.id === activeBanner.id ? { ...message, createdAt: now.toISOString() } : message)
    : announcements;
}

export function sentLabel(message: ChatMessage, justSentId: number | null): string {
  return message.id === justSentId ? 'Sent just now' : `Sent ${clockTime(message.createdAt)}`;
}

export interface MessageThread {
  userId: string;
  name: string;
  lastBody: string;
  lastAt: string;
  /** Messages from them that are newer than `seenAt`. */
  unread: number;
}

/** The private messages as one thread per person, most recent first. `seen` maps a person to when you last opened their thread. */
export function messageThreads(messages: ChatMessage[], seen: Record<string, string> = {}): MessageThread[] {
  const byPerson = new Map<string, ChatMessage[]>();
  for (const message of messages) {
    if (!message.adminOnly) continue;
    const person = message.recipientUserId ?? message.userId;
    if (!person) continue;
    byPerson.set(person, [...(byPerson.get(person) ?? []), message]);
  }
  return [...byPerson.entries()].map(([userId, thread]) => {
    const ordered = thread.slice().sort(byTime);
    const theirs = ordered.filter((m) => !m.recipientUserId);
    const last = ordered[ordered.length - 1];
    const seenAt = seen[userId] ? new Date(seen[userId]).getTime() : 0;
    return {
      userId,
      name: theirs[0]?.authorName || 'Entrant',
      lastBody: last.body,
      lastAt: last.createdAt,
      unread: theirs.filter((m) => new Date(m.createdAt).getTime() > seenAt).length,
    };
  }).sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
}

/** The messages in one person's thread, oldest first. */
export function threadMessages(messages: ChatMessage[], userId: string): ChatMessage[] {
  return messages
    .filter((m) => m.adminOnly && (m.recipientUserId ? m.recipientUserId === userId : m.userId === userId))
    .sort(byTime);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

const seenKey = (competitionId: number) => `mg.threadSeen.${competitionId}`;

export function readSeen(competitionId: number): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(seenKey(competitionId)) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch { return {}; }
}

export function markSeen(competitionId: number, userId: string, at: string) {
  try { localStorage.setItem(seenKey(competitionId), JSON.stringify({ ...readSeen(competitionId), [userId]: at })); }
  catch { /* storage blocked */ }
}
