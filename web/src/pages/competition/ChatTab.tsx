import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Megaphone, Activity, Users, Radio, Save, ExternalLink, X, Trash2, Shield } from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import { useLiveHub } from '../../live/useLiveHub';
import type { ChatMessage } from '../../types';

function toEmbedUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/embed/${v}`;
    }
    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '');
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (host === 'twitch.tv') {
      const channel = u.pathname.split('/').filter(Boolean)[0];
      if (channel) return `https://player.twitch.tv/?channel=${channel}&parent=${window.location.hostname}`;
    }
    return raw;
  } catch {
    return null;
  }
}

const IDENTITY_KEY = 'mg.chatIdentity';

interface ChatIdentity {
  firstName: string;
  team: string;
}

function loadIdentity(): ChatIdentity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as ChatIdentity;
    if (!v.firstName?.trim() || !v.team?.trim()) return null;
    return v;
  } catch { return null; }
}

function saveIdentity(v: ChatIdentity | null) {
  if (v) localStorage.setItem(IDENTITY_KEY, JSON.stringify(v));
  else localStorage.removeItem(IDENTITY_KEY);
}

export function ChatTab() {
  const { competition, reload } = useCompetition();
  const { user, hasRole } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [body, setBody] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const compStreamUrl = competition.streamUrl ?? null;
  const compStreamEmbed = compStreamUrl ? toEmbedUrl(compStreamUrl) : null;

  const teamOptions = useMemo(() => {
    return competition.teams.slice().sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [competition.teams]);

  const [identity, setIdentity] = useState<ChatIdentity | null>(() => loadIdentity());
  const [draftName, setDraftName] = useState('');
  const [draftTeam, setDraftTeam] = useState('');

  useEffect(() => {
    api.get<ChatMessage[]>(`/competitions/${competition.id}/chat`).then((r) => setMessages(r.data));
  }, [competition.id]);

  useLiveHub(competition.id, {
    onChatMessage: (m) => {
      const msg = m as ChatMessage;
      setMessages((cur) => cur.some((c) => c.id === msg.id) ? cur : [...cur, msg]);
    },
    onChatMessageDeleted: ({ id }) => {
      setMessages((cur) => cur.filter((m) => m.id !== id));
    },
  });

  async function deleteMessage(id: number) {
    if (!hasRole('Admin')) return;
    if (!confirm('Delete this message?')) return;
    await api.delete(`/competitions/${competition.id}/chat/${id}`);
    setMessages((cur) => cur.filter((m) => m.id !== id));
  }

  async function blockMessageAuthor(id: number) {
    if (!hasRole('Admin')) return;
    if (!confirm("Block this message author's IP from posting in chat?")) return;
    try {
      const { data } = await api.post<{ alreadyBlocked: boolean; ipAddress: string }>(
        `/competitions/${competition.id}/chat/${id}/block-author`, {}
      );
      alert(data.alreadyBlocked
        ? `IP ${data.ipAddress} was already blocked.`
        : `Blocked IP ${data.ipAddress}.`);
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message
        ?? 'Could not block — message may be too old to have an IP recorded.';
      alert(msg);
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  function applyIdentity() {
    const fn = draftName.trim();
    const tm = draftTeam.trim();
    if (!fn || !tm) return;
    const id = { firstName: fn, team: tm };
    setIdentity(id);
    saveIdentity(id);
    setDraftName(''); setDraftTeam('');
  }

  function clearIdentity() {
    setIdentity(null);
    saveIdentity(null);
  }

  const authorLabel = user
    ? user.fullName
    : identity ? `${identity.firstName} (${identity.team})` : null;

  async function send() {
    if (!body.trim() || !authorLabel) return;
    try {
      await api.post(`/competitions/${competition.id}/chat`, {
        body,
        authorName: authorLabel,
      });
      setBody('');
    } catch (e) {
      const status = (e as { response?: { status?: number } }).response?.status;
      if (status === 403) alert('Posting is blocked from this network. Contact an organiser.');
    }
  }

  async function announce() {
    if (!announcement.trim()) return;
    await api.post(`/competitions/${competition.id}/chat/announcement`, { body: announcement, tag: 'general' });
    setAnnouncement('');
  }

  const canSend = authorLabel != null && body.trim().length > 0;

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      {compStreamUrl && (
        <div className="lg:col-span-3">
          <CompStreamCard streamUrl={compStreamUrl} embed={compStreamEmbed} compName={competition.name} />
        </div>
      )}
      <div className="lg:col-span-2 card p-0 overflow-hidden flex flex-col" style={{ minHeight: '70vh' }}>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                m={m}
                isAdmin={hasRole('Admin')}
                onDelete={() => deleteMessage(m.id)}
                onBlock={() => blockMessageAuthor(m.id)}
              />
            ))}
          </AnimatePresence>
          {messages.length === 0 && <p className="text-slate-500 text-sm">No messages yet. Say hello!</p>}
        </div>
        <footer className="p-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
          {!authorLabel ? (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-500 dark:text-slate-300 flex items-center gap-1">
                <Users className="w-3 h-3" /> Enter your name and team to chat
              </p>
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  placeholder="First name"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyIdentity()}
                />
                <input
                  className="input flex-1"
                  placeholder="Team"
                  list="chat-team-options"
                  value={draftTeam}
                  onChange={(e) => setDraftTeam(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyIdentity()}
                />
                <datalist id="chat-team-options">
                  {teamOptions.map((t) => <option key={t.id} value={t.displayName} />)}
                </datalist>
                <button
                  className="btn-primary !py-1.5 !px-3 text-xs"
                  onClick={applyIdentity}
                  disabled={!draftName.trim() || !draftTeam.trim()}
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-300">
                <Users className="w-3 h-3" /> posting as <span className="font-semibold">{authorLabel}</span>
                {!user && (
                  <button onClick={clearIdentity} className="ml-auto btn-ghost !py-0.5 !px-1 text-[10px]" title="Change name/team">
                    Change
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  placeholder={`Message as ${authorLabel}…`}
                  value={body} onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && canSend && send()}
                />
                <button className="btn-primary" onClick={send} disabled={!canSend}>
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </>
          )}
        </footer>
      </div>

      <aside className="space-y-4">
        {hasRole('Admin') && (
          <div className="card p-4">
            <h3 className="font-semibold flex items-center gap-2 mb-2">
              <Megaphone className="w-5 h-5 text-amber-600" /> Announce
            </h3>
            <textarea
              className="input" rows={3} placeholder="Important update to broadcast…"
              value={announcement} onChange={(e) => setAnnouncement(e.target.value)}
            />
            <button className="btn-primary w-full mt-2" onClick={announce}>
              <Megaphone className="w-4 h-4" /> Send to everyone
            </button>
          </div>
        )}
        {hasRole('Admin') && (
          <CompStreamEditor competition={competition} onSaved={reload} />
        )}
        <div className="card p-4">
          <h3 className="font-semibold flex items-center gap-2 mb-2">
            <Activity className="w-5 h-5 text-brand-600" /> System feed
          </h3>
          <p className="text-sm text-slate-700 dark:text-slate-200">
            Session and score updates appear here automatically. Announcements from organisers show too.
          </p>
        </div>
      </aside>
    </div>
  );
}

