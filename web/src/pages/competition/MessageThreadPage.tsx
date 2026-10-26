import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import { Link, useParams } from 'react-router-dom';
import { useCompetition } from './context';
import { useChatFeed } from './useChatFeed';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { problemMessage } from '../../lib/apiError';
import { BUBBLE_IN, BUBBLE_SHOWN, BUBBLE_SPRING } from '../../lib/motion';
import { useStillMotion } from '../../lite/useStillMotion';
import { clockTime, markSeen, messageThreads, threadMessages } from '../../lib/announcements';
import { accountKind, type AdminUser, type BlockedAccount } from '../admin/accountAccessTypes';
import { RefineFoot, RefinePage } from '../refine/Refine';
import type { ChatMessage } from '../../types';
import './announcements.css';

/** One private conversation between the organisers and a person who messaged them. */
export function MessageThreadPage() {
  const { user } = useAuth();
  const session = user ? `${user.id}:${[...user.roles].sort().join(',')}` : 'signed-out';
  const { userId = '' } = useParams();
  return <ThreadSession key={`${session}:${userId}`} userId={userId} />;
}

function ThreadSession({ userId }: { userId: string }) {
  const { competition } = useCompetition();
  const feed = useChatFeed(competition.id, 'Couldn’t load the messages. Check your signal and try again.');
  const [body, setBody] = useState('');
  const still = useStillMotion();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ text: string; retry?: () => void } | null>(null);
  const [blocked, setBlocked] = useState<boolean | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const busy = useRef(false);

  const thread = threadMessages(feed.messages, userId);
  const person = messageThreads(feed.messages).find((item) => item.userId === userId);
  const name = person?.name ?? 'Message';
  const team = competition.teams.find((item) => item.trainerUserId === userId)?.displayName;
  const lastAt = thread.at(-1)?.createdAt;

  // Opening a thread reads it.
  useEffect(() => { if (lastAt) markSeen(competition.id, userId, lastAt); }, [competition.id, userId, lastAt]);

  useEffect(() => {
    let cancelled = false;
    api.get<BlockedAccount[]>('/admin/blocked-users')
      .then(({ data }) => { if (!cancelled) setBlocked(Array.isArray(data) && data.some((account) => account.id === userId)); })
      .catch(() => { if (!cancelled) setBlocked(false); });
    return () => { cancelled = true; };
  }, [userId]);

  // The role comes from the account itself; a trainer with a team in this event is known without asking.
  useEffect(() => {
    if (!person?.name || team) return;
    let cancelled = false;
    api.get<AdminUser[]>('/admin/users', { params: { q: person.name } })
      .then(({ data }) => {
        const match = Array.isArray(data) ? data.find((account) => account.id === userId) : undefined;
        if (!cancelled && match) setKind(accountKind(match.roles));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [person?.name, team, userId]);

  const chip = team ? `Trainer, ${team}` : kind;

  async function block() {
    if (!(await confirmDialog({ title: `Block ${name}?`, message: 'They can’t sign in, enter competitions or post in chat.', confirmLabel: 'Block account', destructive: true }))) return;
    setWorking(true);
    setError(null);
    try {
      await api.post(`/admin/users/${encodeURIComponent(userId)}/block`, { reason: null });
      setBlocked(true);
    } catch (caught) { setError({ text: problemMessage(caught, `Couldn’t block ${name}. Check your signal and try again.`) }); }
    finally { setWorking(false); }
  }

  async function unblock() {
    setWorking(true);
    setError(null);
    try {
      await api.delete(`/admin/users/${encodeURIComponent(userId)}/block`);
      setBlocked(false);
    } catch (caught) { setError({ text: problemMessage(caught, `Couldn’t unblock ${name}. Check your signal and try again.`), retry: () => void unblock() }); }
    finally { setWorking(false); }
  }

  async function send() {
    const text = body.trim();
    if (!text || busy.current) return;
    busy.current = true;
    setSending(true);
    setError(null);
    try {
      const { data } = await api.post<ChatMessage>(`/competitions/${competition.id}/chat`, { body: text, replyToUserId: userId });
      if (data) feed.add(data);
      setBody((current) => current.trim() === text ? '' : current);
    } catch {
      setError({ text: 'Couldn’t send that message. Check your signal and try again.', retry: () => void send() });
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  return (
    <RefinePage className="ann-page ann-thread-page">
      <header className="rf-hd">
        <div className="rf-hd-top">
          <Link className="rf-ib" to={`/competitions/${competition.id}/announcements`} aria-label="Back to announcements"><ChevronLeft className="h-5 w-5" aria-hidden="true" /></Link>
          <span className="rf-ctx">{competition.name}</span>
        </div>
        <div className="ann-title-row">
          <h1 className="rf-ttl">{name}</h1>
          {blocked === false && <button type="button" className="ann-red ann-red-on-navy" disabled={working} onClick={() => void block()}>Block</button>}
        </div>
      </header>

      <div className="ann-body ann-thread-body">
        {chip && <span className="ann-chip">{chip}</span>}
        {error && <Notice actionLabel={error.retry ? 'Try again' : undefined} onAction={error.retry}>{error.text}</Notice>}
        {!error && feed.error && <Notice actionLabel="Try again" onAction={feed.load}>{feed.error}</Notice>}

        {blocked && (
          <Notice tone="info" actionLabel="Unblock" onAction={() => void unblock()} actionDisabled={working}>
            You’ve blocked {name}. They can’t message, post in chat or enter.
          </Notice>
        )}

        <ol className="ann-messages" aria-label={`Messages with ${name}`}>
          {/* Messages there when the thread loads stay put; one sent or received after that pops up from its side. */}
          {thread.map((message) => (
            <motion.li key={message.id} className={`ann-bubble ${message.recipientUserId ? 'ann-bubble-out' : 'ann-bubble-in'}`}
              initial={still || feed.loading ? false : BUBBLE_IN} animate={BUBBLE_SHOWN} transition={BUBBLE_SPRING}
              style={{ transformOrigin: message.recipientUserId ? 'bottom right' : 'bottom left' }}>
              <span>{message.body}</span>
              <time dateTime={message.createdAt}>{clockTime(message.createdAt)}</time>
            </motion.li>
          ))}
        </ol>
      </div>

      {!blocked && (
        <RefineFoot aboveTabs>
          <form className="ann-input" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <input aria-label="Message" placeholder="Message" value={body} onChange={(event) => setBody(event.target.value)} />
            <button type="submit" className="ann-send ann-send-small" aria-label="Send" disabled={!body.trim() || sending}>
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </form>
        </RefineFoot>
      )}
    </RefinePage>
  );
}
