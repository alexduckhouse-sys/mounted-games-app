import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Film, Layers, ListOrdered, Megaphone, Mic, MicOff, Pause, Play, RefreshCw, Table2, Trophy, Video } from 'lucide-react';
import { api } from '../../api';
import { scorerApi } from '../../offline/scorerLink';
import type { LiveStream, LiveStreamsResponse } from '../../types';

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
  arenaName,
  sectionId,
  activeHeatId,
  compact,
  useScorerClient,
}: StreamControlStripProps) {
  const client = useScorerClient ? scorerApi : api;
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<number | null>(null);
  const [activeOverlay, setActiveOverlay] = useState<string>('none');
  const [zoom, setZoom] = useState<number>(1);
  const [muted, setMuted] = useState<boolean>(false);
  const [paused, setPaused] = useState<boolean>(false);
  const [announcement, setAnnouncement] = useState<string>('');
  const [postingChat, setPostingChat] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadStreams = useCallback(() => {
    return Promise.resolve(client.get<LiveStreamsResponse>(`/competitions/${competitionId}/streams`))
      .then((res) => {
        const list = Array.isArray(res?.data?.streams) ? res.data.streams : [];
        const active = list.filter(
          (s) =>
            s.status !== 2 &&
            (!arenaName || s.arenaName.trim().toLowerCase() === arenaName.trim().toLowerCase()),
        );
        setStreams(active);
        const chosen = active.find((s) => s.id === selectedStreamId) ?? active[0];
        if (chosen) {
          setMuted(Boolean(chosen.audioMuted));
          setPaused(chosen.status === 1);
        }
      })
      .catch(() => {
        // Gracefully ignore missing or offline stream endpoint
      });
  }, [client, competitionId, arenaName, selectedStreamId]);

  useEffect(() => {
    void loadStreams();
  }, [loadStreams]);

  const activeStream = streams.find((s) => s.id === selectedStreamId) ?? streams[0] ?? null;

  async function sendStreamCommand(
    command: string,
    value: string,
    statusLabel: string,
    targetStreamId?: number,
  ) {
    const streamId = targetStreamId ?? activeStream?.id ?? null;
    const detail = {
      competitionId,
      streamId,
      command,
      value,
      sectionId,
      heatId: activeHeatId,
    };

    window.dispatchEvent(new CustomEvent('mg-stream-overlay-command', { detail }));
    if (command === 'showOverlay') {
      localStorage.setItem(`mg.streamOverlay.${competitionId}`, value);
    }

    if (streamId != null) {
      try {
        await client.post(`/competitions/${competitionId}/streams/${streamId}/command`, {
          command,
          value,
        });
      } catch {
        // Still keep local overlay & status feedback
      }
    }

    setStatusMessage(`Sent to stream: ${statusLabel}`);
  }

  async function triggerOverlay(kind: 'lanes' | 'heat' | 'toplist' | 'upNext' | 'none', label: string) {
    setActiveOverlay(kind);
    const value =
      kind === 'none'
        ? 'none'
        : kind === 'toplist'
          ? JSON.stringify({ kind: 'toplist', sectionId })
          : JSON.stringify({ kind, sectionId, heatId: activeHeatId });
    await sendStreamCommand('showOverlay', value, label);
  }

  async function submitAnnouncement(e: FormEvent) {
    e.preventDefault();
    const body = announcement.trim();
    setPostingChat(true);
    try {
      await client.post(`/competitions/${competitionId}/chat`, { body, type: 1 });
      setAnnouncement('');
      setStatusMessage(`Posted to stream: ${body}`);
    } catch {
      setStatusMessage('Could not post stream announcement.');
    } finally {
      setPostingChat(false);
    }
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
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Stream overlay triggers">
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
              setZoom(z);
              void sendStreamCommand('setZoom', String(z), `Zoom ${z}x`);
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
            setMuted(next);
            void sendStreamCommand('mute', String(next), next ? 'Mic muted' : 'Mic on');
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
            setPaused(next);
            void sendStreamCommand('pause', String(next), next ? 'Stream paused (Back soon)' : 'Stream resumed');
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
              placeholder="Post a live announcement to the stream & event feed…"
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

      {statusMessage && (
        <p role="status" className="m-0 text-xs font-semibold text-[rgb(var(--mg-heading))]">
          {statusMessage}
        </p>
      )}
    </section>
  );
}
