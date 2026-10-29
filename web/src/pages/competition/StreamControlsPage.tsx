import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { LiveVideo } from '../../components/stream/LiveVideo';
import { useControllerReplay } from '../../hooks/useControllerReplay';
import { useOverlayTiles } from '../../hooks/useOverlayTiles';
import { useSavedReplays } from '../../hooks/useSavedReplays';
import { useStreamAuto } from '../../hooks/useStreamAuto';
import { useStreamAutomation } from '../../hooks/useStreamAutomation';
import { loadInstantLength, saveInstantLength, type InstantLength } from '../../lib/instantReplay';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import { cameraArenas, onAirStream } from '../../lib/streamControls';
import type { LiveStream } from '../../types';
import { RotateCcw } from 'lucide-react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useLanguage } from '../../i18n/LanguageContext';
import { RefineHeader, RefinePage, type RefineTab } from '../refine/Refine';
import { useCompetition } from './context';
import { AutoTab } from './streamControls/AutoTab';
import { BroadcastSetup } from './streamControls/BroadcastSetup';
import { CameraTab } from './streamControls/CameraTab';
import { OverlayTab } from './streamControls/OverlayTab';
import { ReplayTab } from './streamControls/ReplayTab';
import { lengthText } from './streamControls/streamText';
import './streamControls/streamControls.css';

export type StreamControlsTab = 'overlay' | 'auto' | 'replay' | 'camera';
const TABS: { id: StreamControlsTab }[] = [{ id: 'overlay' }, { id: 'auto' }, { id: 'replay' }, { id: 'camera' }];
// On a phone the four become three, so each fits one screen under the pinned picture. Auto sits with Graphics, as it only decides when the graphics change.
const PHONE_TABS: { id: StreamControlsTab; key: 'cameras' | 'graphics' | 'replays'; covers: StreamControlsTab[] }[] = [
  { id: 'camera', key: 'cameras', covers: ['camera'] },
  { id: 'overlay', key: 'graphics', covers: ['overlay', 'auto'] },
  { id: 'replay', key: 'replays', covers: ['replay'] },
];

