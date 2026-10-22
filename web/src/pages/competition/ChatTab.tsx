import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Lock, Megaphone, Radio, Save, Send, Shield, Trash2, Video, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import { useLiveHub } from '../../live/useLiveHub';
import { LiveVideo } from '../../components/stream/LiveVideo';
import type { ChatMessage, LiveStream } from '../../types';
import './chat.css';

const LAST_CHAT_COMP_KEY = 'mg.lastChatComp';
const BANNER_TAG = 'banner';

interface LastChatComp { id: number; name: string }
type ComposerMode = 'announcement' | 'banner';

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
  const { competition, reload, streams, streamingEnabled, invoke, ready, streamMessages } = useCompetition();
  const { canEdit, hasRole, canOrganise } = useAuth();
  const isAdmin = hasRole('Admin');
  const isTrainer = hasRole('Trainer');
  // Older APIs don't keep trainer messages private, so they must say they do before trainers can post.
  const trainerMessagingAvailable = competition.staffChatEnabled === true;
  const canPost = isAdmin || isTrainer;
  const canModerate = canEdit();
  const canManageStream = isAdmin ? canModerate : isTrainer && canOrganise(competition);
  const canBroadcast = streamingEnabled && canManageStream;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [mode, setMode] = useState<ComposerMode>('announcement');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [lastChatComp, setLastChatComp] = useState<LastChatComp | null>(() => loadLastChatComp());
  const [dismissedCompWarning, setDismissedCompWarning] = useState(false);
  const loadController = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
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

  const banners = messages.filter((message) => message.type === 2 && message.tag === BANNER_TAG);
  const banner = banners.at(-1) ?? null;
  const visibleMessages = messages.filter((message) => message.type !== 1 && message.tag !== BANNER_TAG && (canPost || !message.adminOnly));
  const latest = visibleMessages.slice(-3).reverse();
  const activeStreams = streams.filter((stream) => stream.status !== 2);
  const liveNow = competition.sessions.some((session) => session.status === 1) || activeStreams.length > 0;
  const effectiveMode = canModerate ? mode : 'announcement';
  const canCompose = canModerate || (isTrainer && trainerMessagingAvailable);
  const closeAnnouncements = useCallback(() => setAllOpen(false), []);
  const dismissActionError = useCallback(() => setActionError(null), []);

  async function removeMessage(id: number, confirmFirst = true) {
    if (!canModerate) return;
    if (confirmFirst && !confirm('Delete this announcement?')) return;
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
    if (!canModerate || !confirm("Block this sender's IP from posting?")) return;
    try {
      const { data } = await api.post<{ alreadyBlocked: boolean; ipAddress: string }>(`/competitions/${competition.id}/chat/${id}/block-author`, {});
      alert(data.alreadyBlocked ? `IP ${data.ipAddress} was already blocked.` : `Blocked IP ${data.ipAddress}.`);
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message
        ?? 'Could not block this sender. The post may be too old to have an IP recorded.';
      alert(message);
    }
  }

  async function deleteBanners() {
    if (!canModerate || banners.length === 0) return;
    await Promise.all(banners.map((message) => api.delete(`/competitions/${competition.id}/chat/${message.id}`)));
    const ids = new Set(banners.map((message) => message.id));
    setMessages((current) => current.filter((message) => !ids.has(message.id)));
  }

  async function unpinBanners() {
    setActionError(null);
    try { await deleteBanners(); }
    catch {
      setActionError('Couldn’t unpin the banner. Check your connection and try again.');
      loadMessages();
    } finally {
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
      let posted: ChatMessage | undefined;
      if (isAdmin && canModerate) {
        const response = await api.post<ChatMessage>(`/competitions/${competition.id}/chat/announcement`, { body: text, tag: effectiveMode === 'banner' ? BANNER_TAG : 'general' });
        posted = response.data;
        if (posted) setMessages((current) => current.some((item) => item.id === posted!.id) ? current : [...current, posted!]);
        if (effectiveMode === 'banner') {
          try { await deleteBanners(); }
          catch {
            setActionError('The new banner was pinned, but the old one could not be cleared. Check your connection and try again.');
            loadMessages();
          }
        }
      } else {
        const response = await api.post<ChatMessage>(`/competitions/${competition.id}/chat`, { body: text });
        posted = response.data;
        if (posted) setMessages((current) => current.some((item) => item.id === posted!.id) ? current : [...current, posted!]);
      }
      if (isAdmin && canModerate) reload();
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

  return (
    <div className={`live-page ${canPost ? 'live-page-staff' : 'live-page-public'}`}>
      <div className="live-page-band mg-band">
        <h1 className="mg-h1 mg-h1-sm">Live &amp; stream</h1>
        {canPost ? <span className="live-role-badge">Organiser</span> : liveNow && <span className="mg-badge mg-badge-live">Live</span>}
      </div>

      {actionError && !allOpen && <div className="live-action-error" role="alert"><span>{actionError}</span><button type="button" aria-label="Dismiss error" onClick={() => setActionError(null)}><X aria-hidden="true" /></button></div>}

      {canPost ? (
        <StaffStreamCard key={canManageStream ? 'editable' : 'read-only'} active={activeStreams[0] ?? null} fallback={competition.streamUrl ?? null} competitionId={competition.id} canBroadcast={canBroadcast} canEditStream={canManageStream} onSaved={reload} />
      ) : (
        <LiveVideo competitionId={competition.id} streams={streams} sessions={competition.sessions} invoke={invoke} ready={ready} messages={streamMessages} canBroadcast={false} fallback={competition.streamUrl} competitionName={competition.name} publicLayout showPlaceholder />
      )}

      {banner && (
        <div className="live-banner" role="status">
          <Megaphone aria-hidden="true" />
          <div><strong>{banner.body}</strong><span>{canPost ? 'Pinned banner · everyone sees this' : `Pinned by organisers · ${messageTime(banner)}`}</span></div>
          {canModerate && <button type="button" onClick={() => void unpinBanners()}>Unpin</button>}
        </div>
      )}

      <section className="live-announcements" aria-labelledby="announcements-title">
        <div className="mg-section-head">
          <h2 id="announcements-title">Announcements</h2>
          {visibleMessages.length > 0 && <button ref={announcementsTriggerRef} type="button" onClick={() => setAllOpen(true)}>All {visibleMessages.length}</button>}
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
            : <AnnouncementList messages={latest} staff={canPost} canModerate={canModerate} onDelete={removeMessage} onBlock={blockMessageAuthor} />}
      </section>

      {canCompose && (
        <div className="live-composer">
          {canModerate ? (
            <div className="mg-seg" role="group" aria-label="Post type">
              <button type="button" aria-pressed={effectiveMode === 'announcement'} onClick={() => setMode('announcement')}>Announcement</button>
              <button type="button" aria-pressed={effectiveMode === 'banner'} onClick={() => setMode('banner')}>Pin as banner</button>
            </div>
          ) : (
            <div className="live-composer-label">{isTrainer ? <><Lock aria-hidden="true" /> Message organisers</> : 'Announcement'}</div>
          )}
          <div className="live-compose-row">
            <label className="mg-field">
              <span className="sr-only">{effectiveMode === 'banner' ? 'Banner text' : isTrainer ? 'Message organisers' : 'Announcement'}</span>
              <input value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && body.trim()) void send(); }} placeholder={effectiveMode === 'banner' ? 'Banner text, replaces the pinned one' : isTrainer ? 'Message the organisers…' : 'Write an announcement…'} />
            </label>
            <button type="button" className="live-send" aria-label="Send" disabled={!body.trim() || sending} onClick={send}><Send aria-hidden="true" /></button>
          </div>
        </div>
      )}
      {isTrainer && !canModerate && !trainerMessagingAvailable && (
        <div className="live-composer-locked" role="status"><Lock aria-hidden="true" />Messaging the organisers isn’t available for this event yet.</div>
      )}
      {isAdmin && !canModerate && (
        <div className="live-composer-locked" role="status"><Lock aria-hidden="true" />Turn Edit mode on to post an announcement or pin a banner.</div>
      )}

      {allOpen && <AnnouncementsOverlay messages={visibleMessages.slice().reverse()} staff={canPost} canModerate={canModerate} error={actionError} onDelete={removeMessage} onBlock={blockMessageAuthor} onDismissError={dismissActionError} onClose={closeAnnouncements} returnFocusRef={announcementsTriggerRef} />}
    </div>
  );
}

