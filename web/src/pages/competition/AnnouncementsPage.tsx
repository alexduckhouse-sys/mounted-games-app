import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCompetition } from './context';
import { useChatFeed } from './useChatFeed';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import { Notice } from '../../components/Notice';
import { RefineHeader, RefineList, RefinePage } from '../refine/Refine';
import {
  BANNER_TAG, bannerMessages, clockTime, initials, markSeen, messageThreads, pinnedAnnouncement, readSeen, sentAnnouncements, sentLabel,
} from '../../lib/announcements';
import type { ChatMessage } from '../../types';
import './announcements.css';

const draftKey = (competitionId: number) => `mg.announceDraft.${competitionId}`;
const readDraft = (competitionId: number) => { try { return localStorage.getItem(draftKey(competitionId)) ?? ''; } catch { return ''; } };
const writeDraft = (competitionId: number, text: string) => {
  try { if (text) localStorage.setItem(draftKey(competitionId), text); else localStorage.removeItem(draftKey(competitionId)); } catch { /* storage blocked */ }
};

/** Organiser page: what is pinned, a box to send a new announcement, what has been sent, and private messages. */
export function AnnouncementsPage() {
  const { user } = useAuth();
  const session = user ? `${user.id}:${[...user.roles].sort().join(',')}` : 'signed-out';
  return <AnnouncementsSession key={session} />;
}

function AnnouncementsSession() {
  const { competition, reload } = useCompetition();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('Admin');
  const feed = useChatFeed(competition.id, 'Couldn’t load the announcements. Check your signal and try again.');
  const [body, setBody] = useState(() => readDraft(competition.id));
  const [sending, setSending] = useState(false);
  const [justSentId, setJustSentId] = useState<number | null>(null);
  const [error, setError] = useState<{ text: string; retry?: () => void } | null>(null);
  const busy = useRef(false);

  useEffect(() => { writeDraft(competition.id, body); }, [competition.id, body]);

  const pinned = pinnedAnnouncement(feed.messages);
  const sent = useMemo(() => sentAnnouncements(feed.messages), [feed.messages]);
  const threads = messageThreads(feed.messages, readSeen(competition.id));
  const teamOf = (userId: string) => competition.teams.find((team) => team.trainerUserId === userId)?.displayName;

  async function send() {
    const text = body.trim();
    if (!text || busy.current) return;
    busy.current = true;
    setSending(true);
    setError(null);
    try {
      const { data } = await api.post<ChatMessage>(`/competitions/${competition.id}/chat/announcement`, { body: text, tag: 'general' });
      if (data && typeof data.id === 'number') { feed.add(data); setJustSentId(data.id); }
      setBody((current) => current.trim() === text ? '' : current);
      reload();
    } catch (caught) {
      setError((caught as { response?: { status?: number } }).response?.status === 403
        ? { text: 'Posting is blocked from this network. Contact an organiser.' }
        : { text: 'Couldn’t send that announcement. Check your signal and try again.', retry: () => void send() });
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  async function clearBanners(banners: ChatMessage[]) {
    await Promise.all(banners.map((banner) => api.delete(`/competitions/${competition.id}/chat/${banner.id}`)));
    banners.forEach((banner) => feed.remove(banner.id));
  }

  async function pin(target: ChatMessage) {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    const previous = bannerMessages(feed.messages);
    try {
      const { data } = await api.post<ChatMessage>(`/competitions/${competition.id}/chat/announcement`, { body: target.body, tag: BANNER_TAG });
      if (!data || typeof data.id !== 'number' || data.tag !== BANNER_TAG) throw new Error('Invalid announcement response');
      feed.add(data);
      try { await clearBanners(previous); }
      catch { setError({ text: 'That announcement is pinned, but the old one couldn’t be cleared. Check your signal and try again.' }); }
    } catch {
      setError({ text: 'Couldn’t pin that announcement. Check your signal and try again.', retry: () => void pin(target) });
    } finally {
      busy.current = false;
      reload();
    }
  }

  async function unpin() {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try { await clearBanners(bannerMessages(feed.messages)); }
    catch { setError({ text: 'Couldn’t unpin that. Check your signal and try again.', retry: () => void unpin() }); feed.load(); }
    finally { busy.current = false; reload(); }
  }

  return (
    <RefinePage className="ann-page">
      <RefineHeader back={`/competitions/${competition.id}/chat`} backLabel="Back to live stream" context={competition.name} title="Announcements" />
      <div className="ann-body">
        {error && <Notice actionLabel={error.retry ? 'Try again' : undefined} onAction={error.retry}>{error.text}</Notice>}
        {!error && feed.error && <Notice actionLabel="Try again" onAction={feed.load}>{feed.error}</Notice>}

        {pinned && (
          <section aria-labelledby="ann-pinned">
            <h2 id="ann-pinned" className="ann-h">Pinned</h2>
            <div className="ann-card ann-pinned">
              <p className="ann-text">{pinned.body}</p>
              <button type="button" className="ann-red" onClick={() => void unpin()}>Unpin</button>
            </div>
          </section>
        )}

        <section aria-labelledby="ann-new">
          <h2 id="ann-new" className="ann-h">New announcement</h2>
          <div className="ann-compose">
            <textarea
              aria-label="New announcement"
              placeholder="Write an announcement"
              value={body}
              maxLength={2000}
              onChange={(event) => setBody(event.target.value)}
            />
            <button type="button" className="ann-send" aria-label="Send" disabled={!body.trim() || sending} onClick={() => void send()}>
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </section>

        {sent.length > 0 && (
          <section aria-labelledby="ann-sent">
            <h2 id="ann-sent" className="ann-h">Sent</h2>
            <RefineList label="Sent announcements">
              {sent.map((message) => (
                <li key={message.id} className="ann-row">
                  <span className="ann-grow">
                    <span className="ann-text">{message.body}</span>
                    <span className="ann-meta">{sentLabel(message, justSentId)}</span>
                  </span>
                  <button type="button" className="ann-pill" aria-label={`Pin: ${message.body}`} onClick={() => void pin(message)}>Pin</button>
                </li>
              ))}
            </RefineList>
          </section>
        )}

        {isAdmin && (
          <section aria-labelledby="ann-messages">
            <h2 id="ann-messages" className="ann-h">Messages</h2>
            <RefineList label="Messages">
              {threads.map((thread) => {
                const team = teamOf(thread.userId);
                return (
                  <li key={thread.userId}>
                    <Link className="ann-thread" to={`/competitions/${competition.id}/messages/${encodeURIComponent(thread.userId)}`} onClick={() => markSeen(competition.id, thread.userId, thread.lastAt)}>
                      <span className="ann-avatar" aria-hidden="true">{initials(thread.name)}</span>
                      <span className="ann-grow">
                        <span className="ann-name">{[thread.name, team].filter(Boolean).join(' · ')}</span>
                        <span className="ann-last">{thread.lastBody}</span>
                      </span>
                      <span className="ann-side">
                        <time dateTime={thread.lastAt}>{clockTime(thread.lastAt)}</time>
                        {thread.unread > 0 && <span className="ann-unread" aria-label={`${thread.unread} unread`}>{thread.unread}</span>}
                      </span>
                    </Link>
                  </li>
                );
              })}
              {threads.length === 0 && <li className="ann-row"><span className="ann-meta">No messages yet</span></li>}
            </RefineList>
          </section>
        )}
      </div>
    </RefinePage>
  );
}
