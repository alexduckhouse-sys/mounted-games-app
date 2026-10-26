import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Lock, Megaphone, MessageSquare, Pin, Radio, Save, Send, Shield, Trash2, Video, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import { useLiveHub } from '../../live/useLiveHub';
import { useDialogFocus } from '../../components/useDialogFocus';
import { usePageWidth } from '../../components/pageWidthState';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { LiveVideo } from '../../components/stream/LiveVideo';
import type { ChatMessage, LiveStream } from '../../types';
import './chat.css';
import { confirmDialog } from '../../components/ConfirmDialog';

const LAST_CHAT_COMP_KEY = 'mg.lastChatComp';
const BANNER_TAG = 'banner';

interface LastChatComp { id: number; name: string }

function loadLastChatComp(): LastChatComp | null {
  try {
    const raw = localStorage.getItem(LAST_CHAT_COMP_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as LastChatComp;
    return typeof value.id === 'number' && typeof value.name === 'string' ? value : null;
  } catch { return null; }
}

function saveLastChatComp(value: LastChatComp) {
  try { localStorage.setItem(LAST_CHAT_COMP_KEY, JSON.stringify(value)); } catch { /* storage blocked */ }
}

const messageTime = (message: ChatMessage) => new Date(message.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function ChatTab() {
  // Remount on sign-in, sign-out or a role change so private messages, drafts and
  // in-flight responses from the previous session never reach the new one.
  const { user } = useAuth();
  const authSession = user ? `${user.id}:${[...user.roles].sort().join(',')}` : 'signed-out';
  return <ChatTabSession key={authSession} />;
}

function ChatTabSession() {
  const { competition, reload, streams, streamingEnabled, streamingChecked = true, invoke, ready, streamMessages } = useCompetition();
  const { user, canEdit, hasRole, canOrganise } = useAuth();
  const isAdmin = hasRole('Admin');
  // Older APIs don't keep private messages private, so they must say they do before anyone can send one.
  const privateMessagingAvailable = competition.staffChatEnabled === true;
  const canPost = isAdmin || (!!user && canOrganise(competition));
  // Laptops get two columns and the whole feed inline; phones keep the single column and the "All" sheet.
  const desktop = useIsDesktop();
  usePageWidth('wide');
  // Anyone signed in who is not an organiser can message the organisers on the dedicated contact page.
  const canMessageOrganisers = !!user && !isAdmin;
  const canModerate = canEdit();
  const canManageStream = !!user && canOrganise(competition);
  const canBroadcast = streamingEnabled && canManageStream;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [unpinnedTopId, setUnpinnedTopId] = useState<number | null>(null);
  const [lastChatComp, setLastChatComp] = useState<LastChatComp | null>(() => loadLastChatComp());
  const [dismissedCompWarning, setDismissedCompWarning] = useState(false);
  const loadController = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const pinningRef = useRef(false);
  const [pinnedSource, setPinnedSource] = useState<{ bannerId: number; messageId: number } | null>(null);
  const announcementsTriggerRef = useRef<HTMLButtonElement>(null);

  const requestMessages = useCallback((controller: AbortController) => {
    void api.get<ChatMessage[]>(`/competitions/${competition.id}/chat`, { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setMessages(response.data); })
      .catch(() => { if (!controller.signal.aborted) setMessagesError('Couldn’t load the announcements. Check your connection and try again.'); })
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
    onAnnouncement: (value) => {
      const message = value as ChatMessage;
      if (message.competitionId !== competition.id) return;
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
    },
    onChatMessageDeleted: ({ id }) => setMessages((current) => current.filter((message) => message.id !== id)),
  });

  // Hub deliveries can arrive out of order; IDs break timestamp ties consistently.
  const orderedMessages = messages.slice().sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id);
  const banners = orderedMessages.filter((message) => message.type === 2 && message.tag === BANNER_TAG && !message.adminOnly);
  const visibleMessages = orderedMessages.filter((message) => message.type !== 1 && message.tag !== BANNER_TAG && !message.adminOnly);
  const privateCount = messages.filter((message) => message.adminOnly && !message.recipientUserId).length;
  const latest = visibleMessages.slice(desktop ? 0 : -3).reverse();

  // All announcements appear at the top first; pinned announcements replace them, or more recent announcements replace the pin.
  const latestPin = banners.at(-1) ?? null;
  const latestAnnouncement = visibleMessages.at(-1) ?? null;
  const pinIsNewer = Boolean(latestPin && (!latestAnnouncement ||
    new Date(latestPin.createdAt).getTime() > new Date(latestAnnouncement.createdAt).getTime() ||
    (new Date(latestPin.createdAt).getTime() === new Date(latestAnnouncement.createdAt).getTime() && latestPin.id > latestAnnouncement.id)));
  const rawBanner = pinIsNewer ? latestPin : latestAnnouncement;
  const banner = rawBanner && rawBanner.id !== unpinnedTopId ? rawBanner : null;
  const pinnedId = banner && pinIsNewer
    ? pinnedSource?.bannerId === banner.id ? pinnedSource.messageId
      : visibleMessages.findLast((message) => message.body === banner.body)?.id ?? null
    : null;

  const activeStreams = streams.filter((stream) => stream.status !== 2);
  const liveNow = activeStreams.length > 0;
  // Organisers make announcements here; non-organisers cannot make announcements (they message organisers on /contact).
  const canCompose = canModerate;
  const closeAnnouncements = useCallback(() => setAllOpen(false), []);
  const dismissActionError = useCallback(() => setActionError(null), []);

  async function removeMessage(id: number, confirmFirst = true) {
    if (!canModerate) return;
    if (confirmFirst && !(await confirmDialog({ title: 'Delete this announcement?', message: 'Delete this announcement?', confirmLabel: 'Delete announcement', destructive: true }))) return;
    setActionError(null);
    try {
      await api.delete(`/competitions/${competition.id}/chat/${id}`);
      setMessages((current) => current.filter((message) => message.id !== id));
    } catch {
      setActionError('Couldn’t delete that announcement. Check your connection and try again.');
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

  async function deleteBanners() {
    if (!canModerate || banners.length === 0) return;
    await Promise.all(banners.map((message) => api.delete(`/competitions/${competition.id}/chat/${message.id}`)));
    const ids = new Set(banners.map((message) => message.id));
    setMessages((current) => current.filter((message) => !ids.has(message.id)));
  }

  async function unpinBanners() {
    if (!canModerate || pinningRef.current) return;
    pinningRef.current = true;
    setActionError(null);
    try {
      if (banners.length > 0) await deleteBanners();
      if (latestAnnouncement) setUnpinnedTopId(latestAnnouncement.id);
    } catch {
      setActionError('Couldn’t unpin the banner. Check your connection and try again.');
      loadMessages();
    } finally {
      pinningRef.current = false;
      reload();
    }
  }

  async function pinMessage(target: ChatMessage) {
    if (!canModerate || pinningRef.current || target.adminOnly) return;
    pinningRef.current = true;
    setActionError(null);
    try {
      const response = await api.post<ChatMessage>(`/competitions/${competition.id}/chat/announcement`, {
        body: target.body,
        tag: BANNER_TAG,
      });
      const posted = response.data;
      if (!posted || typeof posted.id !== 'number' || posted.adminOnly || posted.tag !== BANNER_TAG) {
        throw new Error('Invalid announcement response');
      }
      setMessages((current) => current.some((item) => item.id === posted.id) ? current : [...current, posted]);
      setPinnedSource({ bannerId: posted.id, messageId: target.id });
      setUnpinnedTopId(null);
      // Keep the previous pin until the replacement is safely stored.
      try { if (banners.length > 0) await deleteBanners(); }
      catch { setActionError('The announcement was pinned, but the old banner could not be cleared. Try again.'); }
    } catch {
      setActionError('Couldn’t pin that announcement. Check your connection and try again.');
    } finally {
      pinningRef.current = false;
      reload();
    }
  }

  async function send() {
    const text = body.trim();
    if (!text || !canCompose || sendingRef.current) return;
    sendingRef.current = true;
    setActionError(null);
    setSending(true);
    try {
      const response = await api.post<ChatMessage>(`/competitions/${competition.id}/chat/announcement`, { body: text, tag: 'general' });
      const posted = response.data;
      if (posted && typeof posted.id === 'number') {
        setMessages((current) => current.some((item) => item.id === posted.id) ? current : [...current, posted]);
      }
      setUnpinnedTopId(null);
      reload();
      setBody((current) => current.trim() === text ? '' : current);
      const record = { id: competition.id, name: competition.name };
      saveLastChatComp(record);
      setLastChatComp(record);
      setDismissedCompWarning(true);
    } catch (error) {
      setActionError((error as { response?: { status?: number } }).response?.status === 403
        ? 'Posting is blocked from this network. Contact an organiser.'
        : 'Couldn’t send that post. Check your connection and try again.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  const announcementsSection = (
    <>
      <section className="live-announcements" aria-labelledby="announcements-title">
        <div className="mg-section-head">
          <h2 id="announcements-title">Announcements</h2>
          {isAdmin && (
            <Link to={`/competitions/${competition.id}/announcements`} className="text-xs font-semibold text-[rgb(var(--mg-heading))] underline">
              Manage announcements
            </Link>
          )}
          {isAdmin && (
            <Link to={`/competitions/${competition.id}/contact`} className="text-xs font-semibold text-[rgb(var(--mg-heading))] underline">
              Organiser messages{privateCount > 0 ? ` (${privateCount})` : ''}
            </Link>
          )}
          {!desktop && visibleMessages.length > 0 && <button ref={announcementsTriggerRef} type="button" onClick={() => setAllOpen(true)}>All {visibleMessages.length}</button>}
        </div>
        {lastChatComp && lastChatComp.id !== competition.id && !dismissedCompWarning && canCompose && (
          <div className="live-comp-warning" role="status">
            <AlertTriangle aria-hidden="true" />
            <span>Your last post was for another competition. <Link to={`/competitions/${lastChatComp.id}/chat`}>Switch back to {lastChatComp.name}</Link>, or post here.</span>
            <button type="button" aria-label="Dismiss competition warning" onClick={() => setDismissedCompWarning(true)}><X aria-hidden="true" /></button>
          </div>
        )}
        {messagesError && <div className="live-feed-error" role="alert"><span>{messagesError}</span><button type="button" onClick={loadMessages}>Try again</button></div>}
        {messagesLoading && messages.length === 0
          ? <div className="live-feed-state mg-card" role="status">Loading announcements…</div>
          : messagesError && messages.length === 0
            ? null
            : (
              <AnnouncementList
                messages={latest}
                staff={canPost}
                canModerate={canModerate}
                pinnedId={pinnedId}
                onPin={pinMessage}
                onUnpin={unpinBanners}
                onDelete={removeMessage}
                onBlock={blockMessageAuthor}
              />
            )}
      </section>

      {canCompose && (
        <div id="chat-composer" className="live-composer">
          <div className="live-compose-row">
            <label className="mg-field live-compose-field">
              <span className="sr-only">Announcement</span>
              <textarea
                rows={desktop ? 3 : 1}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (body.trim()) void send();
                  }
                }}
                placeholder="Write an announcement…"
              />
            </label>
            <button type="button" className="live-send" aria-label="Send" disabled={!body.trim() || sending} onClick={() => void send()}><Send aria-hidden="true" /></button>
          </div>
        </div>
      )}

      {!canCompose && canMessageOrganisers && (
        privateMessagingAvailable ? (
          <Link to={`/competitions/${competition.id}/contact`} className="mg-btn mg-btn-secondary">
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            Message organisers
          </Link>
        ) : (
          <div className="live-composer-locked" role="status"><Lock aria-hidden="true" />Messaging the organisers isn’t available for this event yet.</div>
        )
      )}
    </>
  );

  return (
    <div className={`live-page ${canPost ? 'live-page-staff' : 'live-page-public'}`}>
      <div className="live-page-band mg-band">
        <h1 className="mg-h1 mg-h1-sm">Live stream</h1>
        {canPost ? <span className="live-role-badge">Organiser</span> : liveNow && <span className="mg-badge mg-badge-live">Live</span>}
      </div>

      {actionError && !allOpen && <div className="live-action-error" role="alert"><span>{actionError}</span><button type="button" aria-label="Dismiss error" onClick={() => setActionError(null)}><X aria-hidden="true" /></button></div>}
      {actionNotice && !allOpen && <div className="live-banner" role="status"><span>{actionNotice}</span><button type="button" aria-label="Dismiss notice" onClick={() => setActionNotice(null)}><X aria-hidden="true" /></button></div>}

      {banner && (
        <div className="live-banner" role="status" aria-label="Top announcement">
          <Megaphone aria-hidden="true" />
          <div>
            <strong>{banner.body}</strong>
            <span>{pinIsNewer ? (canPost ? 'Pinned banner · everyone sees this' : `Pinned by organisers · ${messageTime(banner)}`) : `Latest announcement · ${messageTime(banner)}`}</span>
          </div>
          {canModerate && (pinIsNewer
            ? <button type="button" onClick={() => void unpinBanners()}>Unpin</button>
            : <button type="button" onClick={() => setUnpinnedTopId(banner.id)}>Hide on this device</button>)}
        </div>
      )}

      {canPost ? (
        <>
          <div className="live-col live-col-rail">
            <div className="mg-section-head live-stream-head"><h2>Stream</h2></div>
            <StaffStreamCard key={canManageStream ? 'editable' : 'read-only'} active={activeStreams[0] ?? null} fallback={competition.streamUrl ?? null} competitionId={competition.id} canBroadcast={canBroadcast} canEditStream={canManageStream} streamingNotSetUp={canManageStream && streamingChecked && !streamingEnabled} onSaved={reload} />
            {activeStreams.length > 0 && <LiveVideo competitionId={competition.id} streams={streams} sessions={competition.sessions} invoke={invoke} ready={ready} messages={streamMessages} canBroadcast={false} fallback={null} competitionName={competition.name} publicLayout />}
          </div>
          <div className="live-col live-col-main">
            {announcementsSection}
          </div>
        </>
      ) : (
        <>
          <div className="live-col live-col-main">
            <div className="mg-section-head live-stream-head"><h2>Stream</h2></div>
            <LiveVideo competitionId={competition.id} streams={streams} sessions={competition.sessions} invoke={invoke} ready={ready} messages={streamMessages} canBroadcast={false} fallback={competition.streamUrl} competitionName={competition.name} publicLayout showPlaceholder />
          </div>
          <div className="live-col live-col-rail">
            {announcementsSection}
          </div>
        </>
      )}

      {allOpen && (
        <AnnouncementsOverlay
          messages={visibleMessages.slice().reverse()}
          staff={canPost}
          canModerate={canModerate}
          pinnedId={pinnedId}
          error={actionError}
          onPin={pinMessage}
          onUnpin={unpinBanners}
          onDelete={removeMessage}
          onBlock={blockMessageAuthor}
          onDismissError={dismissActionError}
          onClose={closeAnnouncements}
          returnFocusRef={announcementsTriggerRef}
        />
      )}
    </div>
  );
}

function AnnouncementList({ messages, staff, canModerate, pinnedId, onPin, onUnpin, onDelete, onBlock, full = false }: {
  messages: ChatMessage[];
  staff: boolean;
  canModerate: boolean;
  pinnedId: number | null;
  onPin: (message: ChatMessage) => Promise<void>;
  onUnpin: () => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onBlock: (id: number) => Promise<void>;
  full?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  return <div className={`live-announcement-list mg-card mg-list ${full ? 'live-announcement-list-full' : ''}`}>
    <AnimatePresence initial={false}>
      {messages.map((message) => (
        <AnnouncementRow
          key={message.id}
          message={message}
          staff={staff}
          canModerate={canModerate}
          isPinned={pinnedId === message.id}
          onPin={onPin}
          onUnpin={onUnpin}
          onDelete={onDelete}
          onBlock={onBlock}
          reduceMotion={!!reduceMotion}
        />
      ))}
    </AnimatePresence>
    {messages.length === 0 && <p className="live-empty">Nothing posted yet.</p>}
  </div>;
}

function AnnouncementRow({ message, staff, canModerate, isPinned, onPin, onUnpin, onDelete, onBlock, reduceMotion }: {
  message: ChatMessage;
  staff: boolean;
  canModerate: boolean;
  isPinned: boolean;
  onPin: (message: ChatMessage) => Promise<void>;
  onUnpin: () => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onBlock: (id: number) => Promise<void>;
  reduceMotion: boolean;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const canBlock = canModerate && message.type === 0;
  return <motion.div className={`live-announcement-row ${staff ? 'live-announcement-row-staff' : ''}`} initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: -4 }} transition={{ duration: reduceMotion ? 0 : 0.2 }}>
    <time dateTime={message.createdAt}>{messageTime(message)}</time>
    {canBlock ? <button type="button" className="live-announcement-copy" aria-expanded={actionsOpen} onClick={(event) => { event.stopPropagation(); setActionsOpen((open) => !open); }}><span>{message.body}</span>{message.adminOnly && <small><Lock aria-hidden="true" /> Organisers only</small>}</button>
      : <div className="live-announcement-copy"><span>{message.body}</span>{message.adminOnly && <small><Lock aria-hidden="true" /> Organisers only</small>}</div>}
    {canModerate && (
      <div className="live-row-actions">
        <button
          type="button"
          className={`live-pin ${isPinned ? 'live-pin-active' : ''}`}
          aria-label={isPinned ? `Unpin: ${message.body}` : `Pin as banner: ${message.body}`}
          aria-pressed={isPinned}
          title={isPinned ? 'Unpin banner' : 'Pin as banner'}
          onClick={(event) => {
            event.stopPropagation();
            void (isPinned ? onUnpin() : onPin(message));
          }}
        >
          <Pin aria-hidden="true" />
        </button>
        <button type="button" className="live-delete" aria-label={`Delete: ${message.body}`} onClick={(event) => { event.stopPropagation(); void onDelete(message.id); }}><Trash2 aria-hidden="true" /></button>
      </div>
    )}
    {actionsOpen && canBlock && <button type="button" className="live-block" onClick={(event) => { event.stopPropagation(); setActionsOpen(false); void onBlock(message.id); }}><Shield aria-hidden="true" /> Block this sender</button>}
  </motion.div>;
}

function AnnouncementsOverlay({ messages, staff, canModerate, pinnedId, error, onPin, onUnpin, onDelete, onBlock, onDismissError, onClose, returnFocusRef }: {
  messages: ChatMessage[];
  staff: boolean;
  canModerate: boolean;
  pinnedId: number | null;
  error: string | null;
  onPin: (message: ChatMessage) => Promise<void>;
  onUnpin: () => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onBlock: (id: number) => Promise<void>;
  onDismissError: () => void;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose, '[aria-label="Close announcements"]', returnFocusRef);
  return <div className="live-overlay" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className="live-all-dialog" role="dialog" aria-modal="true" aria-label="All announcements">
      <div className="live-all-head"><h2>All announcements</h2><button type="button" className="mg-icon-btn" aria-label="Close announcements" onClick={onClose}><X aria-hidden="true" /></button></div>
      {error && <div className="live-action-error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={onDismissError}><X aria-hidden="true" /></button></div>}
      <AnnouncementList messages={messages} staff={staff} canModerate={canModerate} pinnedId={pinnedId} onPin={onPin} onUnpin={onUnpin} onDelete={onDelete} onBlock={onBlock} full />
    </div>
  </div>;
}

function StaffStreamCard({ active, fallback, competitionId, canBroadcast, canEditStream, streamingNotSetUp, onSaved }: {
  active: LiveStream | null;
  fallback: string | null;
  competitionId: number;
  canBroadcast: boolean;
  canEditStream: boolean;
  streamingNotSetUp: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const closeSettings = useCallback(() => setEditing(false), []);
  const changeRef = useRef<HTMLButtonElement>(null);
  const streamName = active ? active.caption || `${active.arenaName} · ${active.angleName}` : fallback ? 'Competition stream' : 'No stream is set';
  return <div className="staff-stream-wrap">
    <div className="staff-stream mg-card">
      <span className="staff-stream-thumb"><Video aria-hidden="true" /></span>
      <span className="staff-stream-copy"><strong>{active ? 'Stream is on' : fallback ? 'Stream link is set' : 'Stream hasn’t started'}</strong><span>{streamName}</span></span>
      {canEditStream ? <button ref={changeRef} type="button" className="staff-stream-change" aria-expanded={editing} onClick={() => setEditing((open) => !open)}>Change</button>
        : canBroadcast ? <Link className="staff-stream-change" to={`/competitions/${competitionId}/broadcast`}>Change</Link> : null}
    </div>
    {canBroadcast && (
      <div className="flex flex-wrap gap-2">
        <Link className="mg-btn mg-btn-primary" to={`/competitions/${competitionId}/broadcast`}><Video aria-hidden="true" />Go live from this device</Link>
        <Link className="mg-btn mg-btn-secondary" to={`/competitions/${competitionId}/produce`}>Remote controller (2nd phone)</Link>
      </div>
    )}
    {streamingNotSetUp && <p className="mg-notice" role="status">Streaming isn’t set up yet. Add the Cloudflare keys to switch it on.</p>}
    {editing && canEditStream && <StreamSettingsOverlay competitionId={competitionId} fallback={fallback} canBroadcast={canBroadcast} canEditStream={canEditStream} onSaved={onSaved} onClose={closeSettings} returnFocusRef={changeRef} />}
  </div>;
}

function StreamSettingsOverlay({ competitionId, fallback, canBroadcast, canEditStream, onSaved, onClose, returnFocusRef }: {
  competitionId: number;
  fallback: string | null;
  canBroadcast: boolean;
  canEditStream: boolean;
  onSaved: () => void;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose, '[aria-label="Close stream settings"]', returnFocusRef);
  return <div className="live-overlay" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className="staff-stream-dialog" role="dialog" aria-modal="true" aria-label="Stream settings">
      <div className="live-all-head"><h2>Stream settings</h2><button type="button" className="mg-icon-btn" aria-label="Close stream settings" onClick={onClose}><X aria-hidden="true" /></button></div>
      {canBroadcast && <Link to={`/competitions/${competitionId}/broadcast`} className="mg-btn mg-btn-primary"><Video aria-hidden="true" />Change camera</Link>}
      <CompStreamEditor competition={{ id: competitionId, streamUrl: fallback }} canEditStream={canEditStream} onSaved={onSaved} />
    </div>
  </div>;
}

function CompStreamEditor({ competition, canEditStream, onSaved }: { competition: { id: number; streamUrl?: string | null }; canEditStream: boolean; onSaved: () => void }) {
  const [url, setUrl] = useState(competition.streamUrl ?? '');
  const [savedUrl, setSavedUrl] = useState(competition.streamUrl ?? '');
  const savedUrlRef = useRef(savedUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const next = competition.streamUrl ?? '';
    setUrl((current) => current === savedUrlRef.current ? next : current);
    savedUrlRef.current = next;
    setSavedUrl(next);
  }, [competition.streamUrl]);
  async function save(next: string | null) {
    if (!canEditStream) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/competitions/${competition.id}/stream-url`, { streamUrl: next });
      const value = next ?? '';
      savedUrlRef.current = value;
      setSavedUrl(value);
      setUrl(value);
      onSaved();
    } catch {
      setError('Couldn’t save the stream link. Check your connection and try again.');
    }
    finally { setBusy(false); }
  }
  return <div className="staff-stream-editor-wrap">
    <div className="staff-stream-editor">
      <label className="mg-field"><Radio aria-hidden="true" /><span className="sr-only">Competition stream URL</span><input placeholder="https://youtu.be/… or https://twitch.tv/channel" value={url} onChange={(event) => setUrl(event.target.value)} /></label>
      <button type="button" className="mg-btn mg-btn-secondary" onClick={() => void save(url.trim() || null)} disabled={!canEditStream || busy || url.trim() === savedUrl}><Save aria-hidden="true" />Save</button>
      {savedUrl && <button type="button" className="mg-icon-btn" title="Clear stream" onClick={() => void save(null)} disabled={!canEditStream || busy}><X aria-hidden="true" /></button>}
    </div>
    {error && <p className="staff-stream-error" role="alert">{error}</p>}
  </div>;
}
