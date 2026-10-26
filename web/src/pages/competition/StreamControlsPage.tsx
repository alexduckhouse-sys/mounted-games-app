import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { confirmDialog } from '../../components/ConfirmDialog';
import { LiveVideo } from '../../components/stream/LiveVideo';
import { onAirStream } from '../../lib/streamControls';
import type { LiveStream } from '../../types';
import { RefineHeader, RefinePage, RefineNote, type RefineTab } from '../refine/Refine';
import { useCompetition } from './context';
import { CameraTab } from './streamControls/CameraTab';
import './streamControls/streamControls.css';

export type StreamControlsTab = 'overlay' | 'auto' | 'replay' | 'camera';
const TABS: { id: StreamControlsTab; label: string }[] = [
  { id: 'overlay', label: 'Overlay' },
  { id: 'auto', label: 'Auto' },
  { id: 'replay', label: 'Replay' },
  { id: 'camera', label: 'Camera' },
];

export function StreamControlsPage() {
  const { competition, streams, streamTelemetry, lastStreamCommand, invoke, ready, streamMessages } = useCompetition();
  const { canOrganise } = useAuth();
  const [params, setParams] = useSearchParams();
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const liveStreams = useMemo(() => streams.filter((stream) => stream.status !== 2), [streams]);
  const onAir = useMemo(() => onAirStream(liveStreams, lastStreamCommand, pickedId), [liveStreams, lastStreamCommand, pickedId]);
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

  async function endStream() {
    if (!(await confirmDialog({ title: 'End the stream?', message: 'Viewers will see that it has finished.', confirmLabel: 'End stream', destructive: true }))) return;
    setEnding(true);
    setError(null);
    const results = await Promise.allSettled(liveStreams.map((stream) => api.post(`/competitions/${competition.id}/streams/${stream.id}/end`)));
    if (results.some((result) => result.status === 'rejected')) setError('Couldn’t end the stream. Check your connection and try again.');
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
        {error && <p className="mg-notice" role="alert">{error}</p>}
        {onAir ? (
          <div className="sx-video">
            <LiveVideo competitionId={competition.id} streams={liveStreams} sessions={competition.sessions} invoke={invoke} ready={ready}
              messages={streamMessages} canBroadcast={false} competitionName={competition.name} publicLayout />
          </div>
        ) : <div className="sx-notlive" role="status">Not live</div>}

        <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
          {tab === 'camera' ? (
            <CameraTab competitionId={competition.id} streams={liveStreams} onAir={onAir} telemetry={streamTelemetry} defaultArena={defaultArena} onPick={pick} />
          ) : (
            <RefineNote>This tab is built in the next step of the stream controls work.</RefineNote>
          )}
        </div>
      </div>
    </RefinePage>
  );
}