function AnnouncementList({ messages, staff, canModerate, onDelete, onBlock, full = false }: {
  messages: ChatMessage[];
  staff: boolean;
  canModerate: boolean;
  onDelete: (id: number) => Promise<void>;
  onBlock: (id: number) => Promise<void>;
  full?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  return <div className={`live-announcement-list mg-card mg-list ${full ? 'live-announcement-list-full' : ''}`}>
    <AnimatePresence initial={false}>
      {messages.map((message) => <AnnouncementRow key={message.id} message={message} staff={staff} canModerate={canModerate} onDelete={onDelete} onBlock={onBlock} reduceMotion={!!reduceMotion} />)}
    </AnimatePresence>
    {messages.length === 0 && <p className="live-empty">Nothing posted yet.</p>}
  </div>;
}

function AnnouncementRow({ message, staff, canModerate, onDelete, onBlock, reduceMotion }: {
  message: ChatMessage;
  staff: boolean;
  canModerate: boolean;
  onDelete: (id: number) => Promise<void>;
  onBlock: (id: number) => Promise<void>;
  reduceMotion: boolean;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const canBlock = canModerate && message.type === 0;
  return <motion.div className={`live-announcement-row ${staff ? 'live-announcement-row-staff' : ''}`} initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: -4 }} transition={{ duration: reduceMotion ? 0 : 0.2 }}>
    <time dateTime={message.createdAt}>{messageTime(message)}</time>
    {canBlock ? <button type="button" className="live-announcement-copy" aria-expanded={actionsOpen} onClick={(event) => { event.stopPropagation(); setActionsOpen((open) => !open); }}><span>{message.body}</span>{staff && message.adminOnly && <small><Lock aria-hidden="true" /> Organisers only</small>}</button>
      : <div className="live-announcement-copy"><span>{message.body}</span>{staff && message.adminOnly && <small><Lock aria-hidden="true" /> Organisers only</small>}</div>}
    {canModerate && <button type="button" className="live-delete" aria-label={`Delete: ${message.body}`} onClick={(event) => { event.stopPropagation(); void onDelete(message.id); }}><Trash2 aria-hidden="true" /></button>}
    {actionsOpen && canBlock && <button type="button" className="live-block" onClick={(event) => { event.stopPropagation(); setActionsOpen(false); void onBlock(message.id); }}><Shield aria-hidden="true" /> Block this sender</button>}
  </motion.div>;
}

function AnnouncementsOverlay({ messages, staff, canModerate, error, onDelete, onBlock, onDismissError, onClose, returnFocusRef }: {
  messages: ChatMessage[];
  staff: boolean;
  canModerate: boolean;
  error: string | null;
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
      <AnnouncementList messages={messages} staff={staff} canModerate={canModerate} onDelete={onDelete} onBlock={onBlock} full />
    </div>
  </div>;
}

function StaffStreamCard({ active, fallback, competitionId, canBroadcast, canEditStream, onSaved }: {
  active: LiveStream | null;
  fallback: string | null;
  competitionId: number;
  canBroadcast: boolean;
  canEditStream: boolean;
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
    {canBroadcast && <Link className="mg-text-link self-start text-sm" to={`/competitions/${competitionId}/produce`}>Banners and overlays</Link>}
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

function useDialogFocus(dialogRef: RefObject<HTMLDivElement | null>, onClose: () => void, initialFocus: string, returnFocusRef?: RefObject<HTMLElement | null>) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const restoreTo = returnFocusRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector<HTMLElement>(initialFocus)?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', key);
      if (restoreTo?.isConnected) restoreTo.focus();
    };
  }, [dialogRef, initialFocus, returnFocusRef]);
}
