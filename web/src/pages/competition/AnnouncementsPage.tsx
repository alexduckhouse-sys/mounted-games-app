import { WhatsAppComposer } from '../operations/WhatsAppComposer';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';
import { useCompetition } from './context';
import { useChatFeed } from './useChatFeed';
import { useAuth } from '../../auth/AuthContext';
import { api, pinChatMessage } from '../../api';
import { Notice } from '../../components/Notice';
import { RefineFoot, RefineHeader, RefineList, RefinePage } from '../refine/Refine';
import {
  clockTime, initials, markSeen, messageThreads, pinnedAnnouncement, readSeen, sentAnnouncements, sentLabel,
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
  const { user, hasRole, canOrganise } = useAuth();
  const { competition } = useCompetition();
  const session = user ? `${user.id}:${[...user.roles].sort().join(',')}` : 'signed-out';
  // Only organisers run announcements and read the inbox; everyone else messages them from the contact page.
  if (!(hasRole('Admin') || canOrganise(competition))) return <Navigate to={`/competitions/${competition.id}/contact`} replace />;
  return <AnnouncementsSession key={session} />;
}

function AnnouncementsSession() {
  const { competition, reload } = useCompetition();
  const { hasRole, canOrganise } = useAuth();
  const isAdmin = hasRole('Admin') || canOrganise(competition);
  const feed = useChatFeed(competition.id, 'Couldn’t load the announcements. Check your signal and try again.');
  const [body, setBody] = useState(() => readDraft(competition.id));
  const [sending, setSending] = useState(false);
  const [justSentId, setJustSentId] = useState<number | null>(null);
  const [error, setError] = useState<{ text: string; retry?: () => void } | null>(null);
  const busy = useRef(false);

  useEffect(() => { writeDraft(competition.id, body); }, [competition.id, body]);
  // The box grows with what is typed, up to about five lines, then scrolls.
  const boxRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, 140)}px`;
  }, [body]);

  const pinned = pinnedAnnouncement(feed.messages);
  const sent = useMemo(() => sentAnnouncements(feed.messages), [feed.messages]);
  const threads = messageThreads(feed.messages, readSeen(competition.id));
  const teamOf = (userId: string) => competition.teams.find((team) => team.trainerUserId === userId)?.displayName;

  async function send() {
    const text = body.trim();
    if (!isAdmin || !text || busy.current) return;
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

  async function pin(target: ChatMessage) {
    if (!isAdmin || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      const { data } = await pinChatMessage(competition.id, target.id);
      if (!data || data.id !== target.id) throw new Error('Invalid announcement response');
      feed.add(data);
    } catch {
      setError({ text: 'Couldn’t pin that announcement. Check your signal and try again.', retry: () => void pin(target) });
    } finally { busy.current = false; reload(); }
  }

  async function unpin() {
    if (!isAdmin || !pinned || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      const { data } = await pinChatMessage(competition.id, pinned.id);
      if (!data || data.id !== pinned.id) throw new Error('Invalid announcement response');
      feed.add(data);
    } catch { setError({ text: 'Couldn’t unpin that. Check your signal and try again.', retry: () => void unpin() }); }
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
            <div key={pinned.id} className="ann-card ann-pinned mg-reveal">
              <p className="ann-text">{pinned.body}</p>
              {isAdmin && <button type="button" className="ann-red" onClick={() => void unpin()}>Unpin</button>}
            </div>
          </section>
        )}

        {sent.length > 0 && (
          <section aria-labelledby="ann-sent">
            <h2 id="ann-sent" className="ann-h">Sent</h2>
            <RefineList label="Sent announcements">
              {sent.map((message) => (
                <li key={message.id} className={`ann-row${message.id === justSentId ? ' mg-arrive' : ''}`}>
                  <span className="ann-grow">
                    <span className="ann-text">{message.body}</span>
                    <span className="ann-meta">{sentLabel(message, justSentId)}</span>
                    <WhatsAppComposer text={`${competition.name}\n\n${message.body}\n\n${location.origin}/competitions/${competition.id}/chat`} />
                  </span>
                  {isAdmin && <button type="button" className="ann-pill" aria-label={`Pin: ${message.body}`} onClick={() => void pin(message)}>Pin</button>}
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
      {/* The box to write a new announcement sits at the foot of the page, like a chat box, so the page reads top down. */}
      {isAdmin && (
        <RefineFoot aboveTabs label="New announcement">
          <form className="ann-compose" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <textarea
              ref={boxRef}
              aria-label="New announcement"
              placeholder="Write an announcement"
              rows={1}
              value={body}
              maxLength={2000}
              onChange={(event) => setBody(event.target.value)}
            />
            <button type="submit" className="ann-send" aria-label="Send" disabled={!body.trim() || sending}>
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </form>
        </RefineFoot>
      )}
    </RefinePage>
  );
}
