import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useOverlayTiles } from '../../../hooks/useOverlayTiles';
import { useStreamAuto } from '../../../hooks/useStreamAuto';
import { useStreamAutomation } from '../../../hooks/useStreamAutomation';
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
        <button type="button" className="sx-chip" aria-pressed={auto.on} onClick={() => setOn(!auto.on)}>{auto.on ? 'Auto on' : 'Auto off'}</button>
        <Link className="sx-desk-link" to={`/competitions/${competition.id}/stream-controls`}>Overlay settings, automations and cameras</Link>
      </div>
    </section>
  );
}
