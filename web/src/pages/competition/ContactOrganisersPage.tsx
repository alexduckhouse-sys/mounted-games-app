import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Lock, Send, Shield, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import { useLiveHub } from '../../live/useLiveHub';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { confirmDialog } from '../../components/ConfirmDialog';
import type { ChatMessage } from '../../types';
import './chat.css';

const messageTime = (message: ChatMessage) =>
  new Date(message.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function ContactOrganisersPage() {
  const { user } = useAuth();
  const authSession = user ? `${user.id}:${[...user.roles].sort().join(',')}` : 'signed-out';
  return <ContactOrganisersSession key={authSession} />;
}

function ContactOrganisersSession() {
  const { competition, reload } = useCompetition();
  const { user, canEdit, hasRole } = useAuth();
  const isAdmin = hasRole('Admin');
  const isTrainer = hasRole('Trainer');
  const canPost = isAdmin || isTrainer;
  const canModerate = canEdit();
  const privateMessagingAvailable = competition.staffChatEnabled === true;
  const canMessageOrganisers = !!user && !isAdmin;
  const desktop = useIsDesktop();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<{ userId: string; name: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);

  const requestMessages = useCallback((controller: AbortController) => {
    void api.get<ChatMessage[]>(`/competitions/${competition.id}/chat`, { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setMessages(response.data); })
      .catch(() => { if (!controller.signal.aborted) setMessagesError('Couldn’t load messages. Check your connection and try again.'); })
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
    if (!(await confirmDialog({ title: 'Delete this message?', message: 'Delete this message?', confirmLabel: 'Delete message', destructive: true }))) return;
    setActionError(null);
    try {
      await api.delete(`/competitions/${competition.id}/chat/${id}`);
      setMessages((current) => current.filter((message) => message.id !== id));
    } catch {
      setActionError('Couldn’t delete that message. Check your connection and try again.');
    } finally {
      reload();
    }
  }

  async function blockMessageAuthor(id: number) {
    if (!canModerate) return;
    if (!(await confirmDialog({ title: 'Block this sender?', message: "Block this sender's IP from posting?", confirmLabel: 'Block sender', destructive: true }))) return;
    setActionError(null);
    setActionNotice(null);
    try {
      const { data } = await api.post<{ alreadyBlocked: boolean; ipAddress: string }>(`/competitions/${competition.id}/chat/${id}/block-author`, {});
      setActionNotice(data.alreadyBlocked ? `IP ${data.ipAddress} was already blocked.` : `Blocked IP ${data.ipAddress}.`);
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message
        ?? 'Could not block this sender. The post may be too old to have an IP recorded.';
      setActionError(message);
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
        ? 'Posting is blocked from this network. Contact an organiser.'
        : 'Couldn’t send that message. Check your connection and try again.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pb-24 pt-2">
      <div className="live-page-band mg-band">
        <Link to={`/competitions/${competition.id}/chat`} className="mg-icon-btn !h-9 !w-9" aria-label="Back to live stream">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
        <h1 className="mg-h1 mg-h1-sm">{isAdmin ? 'Organiser messages' : 'Message organisers'}</h1>
        {canPost && <span className="live-role-badge">Private</span>}
      </div>

      {actionError && (
        <div className="live-action-error" role="alert">
          <span>{actionError}</span>
          <button type="button" aria-label="Dismiss error" onClick={() => setActionError(null)}><X aria-hidden="true" /></button>
        </div>
      )}
      {actionNotice && (
        <div className="live-banner" role="status">
          <span>{actionNotice}</span>
          <button type="button" aria-label="Dismiss notice" onClick={() => setActionNotice(null)}><X aria-hidden="true" /></button>
        </div>
      )}

      {!user && (
        <div className="live-composer-locked" role="status">
          <Lock aria-hidden="true" />
          <span><Link to="/login" className="underline font-semibold">Sign in</Link> to message the organisers privately.</span>
        </div>
      )}

      {canMessageOrganisers && !privateMessagingAvailable && (
        <div className="live-composer-locked" role="status">
          <Lock aria-hidden="true" />Messaging the organisers isn’t available for this event yet.
        </div>
      )}

      {canCompose && (
        <div id="chat-composer" className="live-composer">
          {replyTo ? (
            <div className="live-composer-label">
              <Lock aria-hidden="true" /> Private reply to {replyTo.name}
              <button type="button" className="live-reply-cancel" onClick={() => setReplyTo(null)}>Cancel</button>
            </div>
          ) : (
            <div className="live-composer-label"><Lock aria-hidden="true" /> Seen only by you and the organisers</div>
          )}
          <div className="live-compose-row">
            <label className="mg-field live-compose-field">
              <span className="sr-only">{replyTo ? `Reply to ${replyTo.name}` : 'Message organisers'}</span>
              <textarea
                rows={desktop ? 3 : 2}
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
            <button type="button" className="live-send" aria-label="Send" disabled={!body.trim() || sending} onClick={() => void send()}>
              <Send aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      <section className="live-announcements" aria-labelledby="organiser-messages-title">
        <div className="mg-section-head">
          <h2 id="organiser-messages-title">{isAdmin ? 'Incoming messages' : 'Your messages'}</h2>
        </div>
        {messagesError && (
          <div className="live-feed-error" role="alert">
            <span>{messagesError}</span>
            <button type="button" onClick={loadMessages}>Try again</button>
          </div>
        )}
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
                {isAdmin && !message.recipientUserId && message.userId && (
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
              <p className="live-empty">
                {isAdmin
                  ? 'No private messages from entrants or trainers yet. Select “Reply privately” on any message when one arrives.'
                  : 'No messages yet.'}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
