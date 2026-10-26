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
import { useCompetition } from '../context';
import './streamControls.css';

/** One-tap overlays for the Commentary desk. The same choices as the Overlay tab, without the settings. */
export function DeskOverlays() {
  const { competition, streams, lastStreamCommand, overlay: ctxOverlay, saveOverlay } = useCompetition();
  const overlay = ctxOverlay ?? DEFAULT_OVERLAY;
  const { auto, setOn } = useStreamAuto(competition.id);
  const onAir = useMemo(() => onAirStream(streams, lastStreamCommand, null), [streams, lastStreamCommand]);
  const tiles = useOverlayTiles({ competitionId: competition.id, overlay, saveOverlay, onAir, setAutoOn: setOn });
  useStreamAutomation({ competition, overlay, saveOverlay, auto });
  const [instantNote, setInstantNote] = useState<{ text: string; failed: boolean } | null>(null);
  const [length] = useState(loadInstantLength);

  // The clip is saved by the camera phone, so it stays there; open the Replay tab on that phone to edit it.
  async function instantReplay() {
    if (!onAir) { setInstantNote({ text: 'No camera is live.', failed: true }); return; }
    try {
      await api.post(`/competitions/${competition.id}/streams/${onAir.id}/command`, { command: 'saveReplay', value: String(length) });
      setInstantNote({ text: `Asked the camera phone to save the last ${lengthLabel(length)}.`, failed: false });
    } catch {
      setInstantNote({ text: 'Couldn’t reach the camera phone. Check your connection and try again.', failed: true });
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
      {tiles.error && <p className="mg-notice sx-status" role="alert">{tiles.error}</p>}
      <div className="sx-chips">
        <button type="button" className="sx-btn" onClick={() => void instantReplay()}><RotateCcw className="h-4 w-4" aria-hidden="true" />Instant replay · {lengthLabel(length)}</button>
        <button type="button" className="sx-chip" aria-pressed={auto.on} onClick={() => setOn(!auto.on)}>{auto.on ? 'Auto on' : 'Auto off'}</button>
        <Link className="sx-desk-link" to={`/competitions/${competition.id}/stream-controls`}>Overlay settings, automations and cameras</Link>
      </div>
      {instantNote && <p className={instantNote.failed ? 'mg-notice' : 'sx-note'} role={instantNote.failed ? 'alert' : 'status'}>{instantNote.text}</p>}
    </section>
  );
}
