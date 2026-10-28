import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../../api';
import { useOverlayTiles } from '../../../hooks/useOverlayTiles';
import { useStreamAuto } from '../../../hooks/useStreamAuto';
import { useStreamAutomation } from '../../../hooks/useStreamAutomation';
import { loadInstantLength } from '../../../lib/instantReplay';
import { DEFAULT_OVERLAY } from '../../../lib/overlays';
import { onAirStream } from '../../../lib/streamControls';
import { DESK_TILES } from '../../../lib/streamOverlayTiles';
import { Notice } from '../../../components/Notice';
import { useToast } from '../../../components/Toast';
import { useLanguage } from '../../../i18n/LanguageContext';
import { useCompetition } from '../context';
import { OverlayProblem } from './OverlayTab';
import { lengthText, tileText } from './streamText';
import './streamControls.css';

/** One-tap overlays for the Commentary desk. The same choices as the Overlay tab, without the settings. */
export function DeskOverlays() {
  const { t } = useLanguage();
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
    if (!onAir) { setInstantProblem(t('desk.stream.desk.noCamera')); return; }
    try {
      await api.post(`/competitions/${competition.id}/streams/${onAir.id}/command`, { command: 'saveReplay', value: String(length) });
      toast.show(t('desk.stream.desk.saveAsked', { length: lengthText(t, length) }));
    } catch {
      setInstantProblem(t('desk.stream.cameraUnreachable'));
    }
  }

  return (
    <section aria-label={t('desk.stream.desk.region')} className="mg-card sx-desk">
      <h2 className="sx-desk-title">{t('desk.stream.desk.title')}</h2>
      <fieldset className="sx-fieldset" disabled={tiles.busy || !saveOverlay}>
        <div className="sx-desk-grid" role="radiogroup" aria-label={t('desk.stream.ov.onScreen')}>
          {DESK_TILES.map((tile) => (
            <button key={tile.id} type="button" role="radio" aria-checked={tiles.active === tile.id} className="sx-desk-tile" onClick={() => void tiles.pick(tile.id)}>{tileText(t, tile.id === 'none' ? 'off' : tile.id)}</button>
          ))}
        </div>
      </fieldset>
      <OverlayProblem tiles={tiles} />
      <div className="sx-chips">
        <button type="button" className="sx-btn" onClick={() => void instantReplay()}><RotateCcw className="h-4 w-4" aria-hidden="true" />{t('desk.stream.instantReplayLen', { length: lengthText(t, length) })}</button>
        <button type="button" className="sx-chip" aria-pressed={auto.on} onClick={() => setOn(!auto.on)}>{auto.on ? t('desk.stream.autoOn') : t('desk.stream.autoOff')}</button>
        <Link className="sx-desk-link" to={`/competitions/${competition.id}/stream-controls`}>{t('desk.stream.desk.moreLink')}</Link>
      </div>
      {instantProblem && <Notice className="sx-status" actionLabel={onAir ? t('common.tryAgain') : undefined} onAction={() => void instantReplay()}>{instantProblem}</Notice>}
      {toast.node}
    </section>
  );
}
