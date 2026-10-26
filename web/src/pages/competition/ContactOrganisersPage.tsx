import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import { useLiveHub } from '../../live/useLiveHub';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { usePageWidth } from '../../components/pageWidthState';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { Sheet } from '../../components/Sheet';
import { clockTime, initials, markSeen, messageThreads, readSeen, threadMessages } from '../../lib/announcements';
import type { ChatMessage } from '../../types';
import './chat.css';
import '../../components/sitePages.css';
import '../../components/eventPages.css';
import '../clubShop/clubShop.css';

const messageTime = (message: ChatMessage) =>
  new Date(message.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** "Today", "Yesterday" or "Mon 26 Oct": the heading above a day's messages in the thread. */
function dayHeading(iso: string, now = new Date()): string {
  const day = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(day)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** The time on a chat list row: the clock for today, else the day. */
const listTime = (iso: string) => (dayHeading(iso) === 'Today' ? clockTime(iso) : dayHeading(iso));

export function ContactOrganisersPage() {
  const { user } = useAuth();
  const authSession = user ? `${user.id}:${[...user.roles].sort().join(',')}` : 'signed-out';
  return <ContactOrganisersSession key={authSession} />;
}

function ContactOrganisersSession() {
  const { competition, reload } = useCompetition();
  const { user, canEdit, hasRole } = useAuth();
  const isAdmin = hasRole('Admin');
  const canModerate = canEdit();
  const privateMessagingAvailable = competition.staffChatEnabled === true;
  const canMessageOrganisers = !!user && !isAdmin;
  const desktop = useIsDesktop();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // An organiser opens one person's thread from the list: it is kept in the address so Back returns to the list.
  const withId = isAdmin ? params.get('with') : null;
  usePageWidth('narrow');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<{ text: string; retrySend?: boolean } | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);

  const threads = messageThreads(messages, readSeen(competition.id));
  const teamOf = (userId: string) => competition.teams.find((team) => team.trainerUserId === userId)?.displayName;
  const person = withId ? threads.find((thread) => thread.userId === withId) : undefined;
  const personName = person?.name ?? 'Message';
  usePageHeader(isAdmin
    ? withId
      ? { title: personName, subtitle: teamOf(withId) ?? competition.name, plain: true, backTo: location.pathname, backLabel: 'Back to messages' }
      : { title: 'Messages', subtitle: competition.name, plain: true, backTo: `/competitions/${competition.id}/details`, backLabel: 'Back to details' }
    : { title: 'Message the organisers', subtitle: competition.name, plain: true, backTo: `/competitions/${competition.id}/details`, backLabel: 'Back to details' });
  // Go back to where you came from, or to the details when this page was opened directly.
  const goBack = () => (location.key === 'default' ? navigate(`/competitions/${competition.id}/details`) : navigate(-1));

  const requestMessages = useCallback((controller: AbortController) => {
    void api.get<ChatMessage[]>(`/competitions/${competition.id}/chat`, { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setMessages(response.data); })
      .catch(() => { if (!controller.signal.aborted) setMessagesError('Couldn’t load messages. Check your signal and try again.'); })
      .finally(() => { if (!controller.signal.aborted) setMessagesLoading(false); });
  }, [competition.id]);

  const loadMessages = useCallback(() => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setMessagesLoading(true);
    setMessagesError(null);
    requestMessages(controller);
  }, [requestMessages]);

  useEffect(() => {
    const controller = new AbortController();
    loadController.current = controller;
    requestMessages(controller);
    return () => {
      loadController.current?.abort();
      loadController.current = null;
    };
  }, [requestMessages]);

  useLiveHub(competition.id, {
    onReady: loadMessages,
    onChatMessage: (value) => {
      const message = value as ChatMessage;
      if (message.competitionId !== competition.id) return;
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
    },
    onChatMessageDeleted: ({ id }) => setMessages((current) => current.filter((message) => message.id !== id)),
  });

  const mineOrForMe = (message: ChatMessage) => !!user && (message.userId === user.id || message.recipientUserId === user.id);
  const privateMessages = messages
    .filter((message) => message.adminOnly && (isAdmin || mineOrForMe(message)))
    .slice()
    .reverse();
  const thread = withId ? threadMessages(messages, withId) : [];

  // Opening a thread reads it, and so does a new message arriving while it is open.
  const lastAt = thread.at(-1)?.createdAt;
  useEffect(() => {
    if (!withId || !lastAt) return;
    markSeen(competition.id, withId, lastAt);
  }, [competition.id, withId, lastAt]);

  const canCompose = (canMessageOrganisers && privateMessagingAvailable) || (isAdmin && withId !== null);

  async function removeMessage(id: number): Promise<boolean> {
    if (!canModerate) return false;
    if (!(await confirmDialog({ title: 'Delete this message?', message: 'It disappears for everyone.', confirmLabel: 'Delete message', destructive: true }))) return false;
    setActionError(null);
    try {
      await api.delete(`/competitions/${competition.id}/chat/${id}`);
      setMessages((current) => current.filter((message) => message.id !== id));
      return true;
    } catch {
      setActionError({ text: 'Couldn’t delete that message. Check your signal and try again.' });
      return false;
    } finally {
      reload();
    }
  }

  async function blockMessageAuthor(id: number): Promise<boolean> {
    if (!canModerate) return false;
    if (!(await confirmDialog({ title: 'Block this sender?', message: 'They can’t post in chat from this phone or network.', confirmLabel: 'Block sender', destructive: true }))) return false;
    setActionError(null);
    setActionNotice(null);
    try {
      const { data } = await api.post<{ alreadyBlocked: boolean; ipAddress: string }>(`/competitions/${competition.id}/chat/${id}/block-author`, {});
      setActionNotice(data.alreadyBlocked ? `IP ${data.ipAddress} was already blocked.` : `Blocked IP ${data.ipAddress}.`);
      return true;
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message
        ?? 'Could not block this sender. The post may be too old to have an IP recorded.';
      setActionError({ text: message });
      return false;
    }
  }

  async function send() {
    const text = body.trim();
    if (!text || !canCompose || sendingRef.current) return;
    sendingRef.current = true;
    setActionError(null);
    setSending(true);
    try {
      const response = await api.post<ChatMessage>(
        `/competitions/${competition.id}/chat`,
        withId ? { body: text, replyToUserId: withId } : { body: text },
      );
      const posted = response.data;
      if (posted) setMessages((current) => current.some((item) => item.id === posted.id) ? current : [...current, posted]);
      setBody((current) => current.trim() === text ? '' : current);
    } catch (error) {
      setActionError((error as { response?: { status?: number } }).response?.status === 403
        ? { text: 'Posting is blocked from this network. Contact an organiser.' }
        : { text: 'Couldn’t send that message. Check your signal and try again.', retrySend: true });
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  const composer = canCompose && (
    <div id="chat-composer" className="ev-composer">
      <div className="flex items-end gap-2">
        <label className="ev-compose-field">
          <span className="sr-only">{withId ? `Reply to ${personName}` : 'Message the organisers'}</span>
          <textarea
            rows={desktop ? 2 : 1}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (body.trim()) void send();
              }
            }}
            placeholder={withId ? 'Reply' : 'Message the organisers'}
          />
        </label>
        <button type="button" className="ev-send" aria-label="Send" disabled={!body.trim() || sending} onClick={() => void send()}>
          <ArrowUp aria-hidden="true" className="h-5 w-5" strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );

  const notices = (
    <>
      {actionError && (
        <Notice
          onDismiss={() => setActionError(null)}
          dismissLabel="Dismiss error"
          actionLabel={actionError.retrySend ? 'Try again' : undefined}
          onAction={actionError.retrySend ? () => void send() : undefined}
        >{actionError.text}</Notice>
      )}
      {actionNotice && <Notice tone="info" onDismiss={() => setActionNotice(null)} dismissLabel="Dismiss notice">{actionNotice}</Notice>}
    </>
  );

  // Signed out: one plain line and two pills.
  if (!user) {
    return (
      <div className="rf-page mx-auto flex w-full max-w-xl flex-col gap-3 pb-6 pt-4">
        <h1 className="sr-only">Message the organisers</h1>
        <p className="ev-body !text-[16px] !text-[rgb(var(--mg-ink))]">Sign in to message the organisers. Only they can read what you send.</p>
        <div className="sp-acts">
          <Link to="/login" state={{ from: location.pathname }} className="sp-pill sp-pill-fill">Sign in</Link>
          <button type="button" className="sp-pill" onClick={goBack}>Go back</button>
        </div>
      </div>
    );
  }

  // An organiser's chat list: one row for each person who has written.
  if (isAdmin && !withId) {
    return (
      <div className="skin cs-page">
        <h1 className="sr-only">Messages</h1>
        {notices}
        {messagesError && <Notice actionLabel="Try again" onAction={loadMessages}>{messagesError}</Notice>}
        {messagesLoading && messages.length === 0 ? (
          <p role="status" className="sp-note">Loading messages…</p>
        ) : (
          <ul className="sp-card cs-gap m-0 list-none p-0" aria-label="Messages">
            {threads.map((item) => {
              const team = teamOf(item.userId);
              return (
                <li key={item.userId}>
                  <button type="button" className="sp-row" onClick={() => setParams({ with: item.userId })}>
                    <span aria-hidden="true" className="cs-ava">{initials(item.name)}</span>
                    <span className="sp-grow">
                      <span className="sp-t1">{[item.name, team].filter(Boolean).join(' · ')}</span>
                      <span className="sp-t2 cs-ellip">{item.lastBody}</span>
                    </span>
                    <span className="cs-right">
                      <time className="cs-time" dateTime={item.lastAt}>{listTime(item.lastAt)}</time>
                      {item.unread > 0 && <span className="cs-unread" aria-label={`${item.unread} unread`}>{item.unread}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
            {threads.length === 0 && <li className="cs-row sp-t2">No messages yet.</li>}
          </ul>
        )}
      </div>
    );
  }

  // One person's thread, for an organiser; or the organisers' thread, for anyone else. Same look, with the box at the bottom.
  const shown = isAdmin ? thread : privateMessages;
  return (
    <div className="ev-thread rf-page mx-auto flex w-full max-w-xl flex-col gap-2 pb-3 pt-4">
      <h1 className="sr-only">{isAdmin ? personName : 'Message the organisers'}</h1>
      {notices}
      {!isAdmin && !privateMessagingAvailable && <Notice tone="info">Messaging the organisers isn’t available for this event yet.</Notice>}
      {messagesError && <Notice actionLabel="Try again" onAction={loadMessages}>{messagesError}</Notice>}
      {(isAdmin || privateMessagingAvailable) && <span className="cs-privacy">{isAdmin ? `Only you and ${personName} see this` : 'Only you and the organisers see this'}</span>}
      {messagesLoading && messages.length === 0 && <p role="status" className="sp-note text-center">Loading messages…</p>}
      {!messagesLoading && shown.length === 0 && (isAdmin || privateMessagingAvailable) && !messagesError && (
        <p className="sp-note text-center">{isAdmin ? 'No messages from them yet.' : 'No messages yet. Write to the organisers below.'}</p>
      )}
      {shown.map((message, index) => {
        const day = dayHeading(message.createdAt);
        const heading = index === 0 || dayHeading(shown[index - 1].createdAt) !== day ? day : null;
        // An organiser's own replies sit on the right; so do the entrant's own messages.
        const mine = isAdmin ? !!message.recipientUserId : message.userId === user.id;
        return (
          <div key={message.id} className="flex flex-col gap-2">
            {heading && <span className="ev-day">{heading}</span>}
            <div className="cs-bub-row" data-mine={mine}>
              <div className={`ev-bub ${mine ? 'ev-bub-me' : 'ev-bub-them'}`}>
                {!mine && !isAdmin && <b className="ev-bub-from">{message.authorName || 'Organiser'}</b>}
                {message.body}
                <time dateTime={message.createdAt}>{messageTime(message)}</time>
              </div>
              {canModerate && <button type="button" className="cs-bub-more" aria-label={`More for message: ${message.body}`} onClick={() => setMenuFor(message)}>⋯</button>}
            </div>
          </div>
        );
      })}
      {composer}

      {menuFor && (
        <Sheet title="This message" description={menuFor.body.length > 90 ? `${menuFor.body.slice(0, 90)}…` : menuFor.body} onClose={() => setMenuFor(null)}>
          {({ close }) => (
            <div className="kit-acts">
              {!menuFor.recipientUserId && (
                <button type="button" className="kit-redtext" onClick={() => { void blockMessageAuthor(menuFor.id).then((done) => { if (done) close(); }); }}>Block sender</button>
              )}
              <button type="button" className="kit-redtext" onClick={() => { void removeMessage(menuFor.id).then((done) => { if (done) close(); }); }}>Delete message</button>
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}
