import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { RefineList, RefineNote, RefineSection } from '../refine/Refine';
import type { DrawHeat, RedrawPreview, RedrawSession } from './types';
import { OFFLINE_MESSAGE, apiMessage, isOffline, newRequestId, statusOf } from './types';
import { Notice } from '../../components/Notice';
import './operations.css';

function heatName(heat: DrawHeat): string {
  return heat.label || `Heat ${heat.orderIndex}`;
}

function HeatColumn({ title, heats, removed }: { title: string; heats: DrawHeat[]; removed?: number[] }) {
  return (
    <div className="ops-col" aria-label={title} role="group">
      <p className="ops-col-title">{title}</p>
      {heats.length === 0 && <p className="rf-t2">No unscored heats.</p>}
      {heats.map((heat) => (
        <div key={heat.heatId} className="ops-heat">
          <p className="ops-heat-name">{heatName(heat)}{removed?.includes(heat.heatId) ? ' (removed)' : ''}</p>
          {heat.teams.length === 0 && <p className="rf-t2">Empty</p>}
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
  // "Before" lists every unscored heat; the ones that go are marked, so organisers see merges and removals.
  return (
    <section aria-label={session.name} className="ops-change">
      <p className="ops-session">{session.name}</p>
      {session.protectedHeats > 0 && (
        <p className="rf-t2">{session.protectedHeats === 1 ? '1 heat is' : `${session.protectedHeats} heats are`} scored or started and won’t be touched.</p>
      )}
      <div className="ops-cols">
        <HeatColumn title="Before" heats={session.before} removed={session.removedHeatIds} />
        <HeatColumn title="After" heats={session.after} />
      </div>
      {session.moves.length > 0 && (
        <p className="rf-t2">
          {session.moves.length === 1 ? '1 team moves' : `${session.moves.length} teams move`}: {session.moves.map((move) => move.teamName).join(', ')}.
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
        ? OFFLINE_MESSAGE
        : apiMessage(failure, 'Couldn’t prepare the preview. Check your signal and try again.'));
    } finally {
      setLoading(false);
    }
  }, [competitionId, sectionId]);

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
        setError('The connection dropped, so we can’t tell whether this applied. Tap Apply again to check. It can’t apply twice.');
      } else if (statusOf(failure) === 409) {
        const message = apiMessage(failure, 'The timetable changed after this preview.');
        await load();
        setError(`${message} Showing a fresh preview.`);
      } else {
        setError(apiMessage(failure, 'Couldn’t apply the re-draw. Check your signal and try again.'));
      }
    } finally {
      setApplying(false);
    }
  }

  return (
    <section aria-label="Re-draw preview">
      <div className="ops-form">
        <p className="ops-session">{sectionName}</p>
        <button type="button" className="rf-btn" onClick={onClose}>Back to entries</button>
      </div>
      {loading && <p role="status" className="rf-note">Preparing the preview…</p>}
      {error && <Notice actionLabel={!preview && !loading ? 'Try again' : undefined} onAction={() => void load()}>{error}</Notice>}
      {done && <Notice tone="info">Re-draw applied. Phones following this event will update.</Notice>}

      {preview && !done && (
        <>
          <RefineSection title="Teams out" />
          <RefineList as="ul" label="Teams out">
            {preview.outTeams.map((team) => (
              <li key={team.teamId} className="rf-row ops-lane"><span className="rf-grow">{team.teamName}</span><span className="rf-t2">{team.status === 2 ? 'No-show' : 'Withdrawn'}</span></li>
            ))}
          </RefineList>
          {preview.notes.map((note) => <RefineNote key={note}>{note}</RefineNote>)}
          {preview.sessions.map((session) => <SessionChange key={session.sessionId} session={session} />)}
          {preview.hasChanges && (
            <div className="ops-gap">
              <RefineNote>Applying changes these unscored heats only. Scored and started heats stay as they are.</RefineNote>
              <div className="rf-actions">
                <button type="button" className="rf-btn" onClick={onClose}>Not now</button>
                <button type="button" className="rf-btn rf-btn-primary rf-grow" onClick={() => void apply()} disabled={applying || !canWrite}>
                  {applying ? 'Applying…' : 'Apply re-draw'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {done && <button type="button" className="rf-btn rf-wide" onClick={onClose}>Back to entries</button>}
    </section>
  );
}