export function StreamControlsPage() {
  const { t, locale } = useLanguage();
  const { competition, streams, streamTelemetry, lastStreamCommand, invoke, ready, streamMessages, overlay: ctxOverlay, saveOverlay, scoreCards } = useCompetition();
  const { canOrganise } = useAuth();
  const [params, setParams] = useSearchParams();
  const phone = useMediaQuery('(max-width: 767px)');
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [ending, setEnding] = useState(false);
  const [media, setMedia] = useState<MediaStream | null>(null);
  const [monitorId, setMonitorId] = useState<number | null>(null);
  // The big player reports what it is playing, so the Camera tab's preview of that camera reuses the picture.
  const onMedia = useCallback((next: MediaStream | null, streamId?: number) => { setMedia(next); setMonitorId(streamId ?? null); }, []);
  const [openClipId, setOpenClipId] = useState<string | null>(null);
  const [instantLength, setInstantLength] = useState<InstantLength>(loadInstantLength);
  const [error, setError] = useState<string | null>(null);

  const liveStreams = useMemo(() => streams.filter((stream) => stream.status !== 2), [streams]);
  const onAir = useMemo(() => onAirStream(liveStreams, lastStreamCommand, pickedId), [liveStreams, lastStreamCommand, pickedId]);
  const overlay = ctxOverlay ?? DEFAULT_OVERLAY;
  const { auto, setOn, setRule } = useStreamAuto(competition.id);
  const { step: autoStep } = useStreamAutomation({ competition, overlay, saveOverlay, auto });
  const tiles = useOverlayTiles({ competitionId: competition.id, overlay, saveOverlay, onAir, setAutoOn: setOn });
  const clips = useSavedReplays(competition.id);
  const arenaName = onAir?.arenaName || competition.sessions[0]?.arenaName || 'Arena 1';
  const replay = useControllerReplay({ competitionId: competition.id, arena: arenaName, streamId: onAir?.id ?? null, media, scoreCards, sessions: competition.sessions });
  const requested = params.get('tab');
  const tab: StreamControlsTab = TABS.some((item) => item.id === requested) ? (requested as StreamControlsTab) : 'overlay';
  const choose = useCallback((next: StreamControlsTab) => setParams({ tab: next }, { replace: true }), [setParams]);

  if (!canOrganise(competition)) {
    return (
      <RefinePage className="sx-page">
        <RefineHeader back={`/competitions/${competition.id}/chat`} backLabel={t('desk.stream.page.backLabel')} context={competition.name} title={t('desk.stream.page.title')} />
        <p className="rf-note">{t('desk.stream.page.organiserOnly')}</p>
      </RefinePage>
    );
  }

  async function endStream(confirmFirst = true) {
    if (confirmFirst && !(await confirmDialog({ title: t('desk.stream.end.title'), message: t('desk.stream.end.message'), cancelLabel: t('desk.stream.end.keep'), confirmLabel: t('desk.stream.end.confirm'), destructive: true }))) return;
    setEnding(true);
    setError(null);
    const results = await Promise.allSettled(liveStreams.map((stream) => api.post(`/competitions/${competition.id}/streams/${stream.id}/end`)));
    if (results.some((result) => result.status === 'rejected')) setError(t('desk.stream.end.failed'));
    setEnding(false);
  }

  const tabs: RefineTab[] = phone
    ? PHONE_TABS.map(({ id, key, covers }) => ({ label: t(`desk.stream.tab.${key}`), active: covers.includes(tab), onSelect: () => choose(id) }))
    : TABS.map(({ id }) => ({ label: t(`desk.stream.tab.${id}`), active: tab === id, onSelect: () => choose(id) }));
  const panelLabel = phone ? t(`desk.stream.tab.${PHONE_TABS.find((item) => item.covers.includes(tab))?.key ?? 'graphics'}`) : t(`desk.stream.tab.${tab}`);
  const arenas = cameraArenas(competition.sessions);
  const pick = (stream: LiveStream) => setPickedId(stream.id);

  return (
    <RefinePage className="sx-page">
      <RefineHeader
        back={`/competitions/${competition.id}/chat`}
        backLabel={t('desk.stream.page.backLabel')}
        context={competition.name}
        title={t('desk.stream.page.title')}
        titleAction={liveStreams.length > 0 ? <button type="button" className="sx-end" disabled={ending} onClick={() => void endStream()}>{t('desk.stream.page.endStream')}</button> : undefined}
        tabs={tabs}
        tabsKind="tablist"
        tabsLabel={t('desk.stream.page.title')}
      />
      <div className="sx-body">
        {error && <Notice actionLabel={t('common.tryAgain')} onAction={() => void endStream(false)} actionDisabled={ending}>{error}</Notice>}
        <div className="sx-pin">
        {onAir ? (
          <div className="sx-video">
            <LiveVideo competitionId={competition.id} streams={liveStreams} sessions={competition.sessions} invoke={invoke} ready={ready}
              messages={streamMessages} canBroadcast={false} competitionName={competition.name} publicLayout onMedia={onMedia} enableDvr={false} />
          </div>
        ) : <div className="sx-notlive" role="status">{t('desk.stream.page.notLive')}</div>}
        </div>

        <div className="sx-chips">
          <button type="button" className="sx-btn" disabled={!replay.recording || replay.progress !== null}
            onClick={() => replay.instant(instantLength, t('desk.stream.page.instantName', { time: new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) }), (clip) => { choose('replay'); setOpenClipId(clip.id); })}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />{t('desk.stream.instantReplayLen', { length: lengthText(t, instantLength) })}
          </button>
          <button type="button" className="sx-chip sx-auto-chip" aria-pressed={auto.on} onClick={() => setOn(!auto.on)}>
            {auto.on ? t('desk.stream.autoOn') : t('desk.stream.autoOff')}
            {autoStep && <span className="sr-only">{t('desk.stream.page.autoSr', { card: t(`desk.stream.autoCard.${autoStep.card}`), seconds: autoStep.seconds })}</span>}
            {autoStep && <span key={autoStep.run} aria-hidden="true" className="sx-auto-count" style={{ '--sx-count': `${autoStep.seconds}s` } as CSSProperties} />}
          </button>
        </div>

        <div key={tab} role="tabpanel" className="mg-settle" aria-label={panelLabel}>
          {(tab === 'overlay' || (phone && tab === 'auto')) && <><OverlayTab competition={competition} overlay={overlay} tiles={tiles} canChange={Boolean(saveOverlay)} /><BroadcastSetup competition={competition} /></>}
          {(tab === 'auto' || (phone && tab === 'overlay')) && <AutoTab competition={competition} auto={auto} setOn={setOn} setRule={setRule}
            prizeGiving={{ on: tiles.options.autoPrizeGiving, disabled: tiles.busy || !saveOverlay, set: (on) => void tiles.setOptions({ autoPrizeGiving: on }) }} />}
          {tab === 'replay' && (
            <ReplayTab clips={clips} openId={openClipId} onOpen={setOpenClipId} controller={replay} instantLength={instantLength}
              onInstantLength={(length) => { saveInstantLength(length); setInstantLength(length); }} />
          )}
          {tab === 'camera' && (
            <CameraTab competitionId={competition.id} streams={liveStreams} onAir={onAir} telemetry={streamTelemetry} arenas={arenas} onPick={pick}
              invoke={invoke} ready={ready} monitor={{ streamId: monitorId, media }} />
          )}
        </div>
      </div>
    </RefinePage>
  );
}
