import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Lock, Shield, Trash2 } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import { useLiveHub } from '../../live/useLiveHub';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { usePageWidth } from '../../components/pageWidthState';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import type { ChatMessage } from '../../types';
import './chat.css';
import '../../components/sitePages.css';
import '../../components/eventPages.css';

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
  usePageWidth('narrow');
  usePageHeader({
    title: isAdmin ? 'Organiser messages' : 'Message the organisers',
    subtitle: competition.name,
    plain: true,
    backTo: `/competitions/${competition.id}/details`,
    backLabel: 'Back to details',
  });
  // Go back to where you came from, or to the details when this page was opened directly.
  const goBack = () => (location.key === 'default' ? navigate(`/competitions/${competition.id}/details`) : navigate(-1));

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<{ userId: string; name: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<{ text: string; retrySend?: boolean } | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);

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

  const canCompose = (canMessageOrganisers && privateMessagingAvailable) || (isAdmin && replyTo !== null);

  async function removeMessage(id: number) {
    if (!canModerate) return;
    if (!(await confirmDialog({ title: 'Delete this message?', message: 'It disappears for everyone.', confirmLabel: 'Delete message', destructive: true }))) return;
    setActionError(null);
    try {
      await api.delete(`/competitions/${competition.id}/chat/${id}`);
      setMessages((current) => current.filter((message) => message.id !== id));
    } catch {
      setActionError({ text: 'Couldn’t delete that message. Check your signal and try again.' });
    } finally {
      reload();
    }
  }

  async function blockMessageAuthor(id: number) {
    if (!canModerate) return;
    if (!(await confirmDialog({ title: 'Block this sender?', message: 'They can’t post in chat from this phone or network.', confirmLabel: 'Block sender', destructive: true }))) return;
    setActionError(null);
    setActionNotice(null);
    try {
      const { data } = await api.post<{ alreadyBlocked: boolean; ipAddress: string }>(`/competitions/${competition.id}/chat/${id}/block-author`, {});
      setActionNotice(data.alreadyBlocked ? `IP ${data.ipAddress} was already blocked.` : `Blocked IP ${data.ipAddress}.`);
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message
        ?? 'Could not block this sender. The post may be too old to have an IP recorded.';
      setActionError({ text: message });
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
        replyTo ? { body: text, replyToUserId: replyTo.userId } : { body: text },
      );
      const posted = response.data;
      if (posted) setMessages((current) => current.some((item) => item.id === posted.id) ? current : [...current, posted]);
      if (replyTo) setReplyTo(null);
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
      {replyTo && (
        <div className="live-composer-label">
          Private reply to {replyTo.name}
          <button type="button" className="live-reply-cancel" onClick={() => setReplyTo(null)}>Cancel</button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <label className="ev-compose-field">
          <span className="sr-only">{replyTo ? `Reply to ${replyTo.name}` : 'Message organisers'}</span>
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
            placeholder={replyTo ? 'Write a private reply…' : 'Message the organisers…'}
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

  // Organisers keep the list of incoming messages, with Reply privately, Block and Delete.
  if (isAdmin) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pb-24 pt-3">
        <h1 className="sr-only">Organiser messages</h1>
        {notices}
        {composer}
        <section className="live-announcements" aria-labelledby="organiser-messages-title">
          <div className="mg-section-head">
            <h2 id="organiser-messages-title">Incoming messages</h2>
          </div>
          {messagesError && <Notice actionLabel="Try again" onAction={loadMessages}>{messagesError}</Notice>}
          {messagesLoading && messages.length === 0 ? (
            <div className="live-feed-state mg-card" role="status">Loading messages…</div>
          ) : (
            <div className="live-announcement-list live-announcement-list-full mg-card mg-list">
              {privateMessages.map((message) => (
                <div key={message.id} className={`live-announcement-row ${canModerate ? 'live-announcement-row-staff' : ''}`}>
                  <time dateTime={message.createdAt}>{messageTime(message)}</time>
                  <div className="live-announcement-copy">
                    <span>{message.body}</span>
                    <small>
                      <Lock aria-hidden="true" /> {message.authorName || 'Entrant'}
                      {message.recipientUserId ? ' · Organiser reply' : ' · Private to organisers'}
                    </small>
                  </div>
                  {!message.recipientUserId && message.userId && (
                    <button
                      type="button"
                      className="live-reply"
                      onClick={() => setReplyTo({ userId: message.userId!, name: message.authorName })}
                    >
                      Reply privately<span className="sr-only"> to {message.authorName}</span>
                    </button>
                  )}
                  {canModerate && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="live-delete"
                        aria-label={`Block sender: ${message.body}`}
                        title="Block sender"
                        onClick={() => void blockMessageAuthor(message.id)}
                      >
                        <Shield aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="live-delete"
                        aria-label={`Delete: ${message.body}`}
                        onClick={() => void removeMessage(message.id)}
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {privateMessages.length === 0 && (
                <p className="live-empty">No private messages from entrants or trainers yet. Select “Reply privately” on any message when one arrives.</p>
              )}
            </div>
          )}
        </section>
      </div>
    );
  }

  // Signed in: one thread, like a chat, with the box at the bottom.
  return (
    <div className="ev-thread rf-page mx-auto flex w-full max-w-xl flex-col gap-2 pb-3 pt-4">
      <h1 className="sr-only">Message the organisers</h1>
      {notices}
      {!privateMessagingAvailable && <Notice tone="info">Messaging the organisers isn’t available for this event yet.</Notice>}
      {messagesError && <Notice actionLabel="Try again" onAction={loadMessages}>{messagesError}</Notice>}
      {messagesLoading && messages.length === 0 && <p role="status" className="sp-note text-center">Loading messages…</p>}
      {!messagesLoading && privateMessages.length === 0 && privateMessagingAvailable && !messagesError && (
        <p className="sp-note text-center">No messages yet. Write to the organisers below.</p>
      )}
      {privateMessages.map((message, index) => {
        const day = dayHeading(message.createdAt);
        const heading = index === 0 || dayHeading(privateMessages[index - 1].createdAt) !== day ? day : null;
        const mine = message.userId === user.id;
        return (
          <div key={message.id} className="flex flex-col gap-2">
            {heading && <span className="ev-day">{heading}</span>}
            <div className={`ev-bub ${mine ? 'ev-bub-me' : 'ev-bub-them'}`}>
              {!mine && <b className="ev-bub-from">{message.authorName || 'Organiser'}</b>}
              {message.body}
              <time dateTime={message.createdAt}>{messageTime(message)}</time>
            </div>
          </div>
        );
      })}
      {composer}
    </div>
  );
}
