import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import { useLiveHub } from '../../live/useLiveHub';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { usePageWidth } from '../../components/pageWidthState';
import { Notice } from '../../components/Notice';
import { BUBBLE_IN, BUBBLE_SHOWN, BUBBLE_SPRING } from '../../lib/motion';
import { useStillMotion } from '../../lite/useStillMotion';
import { useT } from '../../i18n/LanguageContext';
import { activeLocale, tr } from '../../i18n/translate';
import type { ChatMessage } from '../../types';
import './chat.css';
import '../../components/sitePages.css';
import '../../components/eventPages.css';
import '../clubShop/clubShop.css';

const messageTime = (message: ChatMessage) =>
  new Date(message.createdAt).toLocaleTimeString(activeLocale(), { hour: '2-digit', minute: '2-digit' });

/** "Today", "Yesterday" or "Mon 26 Oct": the heading above a day's messages in the thread. */
function dayHeading(iso: string, now = new Date()): string {
  const day = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(day)) / 86_400_000);
  if (diff === 0) return tr('common.today');
  if (diff === 1) return tr('site.contact.yesterday');
  return day.toLocaleDateString(activeLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
}

export function ContactOrganisersPage() {
  const { user, canOrganise, hasRole } = useAuth();
  const { competition } = useCompetition();
  const [params] = useSearchParams();
  const authSession = user ? `${user.id}:${[...user.roles].sort().join(',')}` : 'signed-out';
  // Organisers read and answer messages on the Announcements page; old links and notifications land there.
  if (hasRole('Admin') || canOrganise(competition)) {
    const withId = params.get('with');
    return <Navigate replace to={withId
      ? `/competitions/${competition.id}/messages/${encodeURIComponent(withId)}`
      : `/competitions/${competition.id}/announcements`} />;
  }
  return <ContactOrganisersSession key={authSession} />;
}

function ContactOrganisersSession() {
  const t = useT();
  const { competition } = useCompetition();
  const { user } = useAuth();
  const privateMessagingAvailable = competition.staffChatEnabled === true;
  const desktop = useIsDesktop();
  const location = useLocation();
  const navigate = useNavigate();
  usePageWidth('narrow');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const still = useStillMotion();
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<{ text: string; retrySend?: boolean } | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);

  usePageHeader({ title: t('site.contact.title'), subtitle: competition.name, plain: true, backTo: `/competitions/${competition.id}/details`, backLabel: t('site.contact.backToDetails') });
  // Go back to where you came from, or to the details when this page was opened directly.
  const goBack = () => (location.key === 'default' ? navigate(`/competitions/${competition.id}/details`) : navigate(-1));

  const requestMessages = useCallback((controller: AbortController) => {
    void api.get<ChatMessage[]>(`/competitions/${competition.id}/chat`, { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setMessages(response.data); })
      .catch(() => { if (!controller.signal.aborted) setMessagesError(t('site.contact.loadFailed')); })
      .finally(() => { if (!controller.signal.aborted) setMessagesLoading(false); });
  }, [competition.id, t]);

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

  // Anyone who isn't an organiser sees only their own thread with the organisers.
  const shown = messages
    .filter((message) => message.adminOnly && !!user && (message.userId === user.id || message.recipientUserId === user.id))
    .slice()
    .reverse();
  const canCompose = !!user && privateMessagingAvailable;

  async function send() {
    const text = body.trim();
    if (!text || !canCompose || sendingRef.current) return;
    sendingRef.current = true;
    setActionError(null);
    setSending(true);
    try {
      const response = await api.post<ChatMessage>(`/competitions/${competition.id}/chat`, { body: text });
      const posted = response.data;
      if (posted) setMessages((current) => current.some((item) => item.id === posted.id) ? current : [...current, posted]);
      setBody((current) => current.trim() === text ? '' : current);
    } catch (error) {
      setActionError((error as { response?: { status?: number } }).response?.status === 403
        ? { text: t('site.contact.postBlocked') }
        : { text: t('site.contact.sendFailed'), retrySend: true });
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  // Signed out: one plain line and two pills.
  if (!user) {
    return (
      <div className="rf-page mx-auto flex w-full max-w-xl flex-col gap-3 pb-6 pt-4">
        <h1 className="sr-only">{t('site.contact.title')}</h1>
        <p className="ev-body !text-[16px] !text-[rgb(var(--mg-ink))]">{t('site.contact.signInPrompt')}</p>
        <div className="sp-acts">
          <Link to="/login" state={{ from: location.pathname }} className="sp-pill sp-pill-fill">{t('common.signIn')}</Link>
          <button type="button" className="sp-pill" onClick={goBack}>{t('common.goBack')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ev-thread rf-page mx-auto flex w-full max-w-xl flex-col gap-2 pb-3 pt-4">
      <h1 className="sr-only">{t('site.contact.title')}</h1>
      {actionError && (
        <Notice
          onDismiss={() => setActionError(null)}
          dismissLabel={t('site.contact.dismissError')}
          actionLabel={actionError.retrySend ? t('common.tryAgain') : undefined}
          onAction={actionError.retrySend ? () => void send() : undefined}
        >{actionError.text}</Notice>
      )}
      {!privateMessagingAvailable && <Notice tone="info">{t('site.contact.unavailable')}</Notice>}
      {messagesError && <Notice actionLabel={t('common.tryAgain')} onAction={loadMessages}>{messagesError}</Notice>}
      {privateMessagingAvailable && <span className="cs-privacy">{t('site.contact.privacy')}</span>}
      {messagesLoading && messages.length === 0 && <p role="status" className="sp-note text-center">{t('site.contact.loading')}</p>}
      {!messagesLoading && shown.length === 0 && privateMessagingAvailable && !messagesError && (
        <p className="sp-note text-center">{t('site.contact.noneWrite')}</p>
      )}
      {shown.map((message, index) => {
        const day = dayHeading(message.createdAt);
        const heading = index === 0 || dayHeading(shown[index - 1].createdAt) !== day ? day : null;
        const mine = message.userId === user.id;
        return (
          <div key={message.id} className="flex flex-col gap-2">
            {heading && <span className="ev-day">{heading}</span>}
            <div className="cs-bub-row" data-mine={mine}>
              <motion.div className={`ev-bub ${mine ? 'ev-bub-me' : 'ev-bub-them'}`}
                initial={still || messagesLoading ? false : BUBBLE_IN} animate={BUBBLE_SHOWN} transition={BUBBLE_SPRING}
                style={{ transformOrigin: mine ? 'bottom right' : 'bottom left' }}>
                {!mine && <b className="ev-bub-from">{message.authorName || t('site.contact.organiser')}</b>}
                {message.body}
                <time dateTime={message.createdAt}>{messageTime(message)}</time>
              </motion.div>
            </div>
          </div>
        );
      })}
      {canCompose && (
        <div id="chat-composer" className="ev-composer">
          <div className="flex items-end gap-2">
            <label className="ev-compose-field">
              <span className="sr-only">{t('site.contact.title')}</span>
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
                placeholder={t('site.contact.title')}
              />
            </label>
            <button type="button" className="ev-send" aria-label={t('site.contact.send')} disabled={!body.trim() || sending} onClick={() => void send()}>
              <ArrowUp aria-hidden="true" className="h-5 w-5" strokeWidth={2.4} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
