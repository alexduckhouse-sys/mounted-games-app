import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Layers, Megaphone, QrCode, Radio, Sliders, Sparkles, Video } from 'lucide-react';
import { QrCode as QrCodeImage } from '../../components/QrCode';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { displaySectionName } from '../../lib/section';
import { DEFAULT_OVERLAY, overlayRequest, parseOverlay } from '../../lib/overlays';
import { useCompetition } from './context';
import type { StreamCommand, StreamOverlay } from '../../types';

type OverlayCardMode = 'none' | 'toplist' | 'heat' | 'lanes' | 'next';

export function ProducePage() {
  const { competition, streams, overlay: ctxOverlay, saveOverlay } = useCompetition();
  const { canOrganise, user } = useAuth();
  const allowed = canOrganise(competition);

  const liveStreams = useMemo(() => streams.filter((s) => s.status !== 2), [streams]);
  const [selectedStreamId, setSelectedStreamId] = useState<number | null>(null);
  const activeStream = useMemo(
    () => liveStreams.find((s) => s.id === selectedStreamId) ?? liveStreams[0] ?? null,
    [liveStreams, selectedStreamId],
  );

  const [localOverlay, setLocalOverlay] = useState<StreamOverlay | null>(null);
  const overlay = (saveOverlay ? ctxOverlay : localOverlay ?? ctxOverlay) ?? DEFAULT_OVERLAY;
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const [announceText, setAnnounceText] = useState('');
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [showDualCamQr, setShowDualCamQr] = useState(false);
  const [secondAngle, setSecondAngle] = useState('Finish line');

  const lookObj = (overlay.look ?? {}) as Record<string, unknown>;
  const rawMode = typeof lookObj.liveCard === 'string' ? lookObj.liveCard : overlay.bannerText;
  const activeCard: OverlayCardMode =
    rawMode === 'toplist' || rawMode === 'heat' || rawMode === 'lanes' || rawMode === 'next' ? rawMode : 'none';
  const activeSectionId =
    typeof lookObj.liveSectionId === 'number'
      ? lookObj.liveSectionId
      : (competition.sections[0]?.id ?? null);

  const targetArena = activeStream?.arenaName || competition.sessions[0]?.arenaName || 'Arena 1';

  const dualCamUrl = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/competitions/${competition.id}/broadcast?arena=${encodeURIComponent(targetArena)}&angle=${encodeURIComponent(secondAngle)}`;
  }, [competition.id, targetArena, secondAngle]);

  if (!allowed) {
    return (
      <div className="mg-card p-6">
        <h2 className="text-xl font-bold">Remote stream controller</h2>
        <p className="mt-1 text-sm text-[rgb(var(--mg-muted))]">
          Only the competition organiser or team can control the live stream.
        </p>
      </div>
    );
  }

  const pushOverlay = async (patch: Partial<StreamOverlay>, note?: string): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setStatusNote(null);
    try {
      if (saveOverlay) {
        const result = await saveOverlay((o) => ({ ...o, ...patch }));
        if (result !== 'saved') {
          setStatusNote(result === 'conflict' ? 'The overlay changed on another device. Check it and try again.' : 'Could not update the overlay. Try again.');
          return false;
        }
      } else {
        const { data } = await api.put<StreamOverlay>(`/competitions/${competition.id}/overlays`, overlayRequest({ ...overlay, ...patch }));
        const parsed = parseOverlay(data);
        if (!parsed) throw new Error('Invalid overlay response');
        setLocalOverlay(parsed);
      }
      if (note) setStatusNote(note);
      return true;
    } catch {
      setStatusNote('Could not update the overlay. Try again.');
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const selectOverlayCard = async (mode: OverlayCardMode, sectionId: number | null = activeSectionId) => {
    const nextLook = { ...lookObj, liveCard: mode, liveSectionId: sectionId };
    const nextBanner =
      mode === 'none'
        ? overlay.bannerText && ['toplist', 'heat', 'lanes', 'next'].includes(overlay.bannerText)
          ? null
          : overlay.bannerText
        : mode;
    await pushOverlay(
      { look: nextLook, bannerText: nextBanner },
      mode === 'none' ? 'Overlay cleared' : `Showing ${mode} centred on stream`,
    );
  };

  const sendCommand = async (streamId: number, command: StreamCommand['command'], value?: string, note?: string) => {
    try {
      await api.post(`/competitions/${competition.id}/streams/${streamId}/command`, { command, value });
      if (note) setStatusNote(note);
    } catch {
      setStatusNote('Could not send command to camera.');
    }
  };

  const postAnnouncement = async () => {
    const text = announceText.trim();
    if (!text) return;
    if (!(await pushOverlay({ bannerText: text, bannerStyle: 1 }, 'Banner posted to stream'))) return;
    if (!user?.roles.includes('Admin')) { setAnnounceText(''); return; }
    try {
      await api.post(`/competitions/${competition.id}/chat/announcement`, {
        body: text, message: text, author: user?.fullName || 'Organiser', tag: 'banner',
      });
      setAnnounceText((current) => current.trim() === text ? '' : current);
    } catch {
      setStatusNote('The stream banner was saved, but the announcement was not sent. Try again.');
    }
  };

  const clearAnnouncement = async () => {
    await pushOverlay({ bannerText: null }, 'Banner cleared');
  };

  return (
    <fieldset disabled={busy} className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4 p-3 sm:p-4">
      <div className="mg-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="flex items-center gap-2">
            <Sliders className="h-5 w-5 text-[rgb(var(--mg-accent))]" aria-hidden="true" />
            <h1 className="text-xl font-bold">Remote stream controller</h1>
          </div>
          <p className="mt-0.5 text-xs text-[rgb(var(--mg-muted))]">
            Control centred stream overlays, switch between multiple camera phones, and trigger replays without touching the tripod phone.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="mg-btn mg-btn-secondary text-xs"
            onClick={() => setShowDualCamQr((v) => !v)}
          >
            <QrCode className="mr-1.5 h-4 w-4 inline" aria-hidden="true" />
            Add 2nd camera phone
          </button>
          <Link className="mg-btn mg-btn-primary text-xs" to={`/competitions/${competition.id}/broadcast`}>
            <Video className="mr-1.5 h-4 w-4 inline" aria-hidden="true" />
            Open camera on this phone
          </Link>
        </div>
      </div>

      {statusNote && (
        <div role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          {statusNote}
        </div>
      )}

      {/* Dual-camera QR modal / card */}
      {showDualCamQr && (
        <div role="region" aria-label="Add second camera phone" className="mg-card flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Pair a 2nd camera phone ({targetArena})</h2>
            <button
              type="button"
              className="mg-btn mg-btn-secondary text-xs"
              onClick={() => setShowDualCamQr(false)}
            >
              Close
            </button>
          </div>
          <p className="text-xs text-[rgb(var(--mg-muted))]">
            Scan this QR code on a second phone to stream a second angle (e.g. Finish line or Collecting ring) for {targetArena}. Viewers and this remote can switch angles live.
          </p>
          <div className="flex flex-wrap gap-2">
            {['Finish line', 'Changeover line', 'Collecting ring', 'Main stand'].map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={secondAngle === preset}
                className="mg-stream-chip text-xs"
                onClick={() => setSecondAngle(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <QrCodeImage value={dualCamUrl} label="Second camera link" className="h-32 w-32 shrink-0 rounded-xl bg-white p-2" />
            <div className="min-w-0 flex-1">
              <div className="break-all rounded-lg bg-[rgb(var(--mg-surface-alt))] p-2 font-mono text-xs">
                {dualCamUrl}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Active cameras & Dual-Camera Switcher */}
      <div className="mg-card flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-[rgb(var(--mg-accent))]" aria-hidden="true" />
            <h2 className="text-sm font-bold">Active cameras &amp; multi-angle switcher ({liveStreams.length})</h2>
          </div>
        </div>
        {liveStreams.length === 0 ? (
          <p className="text-xs text-[rgb(var(--mg-muted))]">
            No camera is broadcasting right now. Start a camera on the tripod phone or tap &ldquo;Open camera on this phone&rdquo;.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {liveStreams.map((s) => {
              const isSelected = activeStream?.id === s.id;
              return (
                <div
                  key={s.id}
                  className={`flex items-center justify-between gap-2 rounded-xl border p-3 ${
                    isSelected
                      ? 'border-[rgb(var(--mg-accent))] bg-[rgb(var(--mg-accent)/0.08)]'
                      : 'border-[rgb(var(--mg-line))]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-bold text-sm">
                      <Radio className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />
                      <span className="truncate">{s.arenaName} · {s.angleName}</span>
                    </div>
                    <div className="text-xs text-[rgb(var(--mg-muted))]">
                      {s.viewerCount} watching {s.status === 1 ? '· Paused' : '· Live'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="mg-btn mg-btn-secondary text-xs"
                      aria-pressed={isSelected}
                      onClick={() => {
                        setSelectedStreamId(s.id);
                        void sendCommand(s.id, 'selectAngle', String(s.id), `Switched program to ${s.angleName}`);
                      }}
                    >
                      {isSelected ? 'Controlling' : 'Cut to angle'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeStream && (
          <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-[rgb(var(--mg-line))] pt-3">
            <span className="text-xs font-semibold text-[rgb(var(--mg-muted))]">
              Remote camera ({activeStream.angleName}):
            </span>
            {[1, 2, 3].map((z) => (
              <button
                key={z}
                type="button"
                className="mg-stream-chip text-xs"
                onClick={() => void sendCommand(activeStream.id, 'setZoom', String(z), `Camera zoom set to ${z}x`)}
              >
                {z}x Zoom
              </button>
            ))}
            <button
              type="button"
              className="mg-stream-chip text-xs"
              onClick={() => void sendCommand(activeStream.id, 'setQualityPreset', 'auto', 'Switched camera to Auto HD')}
            >
              Auto HD
            </button>
            <button
              type="button"
              className="mg-stream-chip text-xs"
              onClick={() => void sendCommand(activeStream.id, 'setQualityPreset', '480p', 'Switched camera to 480p Saver')}
            >
              480p Saver
            </button>
            <button
              type="button"
              className="mg-stream-chip text-xs"
              onClick={() => void sendCommand(activeStream.id, 'saveReplay', '15', 'Replay requested on camera')}
            >
              Save 15s replay
            </button>
          </div>
        )}
      </div>

      {/* Centred Live Stream Overlays */}
      <div className="mg-card flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-[rgb(var(--mg-accent))]" aria-hidden="true" />
            <h2 className="text-sm font-bold">Centred stream overlays</h2>
          </div>
          {activeCard !== 'none' && (
            <button
              type="button"
              className="mg-btn mg-btn-secondary text-xs"
              onClick={() => void selectOverlayCard('none')}
            >
              Hide overlay
            </button>
          )}
        </div>
        <p className="text-xs text-[rgb(var(--mg-muted))]">
          Popups appear centred over the video covering most of the screen and automatically hide the bottom caption bar while open.
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: 'none', label: 'Off' },
              { id: 'toplist', label: 'Toplist' },
              { id: 'heat', label: 'Heat table' },
              { id: 'lanes', label: 'Lanes' },
              { id: 'next', label: 'Up next' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={activeCard === item.id}
              className="mg-stream-chip text-xs"
              onClick={() => void selectOverlayCard(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {activeCard === 'toplist' && competition.sections.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {competition.sections.map((sec) => (
              <button
                key={sec.id}
                type="button"
                aria-pressed={activeSectionId === sec.id}
                className="mg-stream-chip text-xs"
                onClick={() => void selectOverlayCard('toplist', sec.id)}
              >
                {displaySectionName(sec.displayName)}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t border-[rgb(var(--mg-line))] pt-3">
          <button
            type="button"
            aria-pressed={overlay.scoreCardMode !== 2}
            className="mg-stream-chip text-xs"
            onClick={() => void pushOverlay({ scoreCardMode: overlay.scoreCardMode === 2 ? 0 : 2 })}
          >
            Score strip
          </button>
          <button
            type="button"
            aria-pressed={overlay.stripMode !== 2}
            className="mg-stream-chip text-xs"
            onClick={() => void pushOverlay({ stripMode: overlay.stripMode === 2 ? 0 : 2 })}
          >
            Lower third
          </button>
          <button
            type="button"
            aria-pressed={overlay.sponsorMode !== 2}
            className="mg-stream-chip text-xs"
            onClick={() => void pushOverlay({ sponsorMode: overlay.sponsorMode === 2 ? 0 : 2 })}
          >
            <Sparkles aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
            Sponsors
          </button>
        </div>
      </div>

      {/* Live Announcement / Banner */}
      <div className="mg-card flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-[rgb(var(--mg-accent))]" aria-hidden="true" />
          <h2 className="text-sm font-bold">Live announcement banner</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="Banner message"
            className="mg-input flex-1"
            placeholder="Message for viewers (e.g. Finals start in 10 mins)"
            value={announceText}
            maxLength={140}
            onChange={(e) => setAnnounceText(e.target.value)}
          />
          <button type="button" className="mg-btn mg-btn-primary" onClick={() => void postAnnouncement()}>
            Post
          </button>
          {overlay.bannerText && !['toplist', 'heat', 'lanes', 'next'].includes(overlay.bannerText) && (
            <button type="button" className="mg-btn mg-btn-secondary" onClick={() => void clearAnnouncement()}>
              Clear banner
            </button>
          )}
        </div>
      </div>
    </fieldset>
  );
}
