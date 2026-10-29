import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useCompetition } from './context';
import { useChatFeed } from './useChatFeed';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { Sheet } from '../../components/Sheet';
import { useT } from '../../i18n/LanguageContext';
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
  const { user, hasRole, canOrganise } = useAuth();
  const { competition } = useCompetition();
  const session = user ? `${user.id}:${[...user.roles].sort().join(',')}` : 'signed-out';
  const { userId = '' } = useParams();
  if (!(hasRole('Admin') || canOrganise(competition))) return <Navigate to={`/competitions/${competition.id}/contact`} replace />;
  return <ThreadSession key={`${session}:${userId}`} userId={userId} />;
}

function ThreadSession({ userId }: { userId: string }) {
  const t = useT();
  const { competition, reload } = useCompetition();
  const { hasRole } = useAuth();
  const canBlock = hasRole('Admin');
  const feed = useChatFeed(competition.id, 'Couldn’t load the messages. Check your signal and try again.');
  const [body, setBody] = useState('');
  const still = useStillMotion();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ text: string; retry?: () => void } | null>(null);
  const [blocked, setBlocked] = useState<boolean | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);

  const thread = threadMessages(feed.messages, userId);
  const person = messageThreads(feed.messages).find((item) => item.userId === userId);
  const name = person?.name ?? 'Message';
  const team = competition.teams.find((item) => item.trainerUserId === userId)?.displayName;
  const lastAt = thread.at(-1)?.createdAt;

  // Opening a thread reads it.
  useEffect(() => { if (lastAt) markSeen(competition.id, userId, lastAt); }, [competition.id, userId, lastAt]);

  useEffect(() => {
    if (!canBlock) return;
    let cancelled = false;
    api.get<BlockedAccount[]>('/admin/blocked-users')
      .then(({ data }) => { if (!cancelled) setBlocked(Array.isArray(data) && data.some((account) => account.id === userId)); })
      .catch(() => { if (!cancelled) setBlocked(false); });
    return () => { cancelled = true; };
  }, [userId, canBlock]);

  // The role comes from the account itself; a trainer with a team in this event is known without asking.
  useEffect(() => {
    if (!canBlock || !person?.name || team) return;
    let cancelled = false;
    api.get<AdminUser[]>('/admin/users', { params: { q: person.name } })
      .then(({ data }) => {
        const match = Array.isArray(data) ? data.find((account) => account.id === userId) : undefined;
        if (!cancelled && match) setKind(accountKind(match.roles));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [canBlock, person?.name, team, userId]);

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

  async function removeMessage(id: number): Promise<boolean> {
    if (!(await confirmDialog({ title: t('site.contact.deleteTitle'), message: t('site.contact.deleteMessage'), confirmLabel: t('site.contact.deleteLabel'), destructive: true }))) return false;
    setError(null);
    try {
      await api.delete(`/competitions/${competition.id}/chat/${id}`);
      feed.remove(id);
      return true;
    } catch {
      setError({ text: t('site.contact.deleteFailed') });
      return false;
    } finally { reload(); }
  }

  async function blockSender(id: number): Promise<boolean> {
    if (!(await confirmDialog({ title: t('site.contact.blockTitle'), message: t('site.contact.blockMessage'), confirmLabel: t('site.contact.blockSender'), destructive: true }))) return false;
    setError(null);
    setNotice(null);
    try {
      const { data } = await api.post<{ alreadyBlocked: boolean; ipAddress: string }>(`/competitions/${competition.id}/chat/${id}/block-author`, {});
      setNotice(data.alreadyBlocked ? t('site.contact.alreadyBlocked', { ip: data.ipAddress }) : t('site.contact.blocked', { ip: data.ipAddress }));
      return true;
    } catch (caught) {
      setError({ text: (caught as { response?: { data?: { message?: string } } }).response?.data?.message ?? t('site.contact.blockFailed') });
      return false;
    }
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
          <Link className="rf-ib" to={`/competitions/${competition.id}/announcements?tab=messages`} aria-label={t('site.contact.backToMessages')}><ChevronLeft className="h-5 w-5" aria-hidden="true" /></Link>
          <span className="rf-ctx">{competition.name}</span>
        </div>
        <div className="ann-title-row">
          <h1 className="rf-ttl">{name}</h1>
          {canBlock && blocked === false && <button type="button" className="ann-red ann-red-on-navy" disabled={working} onClick={() => void block()}>Block</button>}
        </div>
      </header>

      <div className="ann-body ann-thread-body">
        {chip && <span className="ann-chip">{chip}</span>}
        {error && <Notice actionLabel={error.retry ? 'Try again' : undefined} onAction={error.retry}>{error.text}</Notice>}
        {!error && feed.error && <Notice actionLabel="Try again" onAction={feed.load}>{feed.error}</Notice>}

        {notice && <Notice tone="info" onDismiss={() => setNotice(null)} dismissLabel={t('site.contact.dismissNotice')}>{notice}</Notice>}
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
              <button type="button" className="ann-more" aria-label={t('site.contact.moreFor', { body: message.body })} onClick={() => setMenuFor(message)}>⋯</button>
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

      {menuFor && (
        <Sheet title={t('site.contact.thisMessage')} description={menuFor.body.length > 90 ? `${menuFor.body.slice(0, 90)}…` : menuFor.body} onClose={() => setMenuFor(null)}>
          {({ close }) => (
            <div className="kit-acts">
              {canBlock && !menuFor.recipientUserId && (
                <button type="button" className="kit-redtext" onClick={() => { void blockSender(menuFor.id).then((done) => { if (done) close(); }); }}>{t('site.contact.blockSender')}</button>
              )}
              <button type="button" className="kit-redtext" onClick={() => { void removeMessage(menuFor.id).then((done) => { if (done) close(); }); }}>{t('site.contact.deleteLabel')}</button>
            </div>
          )}
        </Sheet>
      )}
    </RefinePage>
  );
}
