import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../../api';
import { Notice } from '../../components/Notice';
import { apiErrorMessage } from '../../lib/apiError';
import { competitionDateText } from '../../lib/competitionDates';
import { STAGE_LABEL, stageOf } from '../../lib/adminStage';
import type { CompetitionSummary } from '../../types';
import { RefineHeader, RefineList, RefinePage, RefineStatus } from '../refine/Refine';
import { STAGE_TONE, deleteWarning } from './adminShared';
import '../operations/operations.css';

/** Every competition, with Organise and Delete. Delete asks first, in place, and says what goes with it. */
export function AdminCompetitionsPage() {
  const [comps, setComps] = useState<CompetitionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useMemo(() => new Date(), []);

  const load = useCallback(() => api.get<CompetitionSummary[]>('/competitions', { params: { includeArchived: true } })
    .then(({ data }) => { setComps(Array.isArray(data) ? data : []); setError(null); })
    .catch(() => { setComps((current) => current ?? []); setError('Couldn’t load the competitions. Check your signal and try again.'); }), []);
  useEffect(() => { void load(); }, [load]);

  async function remove(c: CompetitionSummary) {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/competitions/${c.id}`);
      // Wipe any local wizard draft for this competition so it doesn't come back in the editor.
      try { window.localStorage.removeItem(`competitionEditor:edit:${c.id}`); } catch { /* storage may be blocked */ }
      setAsking(null);
      await load();
    } catch (caught) {
      setError(apiErrorMessage(caught, `Couldn’t delete ${c.name}. Check your signal and try again.`));
    } finally {
      setBusy(false);
    }
  }

  const rows = (comps ?? []).map((c) => ({ c, stage: stageOf(c, now) }));
  const groups = [
    { name: 'Upcoming', list: rows.filter((row) => row.stage !== 'finished') },
    { name: 'Past', list: rows.filter((row) => row.stage === 'finished') },
  ].filter((group) => group.list.length > 0);

  return (
    <RefinePage>
      <RefineHeader back="/admin" backLabel="Back to site admin" context="Site admin" title="Competitions" />
      <div className="ops-cards ops-tt ops-admin" aria-busy={busy}>
        {error && <Notice>{error}</Notice>}
        {comps === null && <p role="status" className="rf-note">Loading…</p>}
        {comps !== null && rows.length === 0 && !error && <RefineList as="div"><div className="rf-row"><span className="rf-t2">No competitions yet</span></div></RefineList>}
        {groups.map((group) => (
          <Fragment key={group.name}>
            <h2 className="rf-sec ops-tt-head"><span>{group.name}</span><span>{group.list.length}</span></h2>
            <RefineList as="div" label={group.name}>
              {group.list.map(({ c, stage }) => {
                const open = asking === c.id;
                return (
                  <Fragment key={c.id}>
                    <div className="rf-row ops-comp-row">
                      <span className="rf-grow ops-comp-name"><span className="rf-t1">{c.name}</span><span className="rf-t2">{competitionDateText(c.startDate, c.endDate)}</span></span>
                      <RefineStatus tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</RefineStatus>
                      <Link to={`/competitions/${c.id}/operations`} className="rf-btn" aria-label={`Organise ${c.name}`}>Organise</Link>
                      <button type="button" className="ops-danger-link" aria-expanded={open} aria-label={`Delete ${c.name}`} disabled={busy} onClick={() => setAsking(open ? null : c.id)}>Delete</button>
                    </div>
                    {open && (
                      <div role="alertdialog" aria-label={`Delete ${c.name}?`} className="ops-warnbox">
                        <strong>Delete {c.name}?</strong>
                        <p>{deleteWarning(c, stage === 'live')}</p>
                        <div className="ops-warn-actions">
                          <button type="button" className="rf-btn" onClick={() => setAsking(null)}>Keep it</button>
                          <button type="button" className="ops-danger-link" disabled={busy} onClick={() => void remove(c)}>Delete for good</button>
                        </div>
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </RefineList>
          </Fragment>
        ))}
        <div className="ops-new-comp">
          <Link to="/admin/competitions/new" className="rf-btn rf-btn-primary"><Plus className="h-4 w-4" aria-hidden="true" />New competition</Link>
        </div>
      </div>
    </RefinePage>
  );
}
