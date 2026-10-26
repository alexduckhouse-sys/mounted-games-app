import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../../api';
import { useOverlayTiles } from '../../../hooks/useOverlayTiles';
import { useStreamAuto } from '../../../hooks/useStreamAuto';
import { useStreamAutomation } from '../../../hooks/useStreamAutomation';
import { lengthLabel, loadInstantLength } from '../../../lib/instantReplay';
import { DEFAULT_OVERLAY } from '../../../lib/overlays';
import { onAirStream } from '../../../lib/streamControls';
import { DESK_TILES } from '../../../lib/streamOverlayTiles';
import { Notice } from '../../../components/Notice';
import { useToast } from '../../../components/Toast';
import { useCompetition } from '../context';
import { OverlayProblem } from './OverlayTab';
import './streamControls.css';

/** One-tap overlays for the Commentary desk. The same choices as the Overlay tab, without the settings. */
export function DeskOverlays() {
  const { competition, streams, lastStreamCommand, overlay: ctxOverlay, saveOverlay } = useCompetition();
  const overlay = ctxOverlay ?? DEFAULT_OVERLAY;
  const { auto, setOn } = useStreamAuto(competition.id);
  const onAir = useMemo(() => onAirStream(streams, lastStreamCommand, null), [streams, lastStreamCommand]);
  const tiles = useOverlayTiles({ competitionId: competition.id, overlay, saveOverlay, onAir, setAutoOn: setOn });
  useStreamAutomation({ competition, overlay, saveOverlay, auto });
  const [instantProblem, setInstantProblem] = useState<string | null>(null);
  const toast = useToast();
  const [length] = useState(loadInstantLength);

  // The clip is saved by the camera phone, so it stays there; open the Replay tab on that phone to edit it.
  async function instantReplay() {
    setInstantProblem(null);
    if (!onAir) { setInstantProblem('No camera is live.'); return; }
    try {
      await api.post(`/competitions/${competition.id}/streams/${onAir.id}/command`, { command: 'saveReplay', value: String(length) });
      toast.show(`Asked the camera phone to save the last ${lengthLabel(length)}.`);
    } catch {
      setInstantProblem('Couldn’t reach the camera phone. Check your signal and try again.');
    }
  }

  return (
    <section aria-label="Stream overlays" className="mg-card sx-desk">
      <h2 className="sx-desk-title">Overlays</h2>
      <fieldset className="sx-fieldset" disabled={tiles.busy || !saveOverlay}>
        <div className="sx-desk-grid" role="radiogroup" aria-label="On screen">
          {DESK_TILES.map((tile) => (
            <button key={tile.id} type="button" role="radio" aria-checked={tiles.active === tile.id} className="sx-desk-tile" onClick={() => void tiles.pick(tile.id)}>{tile.label}</button>
          ))}
        </div>
      </fieldset>
      <OverlayProblem tiles={tiles} />
      <div className="sx-chips">
        <button type="button" className="sx-btn" onClick={() => void instantReplay()}><RotateCcw className="h-4 w-4" aria-hidden="true" />Instant replay · {lengthLabel(length)}</button>
        <button type="button" className="sx-chip" aria-pressed={auto.on} onClick={() => setOn(!auto.on)}>{auto.on ? 'Auto on' : 'Auto off'}</button>
        <Link className="sx-desk-link" to={`/competitions/${competition.id}/stream-controls`}>Overlay settings, automations and cameras</Link>
      </div>
      {instantProblem && <Notice className="sx-status" actionLabel={onAir ? 'Try again' : undefined} onAction={() => void instantReplay()}>{instantProblem}</Notice>}
      {toast.node}
    </section>
  );
}
