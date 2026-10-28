import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Layers, Megaphone, QrCode, Radio, Sliders, Sparkles, Video } from 'lucide-react';
import { Notice } from '../../components/Notice';
import { Sheet } from '../../components/Sheet';
import { useDockAction } from '../../components/TickerContext';
import { PageProblem } from '../../components/PageProblem';
import { QrCode as QrCodeImage } from '../../components/QrCode';
import { useToast } from '../../components/Toast';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useT } from '../../i18n/LanguageContext';
import { displaySectionName } from '../../lib/section';
import { DEFAULT_OVERLAY, overlayRequest, parseOverlay } from '../../lib/overlays';
import { useCompetition } from './context';
import type { StreamCommand, StreamOverlay } from '../../types';

type OverlayCardMode = 'none' | 'toplist' | 'heat' | 'lanes' | 'next';

export function ProducePage() {
  const t = useT();
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
  // Quick confirmations are toasts; anything that went wrong is a strip with a way to try again.
  const toast = useToast();
  const [problem, setProblem] = useState<{ text: string; retry?: () => void; show?: boolean } | null>(null);
  const overlaysRef = useRef<HTMLDivElement>(null);
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

  // The camera buttons live in a sheet opened from the dock; with no dock (page on its own) they stay in the header card.
  const [camerasOpen, setCamerasOpen] = useState(false);
  const docked = useDockAction(allowed ? { label: t('desk.stream.pr.camerasSheet'), icon: 'settings', onClick: () => setCamerasOpen(true) } : null);

  // Any signed-in account reaches this page (a competition team member may produce); the API makes the real check.
  if (!allowed) {
    return (
      <PageProblem title={t('desk.stream.pr.onlyTeam')} secondaryLabel={t('desk.stream.backToCompetition')} secondaryTo={`/competitions/${competition.id}`}>
        {t('desk.stream.pr.askAdd')}
      </PageProblem>
    );
  }

  const pushOverlay = async (patch: Partial<StreamOverlay>, note?: string): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setProblem(null);
    try {
      if (saveOverlay) {
        const result = await saveOverlay((o) => ({ ...o, ...patch }));
        if (result !== 'saved') {
          setProblem(result === 'conflict'
            ? { text: t('desk.stream.overlayConflict'), show: true }
            : { text: t('desk.stream.overlayFailed'), retry: () => void pushOverlay(patch, note) });
          return false;
        }
      } else {
        const { data } = await api.put<StreamOverlay>(`/competitions/${competition.id}/overlays`, overlayRequest({ ...overlay, ...patch }));
        const parsed = parseOverlay(data);
        if (!parsed) throw new Error('Invalid overlay response');
        setLocalOverlay(parsed);
      }
      if (note) toast.show(note);
      return true;
    } catch {
      setProblem({ text: t('desk.stream.overlayFailed'), retry: () => void pushOverlay(patch, note) });
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
      mode === 'none' ? t('desk.stream.pr.cleared') : t('desk.stream.pr.showingCentred', { mode: t(`desk.stream.card.shown.${mode}`) }),
    );
  };

  const sendCommand = async (streamId: number, command: StreamCommand['command'], value?: string, note?: string) => {
    setProblem(null);
    try {
      await api.post(`/competitions/${competition.id}/streams/${streamId}/command`, { command, value });
      if (note) toast.show(note);
    } catch {
      setProblem({ text: t('desk.stream.cameraUnreachable'), retry: () => void sendCommand(streamId, command, value, note) });
    }
  };

  const postAnnouncement = async () => {
    const text = announceText.trim();
    if (!text) return;
    if (!(await pushOverlay({ bannerText: text, bannerStyle: 1 }, t('desk.stream.pr.bannerPosted')))) return;
    if (!user?.roles.includes('Admin')) { setAnnounceText(''); return; }
    try {
      await api.post(`/competitions/${competition.id}/chat/announcement`, {
        body: text, message: text, author: user?.fullName || 'Organiser', tag: 'banner',
      });
      setAnnounceText((current) => current.trim() === text ? '' : current);
    } catch {
      setProblem({ text: t('desk.stream.pr.announceFailed'), retry: () => void postAnnouncement() });
    }
  };

  const clearAnnouncement = async () => {
    await pushOverlay({ bannerText: null }, t('desk.stream.pr.bannerCleared'));
  };

  const cameraButtons = (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="mg-btn mg-btn-secondary text-xs"
            onClick={() => setShowDualCamQr((v) => !v)}
          >
            <QrCode className="mr-1.5 h-4 w-4 inline" aria-hidden="true" />
            {t('desk.stream.pr.add2nd')}
          </button>
          <Link className="mg-btn mg-btn-primary text-xs" to={`/competitions/${competition.id}/broadcast`}>
            <Video className="mr-1.5 h-4 w-4 inline" aria-hidden="true" />
            {t('desk.stream.pr.openHere')}
          </Link>
        </div>
  );
  const dualCamQr = showDualCamQr && (
        <div role="region" aria-label={t('desk.stream.pr.addSecondRegion')} className="mg-card flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">{t('desk.stream.pr.pair', { arena: targetArena })}</h2>
            <button
              type="button"
              className="mg-btn mg-btn-secondary text-xs"
              onClick={() => setShowDualCamQr(false)}
            >
              {t('common.close')}
            </button>
          </div>
          <p className="text-xs text-[rgb(var(--mg-muted))]">
            {t('desk.stream.pr.scanIntro', { arena: targetArena })}
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
            <QrCodeImage value={dualCamUrl} label={t('desk.stream.pr.secondLink')} className="h-32 w-32 shrink-0 rounded-xl bg-white p-2" />
            <div className="min-w-0 flex-1">
              <div className="break-all rounded-lg bg-[rgb(var(--mg-subtle))] p-2 font-mono text-xs">
                {dualCamUrl}
              </div>
            </div>
          </div>
        </div>
      );

  return (
    <fieldset disabled={busy} className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4 p-3 sm:p-4">
      <div className="mg-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="flex items-center gap-2">
            <Sliders className="h-5 w-5 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
            <h1 className="text-xl font-bold">{t('desk.stream.pr.title')}</h1>
          </div>
          <p className="mt-0.5 text-xs text-[rgb(var(--mg-muted))]">
            {t('desk.stream.pr.intro')}
          </p>
        </div>
        {!docked && cameraButtons}
      </div>

      {problem && (
        <Notice
          actionLabel={problem.show ? t('desk.stream.showMe') : problem.retry ? t('common.tryAgain') : undefined}
          onAction={problem.show ? () => overlaysRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus() : problem.retry}
        >
          {problem.text}
        </Notice>
      )}
      {toast.node}

      {!docked && dualCamQr}

      {/* Active cameras & Dual-Camera Switcher */}
      <div className="mg-card flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
            <h2 className="text-sm font-bold">{t('desk.stream.pr.activeHeading', { count: liveStreams.length })}</h2>
          </div>
        </div>
        {liveStreams.length === 0 ? (
          <p className="text-xs text-[rgb(var(--mg-muted))]">
            {t('desk.stream.pr.noneBroadcasting')}
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
                      ? 'border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-heading)/0.08)]'
                      : 'border-[rgb(var(--mg-line))]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-bold text-sm">
                      <Radio className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />
                      <span className="truncate">{s.arenaName} · {s.angleName}</span>
                    </div>
                    <div className="text-xs text-[rgb(var(--mg-muted))]">
                      {t('desk.stream.watching', { viewers: s.viewerCount, state: s.status === 1 ? t('desk.stream.paused') : t('desk.stream.stateLive') })}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="mg-btn mg-btn-secondary text-xs"
                      aria-pressed={isSelected}
                      onClick={() => {
                        setSelectedStreamId(s.id);
                        void sendCommand(s.id, 'selectAngle', String(s.id), t('desk.stream.pr.switched', { angle: s.angleName }));
                      }}
                    >
                      {isSelected ? t('desk.stream.pr.controlling') : t('desk.stream.pr.cutTo')}
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
              {t('desk.stream.pr.remoteCamera', { angle: activeStream.angleName })}
            </span>
            {[1, 2, 3].map((z) => (
              <button
                key={z}
                type="button"
                className="mg-stream-chip text-xs"
                onClick={() => void sendCommand(activeStream.id, 'setZoom', String(z), t('desk.stream.pr.zoomSet', { z }))}
              >
                {t('desk.stream.zoomX', { z })}
              </button>
            ))}
            <button
              type="button"
              className="mg-stream-chip text-xs"
              onClick={() => void sendCommand(activeStream.id, 'setQualityPreset', 'auto', t('desk.stream.pr.autoHd'))}
            >
              {t('desk.stream.quality.auto')}
            </button>
            <button
              type="button"
              className="mg-stream-chip text-xs"
              onClick={() => void sendCommand(activeStream.id, 'setQualityPreset', '480p', t('desk.stream.pr.saver480'))}
            >
              {t('desk.stream.quality.480p')}
            </button>
            <button
              type="button"
              className="mg-stream-chip text-xs"
              onClick={() => void sendCommand(activeStream.id, 'saveReplay', '15', t('desk.stream.pr.replayRequested'))}
            >
              {t('desk.stream.pr.save15')}
            </button>
          </div>
        )}
      </div>

      {/* Centred Live Stream Overlays */}
      <div ref={overlaysRef} className="mg-card flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
            <h2 className="text-sm font-bold">{t('desk.stream.pr.overlaysHeading')}</h2>
          </div>
          {activeCard !== 'none' && (
            <button
              type="button"
              className="mg-btn mg-btn-secondary text-xs"
              onClick={() => void selectOverlayCard('none')}
            >
              {t('desk.stream.pr.hideOverlay')}
            </button>
          )}
        </div>
        <p className="text-xs text-[rgb(var(--mg-muted))]">
          {t('desk.stream.pr.popups')}
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: 'none', label: t('desk.stream.card.off') },
              { id: 'toplist', label: t('desk.stream.card.toplist') },
              { id: 'heat', label: t('desk.stream.card.heat') },
              { id: 'lanes', label: t('desk.stream.card.lanes') },
              { id: 'next', label: t('desk.stream.card.next') },
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
            {t('desk.stream.pr.scoreStrip')}
          </button>
          <button
            type="button"
            aria-pressed={overlay.stripMode !== 2}
            className="mg-stream-chip text-xs"
            onClick={() => void pushOverlay({ stripMode: overlay.stripMode === 2 ? 0 : 2 })}
          >
            {t('desk.stream.pr.lowerThird')}
          </button>
          <button
            type="button"
            aria-pressed={overlay.sponsorMode !== 2}
            className="mg-stream-chip text-xs"
            onClick={() => void pushOverlay({ sponsorMode: overlay.sponsorMode === 2 ? 0 : 2 })}
          >
            <Sparkles aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
            {t('desk.stream.pr.sponsors')}
          </button>
        </div>
      </div>

      {/* Live Announcement / Banner */}
      <div className="mg-card flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
          <h2 className="text-sm font-bold">{t('desk.stream.pr.announceHeading')}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            aria-label={t('desk.stream.pr.bannerMessage')}
            className="mg-input flex-1"
            placeholder={t('desk.stream.pr.bannerPlaceholder')}
            value={announceText}
            maxLength={140}
            onChange={(e) => setAnnounceText(e.target.value)}
          />
          <button type="button" className="mg-btn mg-btn-primary" onClick={() => void postAnnouncement()}>
            {t('desk.stream.pr.post')}
          </button>
          {overlay.bannerText && !['toplist', 'heat', 'lanes', 'next'].includes(overlay.bannerText) && (
            <button type="button" className="mg-btn mg-btn-secondary" onClick={() => void clearAnnouncement()}>
              {t('desk.stream.pr.clearBanner')}
            </button>
          )}
        </div>
      </div>
      {docked && camerasOpen && (
        <Sheet title={t('desk.stream.pr.camerasSheet')} onClose={() => setCamerasOpen(false)}>
          <div className="flex flex-col gap-3">{cameraButtons}{dualCamQr}</div>
        </Sheet>
      )}
    </fieldset>
  );
}
