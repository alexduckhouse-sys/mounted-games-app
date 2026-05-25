import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Radio, ExternalLink, Save, X } from 'lucide-react';
import { displaySectionName } from '../../lib/section';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { Session } from '../../types';

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

export function LiveTab() {
  const { competition, reload } = useCompetition();
  const { canEdit } = useAuth();
  const isAdmin = canEdit();

  const sessions = useMemo(
    () => competition.sessions.filter((s) => (s.kind ?? (s.isBreak ? 1 : 0)) === 0),
    [competition.sessions]
  );
  const withStream = sessions.filter((s) => s.streamUrl);

  return (
    <div className="space-y-3">
      <div className="card p-3">
        <h2 className="font-semibold flex items-center gap-2 text-sm">
          <Radio className="w-4 h-4 text-rose-500" /> Live streams
        </h2>
        <p className="text-[11px] text-slate-500 dark:text-slate-300 mt-1">
          One stream per arena/session. {isAdmin ? 'Paste a YouTube or Twitch URL on a session to add it.' : 'Streams appear here once an organiser adds them.'}
        </p>
      </div>

      {withStream.length === 0 && !isAdmin && (
        <div className="card p-4 text-sm text-slate-500 dark:text-slate-300">
          No streams live right now.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {withStream.map((s, i) => (
          <StreamCard key={s.id} s={s} delay={i * 0.03} canEdit={isAdmin} onUpdated={reload} competitionId={competition.id} />
        ))}
      </div>

      {isAdmin && (
        <div className="card p-3 space-y-2">
          <h3 className="font-semibold text-sm">Manage stream URLs</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-300">
            Add or update a stream link for any session.
          </p>
          <div className="space-y-2">
            {sessions.map((s) => (
              <StreamEditor key={s.id} s={s} competitionId={competition.id} onSaved={reload} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StreamCard({ s, delay, canEdit, onUpdated, competitionId }: {
  s: Session; delay: number; canEdit: boolean; onUpdated: () => void; competitionId: number;
}) {
  const embed = s.streamUrl ? toEmbedUrl(s.streamUrl) : null;

  async function clearStream() {
    await api.put(`/competitions/${competitionId}/sessions/${s.id}/stream`, { streamUrl: null });
    onUpdated();
  }

  return (
    <motion.div
      initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay }}
      className="card overflow-hidden"
    >
      <div className="flex items-center gap-2 p-3">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-500/90 text-white text-[10px] font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{s.name}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-300 truncate">
            {s.arenaName ?? 'Arena TBC'}{s.sectionName ? ` · ${displaySectionName(s.sectionName)}` : ''}
          </div>
        </div>
        <a href={s.streamUrl!} target="_blank" rel="noreferrer" className="btn-ghost !py-1 !px-2 text-[11px]">
          <ExternalLink className="w-3 h-3" /> Open
        </a>
        {canEdit && (
          <button onClick={clearStream} className="btn-ghost !py-1 !px-2 text-[11px]" title="Remove stream">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {embed ? (
        <div className="relative w-full aspect-video bg-black">
          <iframe
            src={embed}
            title={s.name}
            className="absolute inset-0 w-full h-full"
            frameBorder={0}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <div className="p-4 text-xs text-slate-500 dark:text-slate-300 break-all">{s.streamUrl}</div>
      )}
    </motion.div>
  );
}

function StreamEditor({ s, competitionId, onSaved }: { s: Session; competitionId: number; onSaved: () => void }) {
  const [url, setUrl] = useState(s.streamUrl ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.put(`/competitions/${competitionId}/sessions/${s.id}/stream`, {
        streamUrl: url.trim() ? url.trim() : null,
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold truncate">{s.name}</div>
        <div className="text-[10px] text-slate-500 dark:text-slate-300 truncate">
          {s.arenaName ?? 'Arena TBC'}{s.sectionName ? ` · ${displaySectionName(s.sectionName)}` : ''}
        </div>
      </div>
      <input
        className="input !py-1 text-xs flex-1 min-w-0"
        placeholder="https://youtu.be/… or twitch.tv/channel"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <button onClick={save} disabled={busy || url === (s.streamUrl ?? '')} className="btn-primary !py-1 !px-2 text-[11px]">
        <Save className="w-3 h-3" /> {busy ? '…' : 'Save'}
      </button>
    </div>
  );
}
