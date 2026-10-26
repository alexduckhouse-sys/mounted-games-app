import { useCallback, useContext, useEffect, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Film, Layers, ListOrdered, Megaphone, Mic, MicOff, Pause, Play, RefreshCw, Table2, Trophy, Video } from 'lucide-react';
import { api } from '../../api';
import { scorerApi } from '../../offline/scorerLink';
import { Notice } from '../Notice';
import { useToast } from '../Toast';
import { CompetitionContext } from '../../pages/competition/context';
import type { LiveStream, LiveStreamsResponse, StreamCommand } from '../../types';

export interface StreamControlStripProps {
  competitionId: number;
  arenaName?: string | null;
  sectionId?: number | null;
  activeHeatId?: number | null;
  compact?: boolean;
  useScorerClient?: boolean;
}

export function StreamControlStrip({
  competitionId,
  arenaName = null,
  sectionId = null,
  compact = false,
  useScorerClient = false,
}: StreamControlStripProps) {
  const client = useScorerClient ? scorerApi : api;
  const context = useContext(CompetitionContext);
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<number | null>(null);
  const [activeOverlay, setActiveOverlay] = useState<string>('none');
  const [zoom, setZoom] = useState<number>(1);
  const [muted, setMuted] = useState<boolean>(false);
  const [paused, setPaused] = useState<boolean>(false);
  const [announcement, setAnnouncement] = useState<string>('');
  const [postingChat, setPostingChat] = useState<boolean>(false);
  // A quick "it worked" is a toast; a problem or a "nothing to send it to" stays on the strip until the next tap.
  const toast = useToast();
  const [problem, setProblem] = useState<{ text: string; tone?: 'info'; actionLabel?: string; onAction?: () => void } | null>(null);
  const overlayGroup = useRef<HTMLDivElement>(null);

  const loadStreams = useCallback(() => {
    try {
      const req = client.get<LiveStreamsResponse>(`/competitions/${competitionId}/streams`);
      return Promise.resolve(req)
        .then((res) => {
          const list = Array.isArray(res?.data?.streams) ? res.data.streams : [];
          const active = list.filter((s) => {
            if (!s || s.status === 2) return false;
            if (!arenaName) return true;
            return s.arenaName?.trim().toLowerCase() === arenaName.trim().toLowerCase();
          });
          setStreams(active);
          const chosen = active.find((s) => s.id === selectedStreamId) ?? active[0] ?? null;
          if (chosen) {
            setMuted(Boolean(chosen.audioMuted));
            setPaused(chosen.status === 1);
          }
        })
        .catch(() => {
          // Gracefully ignore missing or offline stream endpoint
        });
    } catch {
      return Promise.resolve();
    }
  }, [client, competitionId, arenaName, selectedStreamId]);

  useEffect(() => {
    void loadStreams();
  }, [loadStreams]);

  const activeStream = streams.find((s) => s.id === selectedStreamId) ?? streams[0] ?? null;

  async function sendStreamCommand(
    command: StreamCommand['command'], value: string | null, statusLabel: string, targetStreamId?: number,
  ): Promise<boolean> {
    const streamId = targetStreamId ?? activeStream?.id;
    setProblem(null);
    if (streamId == null) { setProblem({ text: 'No camera is broadcasting.', tone: 'info' }); return false; }
    try {
      await client.post(`/competitions/${competitionId}/streams/${streamId}/command`, { command, value });
      toast.show(`Requested: ${statusLabel}`);
      return true;
    } catch {
      setProblem({ text: 'Couldn’t reach the camera phone. Check your signal and try again.', actionLabel: 'Try again', onAction: () => void sendStreamCommand(command, value, statusLabel, targetStreamId) });
      return false;
    }
  }

  async function triggerOverlay(kind: 'lanes' | 'heat' | 'toplist' | 'upNext' | 'none', label: string) {
    setProblem(null);
    if (useScorerClient || !context?.saveOverlay) {
      setProblem({ text: 'Sign in as an organiser to change overlays.', tone: 'info' });
      return;
    }
    const tryAgain = { actionLabel: 'Try again', onAction: () => void triggerOverlay(kind, label) };
    try {
      const outcome = await context.saveOverlay((overlay) => ({
        ...overlay, look: { ...(overlay.look as Record<string, unknown>), liveCard: kind === 'upNext' ? 'next' : kind, liveSectionId: sectionId },
      }));
      if (outcome !== 'saved') {
        setProblem(outcome === 'conflict'
          ? { text: 'The overlay changed on another phone. Check it and try again.', actionLabel: 'Show me', onAction: () => overlayGroup.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus() }
          : { text: 'Couldn’t update the overlay. Check your signal and try again.', ...tryAgain });
        return;
      }
      setActiveOverlay(kind);
      toast.show(`Showing: ${label}`);
    } catch { setProblem({ text: 'Couldn’t update the overlay. Check your signal and try again.', ...tryAgain }); }
  }

  async function submitAnnouncement(e: FormEvent) {
    e.preventDefault();
    const body = announcement.trim();
    if (!body || postingChat || useScorerClient || !context?.saveOverlay) return;
    setPostingChat(true);
    setProblem(null);
    try {
      const outcome = await context.saveOverlay((overlay) => ({ ...overlay, bannerText: body, bannerStyle: 1 }));
      if (outcome !== 'saved') throw new Error('Banner was not saved');
      setAnnouncement((current) => current.trim() === body ? '' : current);
      toast.show('Stream banner saved.');
    } catch { setProblem({ text: 'Couldn’t save the stream banner. Check your signal and try again.' }); }
    finally { setPostingChat(false); }
  }

  return (
    <section
      aria-label="Live stream control strip"
      className={`mg-card flex flex-col gap-2.5 ${compact ? 'p-3' : 'p-3.5 sm:p-4'}`}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wider text-[rgb(var(--mg-heading))]">
          <Video className="h-4 w-4 text-[rgb(var(--mg-red))]" aria-hidden="true" />
          <span>Live Stream &amp; Overlay Controls</span>
          {activeStream ? (
            <span className="rounded-full bg-[rgb(var(--mg-ok))] px-2 py-0.5 text-[11px] font-bold text-white">
              LIVE · {activeStream.angleName} ({activeStream.viewerCount} watching)
            </span>
          ) : (
            <span className="rounded-full bg-[rgb(var(--mg-tint))] px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-[rgb(var(--mg-muted))]">
              Ready for stream overlays &amp; remote camera
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => void loadStreams()}
          aria-label="Refresh stream cameras"
          className="mg-btn mg-btn-secondary !min-h-8 !px-2.5 text-xs"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
        </button>
      </div>

      {/* 1. Stream Overlay Triggers */}
      <div ref={overlayGroup} className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Stream overlay triggers">
        <button
          type="button"
          aria-pressed={activeOverlay === 'lanes'}
          onClick={() => void triggerOverlay('lanes', 'Show Lanes')}
          className={`mg-btn !min-h-9 !px-2.5 text-xs font-semibold ${
            activeOverlay === 'lanes' ? 'mg-btn-primary' : 'mg-btn-secondary'
          }`}
        >
          <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" /> Show Lanes on Stream
        </button>
        <button
          type="button"
          aria-pressed={activeOverlay === 'heat'}
          onClick={() => void triggerOverlay('heat', 'Show Heat Table')}
          className={`mg-btn !min-h-9 !px-2.5 text-xs font-semibold ${
            activeOverlay === 'heat' ? 'mg-btn-primary' : 'mg-btn-secondary'
          }`}
        >
          <Table2 className="h-3.5 w-3.5" aria-hidden="true" /> Show Heat Table on Stream
        </button>
        <button
          type="button"
          aria-pressed={activeOverlay === 'toplist'}
          onClick={() => void triggerOverlay('toplist', 'Show Toplist')}
          className={`mg-btn !min-h-9 !px-2.5 text-xs font-semibold ${
            activeOverlay === 'toplist' ? 'mg-btn-primary' : 'mg-btn-secondary'
          }`}
        >
          <Trophy className="h-3.5 w-3.5" aria-hidden="true" /> Show Toplist on Stream
        </button>
        <button
          type="button"
          aria-pressed={activeOverlay === 'upNext'}
          onClick={() => void triggerOverlay('upNext', 'Show Up Next')}
          className={`mg-btn !min-h-9 !px-2.5 text-xs font-semibold ${
            activeOverlay === 'upNext' ? 'mg-btn-primary' : 'mg-btn-secondary'
          }`}
        >
          <Layers className="h-3.5 w-3.5" aria-hidden="true" /> Show Up Next on Stream
        </button>
        <button
          type="button"
          aria-pressed={activeOverlay === 'none'}
          onClick={() => void triggerOverlay('none', 'Hide Overlay')}
          className="mg-btn mg-btn-secondary !min-h-9 !px-2.5 text-xs font-semibold"
        >
          {activeOverlay === 'none' ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
          Hide Stream Overlay
        </button>
      </div>

      {/* Camera angle switcher when multiple streams exist */}
      {streams.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="Camera angle switcher">
          <span className="font-bold text-[rgb(var(--mg-muted))]">Camera angle:</span>
          {streams.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={activeStream?.id === s.id}
              onClick={() => {
                setSelectedStreamId(s.id);
                setMuted(Boolean(s.audioMuted));
                setPaused(s.status === 1);
                void sendStreamCommand('selectAngle', String(s.id), `Angle: ${s.angleName}`, s.id);
              }}
              className={`mg-btn !min-h-8 !px-2.5 text-xs font-semibold ${
                activeStream?.id === s.id ? 'mg-btn-primary' : 'mg-btn-secondary'
              }`}
            >
              {s.angleName}
            </button>
          ))}
        </div>
      )}

      {/* 2. Camera & Replay Controls */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="Camera and replay controls">
        {([1, 2, 3] as const).map((z) => (
          <button
            key={z}
            type="button"
            aria-label={`Remote zoom ${z}x`}
            aria-pressed={zoom === z}
            onClick={() => {
              void sendStreamCommand('setZoom', String(z), `Zoom ${z}x`).then((ok) => { if (ok) setZoom(z); });
            }}
            className={`mg-btn !min-h-8 !px-2.5 text-xs font-bold ${
              zoom === z ? 'mg-btn-primary' : 'mg-btn-secondary'
            }`}
          >
            {z}x
          </button>
        ))}

        <button
          type="button"
          aria-pressed={muted}
          aria-label={muted ? 'Unmute stream mic' : 'Mute stream mic'}
          onClick={() => {
            const next = !muted;
            void sendStreamCommand('mute', String(next), next ? 'Mic muted' : 'Mic on').then((ok) => { if (ok) setMuted(next); });
          }}
          className="mg-btn mg-btn-secondary !min-h-8 !px-2.5 text-xs font-semibold"
        >
          {muted ? <MicOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Mic className="h-3.5 w-3.5" aria-hidden="true" />}
          {muted ? 'Mic muted' : 'Mic on'}
        </button>

        <button
          type="button"
          aria-pressed={paused}
          aria-label={paused ? 'Resume stream' : 'Pause stream (Back soon)'}
          onClick={() => {
            const next = !paused;
            void sendStreamCommand('pause', String(next), next ? 'Stream paused (Back soon)' : 'Stream resumed').then((ok) => { if (ok) setPaused(next); });
          }}
          className="mg-btn mg-btn-secondary !min-h-8 !px-2.5 text-xs font-semibold"
        >
          {paused ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : <Pause className="h-3.5 w-3.5" aria-hidden="true" />}
          {paused ? 'Resume' : 'Back soon'}
        </button>

        <button
          type="button"
          onClick={() => void sendStreamCommand('saveReplay', '15', 'Save 15s Replay')}
          className="mg-btn mg-btn-secondary !min-h-8 !px-2.5 text-xs font-semibold"
        >
          <Film className="h-3.5 w-3.5" aria-hidden="true" /> Save 15s Replay
        </button>

        <button
          type="button"
          onClick={() => void sendStreamCommand('saveReplay', '30', 'Save 30s Replay')}
          className="mg-btn mg-btn-secondary !min-h-8 !px-2.5 text-xs font-semibold"
        >
          <Film className="h-3.5 w-3.5" aria-hidden="true" /> Save 30s Replay
        </button>
      </div>

      {/* 3. Quick Stream / PA Announcement */}
      {!useScorerClient && (
        <form onSubmit={submitAnnouncement} className="flex flex-wrap items-center gap-2 pt-0.5">
          <div className="flex min-w-[200px] flex-1 items-center gap-1.5">
            <Megaphone className="h-3.5 w-3.5 shrink-0 text-[rgb(var(--mg-muted))]" aria-hidden="true" />
            <input
              type="text"
              aria-label="Quick stream announcement"
              placeholder="Message for the stream banner…"
              maxLength={140}
              value={announcement}
              onChange={(e) => setAnnouncement(e.target.value)}
              className="input !min-h-9 flex-1 py-1 text-xs"
            />
          </div>
          <button
            type="submit"
            disabled={postingChat || !announcement.trim()}
            className="mg-btn mg-btn-secondary !min-h-9 !px-3 text-xs font-bold"
          >
            {postingChat ? 'Posting…' : 'Post to stream'}
          </button>
        </form>
      )}

      {problem && <Notice tone={problem.tone} actionLabel={problem.actionLabel} onAction={problem.onAction}>{problem.text}</Notice>}
      {toast.node}
    </section>
  );
}