function MessageBubble({
  m, isAdmin, onDelete, onBlock,
}: {
  m: ChatMessage;
  isAdmin: boolean;
  onDelete: () => void;
  onBlock: () => void;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const isSystem = m.type === 1;
  const isAnnouncement = m.type === 2;
  // System messages don't make sense to block (no IP / no human author).
  const canModerate = isAdmin && !isSystem;
  return (
    <motion.div
      initial={{ y: 8, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => canModerate && setActionsOpen((v) => !v)}
      className={`px-3 py-2 rounded-xl text-sm transition ${
        canModerate ? 'cursor-pointer hover:ring-2 hover:ring-brand-400/40' : ''
      } ${
        isAnnouncement
          ? 'bg-amber-100 dark:bg-amber-900/30 border-l-4 border-amber-500'
          : isSystem
            ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 italic'
            : 'bg-brand-50 dark:bg-brand-900/30'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-xs">
          {isAnnouncement && '📣 '}
          {m.authorName}
        </span>
        <span className="text-[10px] text-slate-500">
          {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <p className="whitespace-pre-wrap">{m.body}</p>
      {canModerate && actionsOpen && (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-current/10 pt-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => { setActionsOpen(false); onDelete(); }}
            className="btn-ghost !py-1 !px-2 text-[11px] text-rose-700 dark:text-rose-300"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
          <button
            onClick={() => { setActionsOpen(false); onBlock(); }}
            className="btn-ghost !py-1 !px-2 text-[11px] text-amber-700 dark:text-amber-300"
          >
            <Shield className="w-3.5 h-3.5" /> Block IP
          </button>
          <button
            onClick={() => setActionsOpen(false)}
            className="btn-ghost !py-1 !px-2 text-[11px] ml-auto"
          >
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
        </div>
      )}
    </motion.div>
  );
}

function CompStreamCard({
  streamUrl, embed, compName,
}: {
  streamUrl: string;
  embed: string | null;
  compName: string;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 p-2">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-500/90 text-white text-[10px] font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE
        </span>
        <Radio className="w-3.5 h-3.5 text-rose-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{compName}</div>
          <div className="text-[10px] text-slate-500 dark:text-slate-300 truncate">Competition stream</div>
        </div>
        <a href={streamUrl} target="_blank" rel="noreferrer" className="btn-ghost !py-1 !px-2 text-[11px]" title="Open in new tab">
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      {embed ? (
        <div className="relative w-full aspect-video bg-black">
          <iframe
            src={embed}
            title={compName}
            className="absolute inset-0 w-full h-full"
            frameBorder={0}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <div className="p-3 text-xs text-slate-500 dark:text-slate-300 break-all">{streamUrl}</div>
      )}
    </div>
  );
}

function CompStreamEditor({
  competition, onSaved,
}: {
  competition: { id: number; name: string; streamUrl?: string | null; location?: string | null;
    description?: string | null; latitude?: number | null; longitude?: number | null;
    what3Words?: string | null; appleMapsUrl?: string | null; startDate: string; endDate?: string | null;
    isActive: boolean; isArchived: boolean };
  onSaved: () => void;
}) {
  const [url, setUrl] = useState(competition.streamUrl ?? '');
  const [busy, setBusy] = useState(false);

  async function save(next: string | null) {
    setBusy(true);
    try {
      await api.put(`/competitions/${competition.id}`, {
        name: competition.name,
        location: competition.location,
        description: competition.description,
        latitude: competition.latitude,
        longitude: competition.longitude,
        what3Words: competition.what3Words,
        appleMapsUrl: competition.appleMapsUrl,
        startDate: competition.startDate,
        endDate: competition.endDate,
        isActive: competition.isActive,
        isArchived: competition.isArchived,
        streamUrl: next,
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 space-y-2">
      <h3 className="font-semibold flex items-center gap-2">
        <Radio className="w-5 h-5 text-rose-500" /> Competition stream
      </h3>
      <p className="text-xs text-slate-600 dark:text-slate-200">
        One YouTube or Twitch URL for the whole event. Embeds above the chat for everyone.
      </p>
      <div className="flex gap-1.5">
        <input
          className="input !py-1.5 text-xs flex-1 min-w-0"
          placeholder="https://youtu.be/… or https://twitch.tv/channel"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          onClick={() => save(url.trim() ? url.trim() : null)}
          disabled={busy || url === (competition.streamUrl ?? '')}
          className="btn-primary !py-1.5 !px-2 text-[11px]"
        >
          <Save className="w-3 h-3" /> {busy ? '…' : 'Save'}
        </button>
        {competition.streamUrl && (
          <button
            onClick={() => { setUrl(''); save(null); }}
            disabled={busy}
            className="btn-ghost !py-1.5 !px-1.5 text-[11px]"
            title="Clear stream"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}
