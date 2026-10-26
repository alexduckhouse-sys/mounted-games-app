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
import { lengthLabel, loadInstantLength, saveInstantLength, type InstantLength } from '../../lib/instantReplay';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import { onAirStream } from '../../lib/streamControls';
import type { LiveStream } from '../../types';
import { RotateCcw } from 'lucide-react';
import { RefineHeader, RefinePage, type RefineTab } from '../refine/Refine';
import { useCompetition } from './context';
import { AutoTab } from './streamControls/AutoTab';
import { CameraTab } from './streamControls/CameraTab';
import { OverlayTab } from './streamControls/OverlayTab';
import { ReplayTab } from './streamControls/ReplayTab';
import './streamControls/streamControls.css';

export type StreamControlsTab = 'overlay' | 'auto' | 'replay' | 'camera';
const TABS: { id: StreamControlsTab; label: string }[] = [
  { id: 'overlay', label: 'Overlay' },
  { id: 'auto', label: 'Auto' },
  { id: 'replay', label: 'Replay' },
  { id: 'camera', label: 'Camera' },
];

export function StreamControlsPage() {
  const { competition, streams, streamTelemetry, lastStreamCommand, invoke, ready, streamMessages, overlay: ctxOverlay, saveOverlay, scoreCards } = useCompetition();
  const { canOrganise } = useAuth();
  const [params, setParams] = useSearchParams();
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [ending, setEnding] = useState(false);
  const [media, setMedia] = useState<MediaStream | null>(null);
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
  const replay = useControllerReplay({ competitionId: competition.id, arena: arenaName, streamId: onAir?.id ?? null, media, scoreCards });
  const requested = params.get('tab');
  const tab: StreamControlsTab = TABS.some((t) => t.id === requested) ? (requested as StreamControlsTab) : 'overlay';
  const choose = useCallback((next: StreamControlsTab) => setParams({ tab: next }, { replace: true }), [setParams]);

  if (!canOrganise(competition)) {
    return (
      <RefinePage className="sx-page">
        <RefineHeader back={`/competitions/${competition.id}/chat`} backLabel="Back to live stream" context={competition.name} title="Stream controls" />
        <p className="rf-note">Only the competition organiser or team can control the stream.</p>
      </RefinePage>
    );
  }

  async function endStream(confirmFirst = true) {
    if (confirmFirst && !(await confirmDialog({ title: 'End the stream?', message: 'Viewers will see that it has finished.', cancelLabel: 'Keep going', confirmLabel: 'End stream', destructive: true }))) return;
    setEnding(true);
    setError(null);
    const results = await Promise.allSettled(liveStreams.map((stream) => api.post(`/competitions/${competition.id}/streams/${stream.id}/end`)));
    if (results.some((result) => result.status === 'rejected')) setError('Couldn’t end the stream. Check your signal and try again.');
    setEnding(false);
  }

  const tabs: RefineTab[] = TABS.map(({ id, label }) => ({ label, active: tab === id, onSelect: () => choose(id) }));
  const defaultArena = competition.sessions[0]?.arenaName || 'Arena 1';
  const pick = (stream: LiveStream) => setPickedId(stream.id);

  return (
    <RefinePage className="sx-page">
      <RefineHeader
        back={`/competitions/${competition.id}/chat`}
        backLabel="Back to live stream"
        context={competition.name}
        title="Stream controls"
        titleAction={liveStreams.length > 0 ? <button type="button" className="sx-end" disabled={ending} onClick={() => void endStream()}>End stream</button> : undefined}
        tabs={tabs}
        tabsKind="tablist"
        tabsLabel="Stream controls"
      />
      <div className="sx-body">
        {error && <Notice actionLabel="Try again" onAction={() => void endStream(false)} actionDisabled={ending}>{error}</Notice>}
        {onAir ? (
          <div className="sx-video">
            <LiveVideo competitionId={competition.id} streams={liveStreams} sessions={competition.sessions} invoke={invoke} ready={ready}
              messages={streamMessages} canBroadcast={false} competitionName={competition.name} publicLayout onMedia={setMedia} />
          </div>
        ) : <div className="sx-notlive" role="status">Not live</div>}

        <div className="sx-chips">
          <button type="button" className="sx-btn" disabled={!replay.recording || replay.progress !== null}
            onClick={() => replay.instant(instantLength, `Instant replay ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`, (clip) => { choose('replay'); setOpenClipId(clip.id); })}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />Instant replay · {lengthLabel(instantLength)}
          </button>
          <button type="button" className="sx-chip sx-auto-chip" aria-pressed={auto.on} onClick={() => setOn(!auto.on)}>
            {auto.on ? 'Auto on' : 'Auto off'}
            {autoStep && <span className="sr-only">, showing the {autoStep.card} card for {autoStep.seconds} seconds</span>}
            {autoStep && <span key={autoStep.run} aria-hidden="true" className="sx-auto-count" style={{ '--sx-count': `${autoStep.seconds}s` } as CSSProperties} />}
          </button>
        </div>

        <div key={tab} role="tabpanel" className="mg-settle" aria-label={TABS.find((t) => t.id === tab)?.label}>
          {tab === 'overlay' && <OverlayTab competition={competition} overlay={overlay} tiles={tiles} canChange={Boolean(saveOverlay)} />}
          {tab === 'auto' && <AutoTab competition={competition} auto={auto} setOn={setOn} setRule={setRule} />}
          {tab === 'replay' && (
            <ReplayTab clips={clips} openId={openClipId} onOpen={setOpenClipId} controller={replay} instantLength={instantLength}
              onInstantLength={(length) => { saveInstantLength(length); setInstantLength(length); }} />
          )}
          {tab === 'camera' && <CameraTab competitionId={competition.id} streams={liveStreams} onAir={onAir} telemetry={streamTelemetry} defaultArena={defaultArena} onPick={pick} />}
        </div>
      </div>
    </RefinePage>
  );
}
