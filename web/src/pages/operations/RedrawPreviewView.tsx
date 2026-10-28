import { useT } from '../../i18n/LanguageContext';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { tr } from '../../i18n/translate';
import { RefineList, RefineNote, RefineSection } from '../refine/Refine';
import type { DrawHeat, RedrawPreview, RedrawSession } from './types';
import { apiMessage, isOffline, newRequestId, statusOf } from './types';
import { Notice } from '../../components/Notice';
import './operations.css';

function heatName(heat: DrawHeat): string {
  return heat.label || tr('ops2.protest.heatN', { n: heat.orderIndex });
}

function HeatColumn({ title, heats, removed }: { title: string; heats: DrawHeat[]; removed?: number[] }) {
  const t = useT();
  return (
    <div className="ops-col" aria-label={title} role="group">
      <p className="ops-col-title">{title}</p>
      {heats.length === 0 && <p className="rf-t2">{t('ops2.redraw.noUnscored')}</p>}
      {heats.map((heat) => (
        <div key={heat.heatId} className="ops-heat">
          <p className="ops-heat-name">{heatName(heat)}{removed?.includes(heat.heatId) ? ` (${t('ops2.redraw.removed')})` : ''}</p>
          {heat.teams.length === 0 && <p className="rf-t2">{t('ops2.redraw.empty')}</p>}
          <ol>
            {[...heat.teams].sort((a, b) => a.laneIndex - b.laneIndex).map((team) => (
              <li key={team.teamId}><span className="rf-num ops-lane-no">{team.laneIndex}</span> {team.teamName}</li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function SessionChange({ session }: { session: RedrawSession }) {
  const t = useT();
  // "Before" lists every unscored heat; the ones that go are marked, so organisers see merges and removals.
  return (
    <section aria-label={session.name} className="ops-change">
      <p className="ops-session">{session.name}</p>
      {session.protectedHeats > 0 && (
        <p className="rf-t2">{session.protectedHeats === 1 ? t('ops2.redraw.protectedOne') : t('ops2.redraw.protectedMany', { count: session.protectedHeats })}</p>
      )}
      <div className="ops-cols">
        <HeatColumn title={t('ops2.redraw.before')} heats={session.before} removed={session.removedHeatIds} />
        <HeatColumn title={t('ops2.redraw.after')} heats={session.after} />
      </div>
      {session.moves.length > 0 && (
        <p className="rf-t2">
          {t(session.moves.length === 1 ? 'ops2.redraw.movesOne' : 'ops2.redraw.movesMany', { count: session.moves.length, names: session.moves.map((move) => move.teamName).join(', ') })}
        </p>
      )}
    </section>
  );
}

/**
 * Before and after for the unscored heats once a team is out, with an explicit Apply. The same request id is
 * kept for every attempt at one preview, so a tap that is retried after a dropped connection can't apply twice.
 */
export function RedrawPreviewView({ competitionId, sectionId, sectionName, canWrite, onClose, onApplied }: {
  competitionId: number;
  sectionId: number;
  sectionName: string;
  canWrite: boolean;
  onClose: () => void;
  onApplied: () => void;
}) {
  const t = useT();
  const [preview, setPreview] = useState<RedrawPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState(false);
  const [requestId, setRequestId] = useState(newRequestId);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<RedrawPreview>(`/competitions/${competitionId}/sections/${sectionId}/redraw/preview`);
      setPreview(data);
      setRequestId(newRequestId());
    } catch (failure) {
      setPreview(null);
      setError(isOffline(failure)
        ? t('ops2.offline')
        : apiMessage(failure, t('ops2.redraw.prepareError')));
    } finally {
      setLoading(false);
    }
  }, [competitionId, sectionId, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function apply() {
    if (!preview || applying || !canWrite) return;
    setApplying(true);
    setError(null);
    try {
      await api.post(`/competitions/${competitionId}/sections/${sectionId}/redraw/apply`, { fingerprint: preview.fingerprint, requestId });
      setDone(true);
      onApplied();
    } catch (failure) {
      if (isOffline(failure)) {
        // The request may or may not have arrived. Tapping Apply again is safe: the server answers a repeat with the first result.
        setError(t('ops2.redraw.dropped'));
      } else if (statusOf(failure) === 409) {
        const message = apiMessage(failure, t('ops2.redraw.changed'));
        await load();
        setError(t('ops2.redraw.fresh', { message }));
      } else {
        setError(apiMessage(failure, t('ops2.redraw.applyError')));
      }
    } finally {
      setApplying(false);
    }
  }

  return (
    <section aria-label={t('ops2.redraw.aria')}>
      <div className="ops-form">
        <p className="ops-session">{sectionName}</p>
        <button type="button" className="rf-btn" onClick={onClose}>{t('ops2.redraw.backEntries')}</button>
      </div>
      {loading && <p role="status" className="rf-note">{t('ops2.redraw.preparing')}</p>}
      {error && <Notice actionLabel={!preview && !loading ? t('common.tryAgain') : undefined} onAction={() => void load()}>{error}</Notice>}
      {done && <Notice tone="info">{t('ops2.redraw.applied')}</Notice>}

      {preview && !done && (
        <>
          <RefineSection title={t('ops2.redraw.teamsOut')} />
          <RefineList as="ul" label={t('ops2.redraw.teamsOut')}>
            {preview.outTeams.map((team) => (
              <li key={team.teamId} className="rf-row ops-lane"><span className="rf-grow">{team.teamName}</span><span className="rf-t2">{team.status === 2 ? t('ops2.redraw.noShow') : t('ops2.protest.withdrawn')}</span></li>
            ))}
          </RefineList>
          {preview.notes.map((note) => <RefineNote key={note}>{note}</RefineNote>)}
          {preview.sessions.map((session) => <SessionChange key={session.sessionId} session={session} />)}
          {preview.hasChanges && (
            <div className="ops-gap">
              <RefineNote>{t('ops2.redraw.applyNote')}</RefineNote>
              <div className="rf-actions">
                <button type="button" className="rf-btn" onClick={onClose}>{t('common.notNow')}</button>
                <button type="button" className="rf-btn rf-btn-primary rf-grow" onClick={() => void apply()} disabled={applying || !canWrite}>
                  {applying ? t('ops.page.applying') : t('ops2.redraw.apply')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {done && <button type="button" className="rf-btn rf-wide" onClick={onClose}>{t('ops2.redraw.backEntries')}</button>}
    </section>
  );
}
