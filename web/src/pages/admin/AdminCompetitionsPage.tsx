import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../../api';
import { AnimatePresence } from 'framer-motion';
import { LeavingRow } from '../../components/LeavingRow';
import { Notice } from '../../components/Notice';
import { RoundSearch } from '../../components/RoundSearch';
import { useDockAction } from '../../components/TickerContext';
import { apiErrorMessage } from '../../lib/apiError';
import { competitionDateText } from '../../lib/competitionDates';
import { stageOf } from '../../lib/adminStage';
import { useT } from '../../i18n/LanguageContext';
import { tr } from '../../i18n/translate';
import type { CompetitionSummary } from '../../types';
import { RefineHeader, RefineList, RefinePage, RefineStatus } from '../refine/Refine';
import { STAGE_TONE, deleteWarning, stageLabel } from './adminShared';
import '../operations/operations.css';

/** Every competition, with Organise and Delete. Delete asks first, in place, and says what goes with it. */
/** The delete question under a row: focus moves to Keep it, Escape cancels and focus goes back to the Delete button. */
function DeleteAsk({ competition: c, stage, busy, onKeep, onDelete }: { competition: CompetitionSummary; stage: ReturnType<typeof stageOf>; busy: boolean; onKeep: () => void; onDelete: () => void }) {
  const t = useT();
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    keepRef.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  return (
    <div role="alertdialog" aria-label={t('admin.accounts.comps.deleteQuestion', { name: c.name })} className="ops-warnbox" onKeyDown={(e) => { if (e.key === 'Escape') onKeep(); }}>
      <strong>{t('admin.accounts.comps.deleteQuestion', { name: c.name })}</strong>
      <p>{deleteWarning(c, stage === 'live')}</p>
      <div className="ops-warn-actions">
        <button ref={keepRef} type="button" className="rf-btn" onClick={onKeep}>{t('admin.accounts.comps.keep')}</button>
        <button type="button" className="ops-danger-link" disabled={busy} onClick={onDelete}>{t('admin.accounts.comps.deleteForGood')}</button>
      </div>
    </div>
  );
}

export function AdminCompetitionsPage() {
  const t = useT();
  const [comps, setComps] = useState<CompetitionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const now = useMemo(() => new Date(), []);
  const navigate = useNavigate();
  const docked = useDockAction({ label: t('admin.accounts.newCompetition'), icon: 'plus', onClick: () => navigate('/admin/competitions/new') });

  const load = useCallback(() => api.get<CompetitionSummary[]>('/competitions', { params: { includeArchived: true } })
    .then(({ data }) => { setComps(Array.isArray(data) ? data : []); setError(null); })
    .catch(() => { setComps((current) => current ?? []); setError(tr('admin.accounts.comps.loadFailed')); }), []);
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
      setError(apiErrorMessage(caught, t('admin.accounts.comps.deleteFailed', { name: c.name })));
    } finally {
      setBusy(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const matching = (comps ?? []).filter((c) => !needle || `${c.name} ${c.location ?? ''}`.toLowerCase().includes(needle));
  const rows = matching.map((c) => ({ c, stage: stageOf(c, now) }));
  const groups = [
    { id: 'upcoming', name: t('admin.accounts.upcoming'), list: rows.filter((row) => row.stage !== 'finished') },
    { id: 'past', name: t('admin.accounts.past'), list: rows.filter((row) => row.stage === 'finished') },
  ].filter((group) => group.list.length > 0);

  return (
    <RefinePage>
      <RefineHeader back="/admin" backLabel={t('admin.accounts.backToSiteAdmin')} context={t('admin.accounts.siteAdmin')} title={t('admin.accounts.competitions')} />
      <div className="ops-cards ops-tt ops-admin" aria-busy={busy}>
        {error && <Notice>{error}</Notice>}
        {comps === null && <p role="status" className="rf-note">{t('common.loading')}</p>}
        {comps !== null && comps.length > 0 && (
          <RoundSearch label={t('admin.accounts.comps.search')} placeholder={t('admin.accounts.comps.searchPlaceholder')} value={query} onChange={setQuery} className="mt-3" />
        )}
        {comps !== null && rows.length === 0 && !error && (
          <RefineList as="div"><div className="rf-row"><span className="rf-t2">{comps.length > 0 ? t('admin.accounts.comps.noMatch', { query: query.trim() }) : t('admin.accounts.noCompetitionsYet')}</span></div></RefineList>
        )}
        {groups.map((group) => (
          <Fragment key={group.id}>
            <h2 className="rf-sec ops-tt-head"><span>{group.name}</span><span>{group.list.length}</span></h2>
            <RefineList as="div" label={group.name}>
              <AnimatePresence initial={false}>
              {group.list.map(({ c, stage }) => {
                const open = asking === c.id;
                return (
                  <LeavingRow as="div" key={c.id}>
                    <div className="rf-row ops-comp-row">
                      <span className="rf-grow ops-comp-name"><span className="rf-t1">{c.name}</span><span className="rf-t2">{competitionDateText(c.startDate, c.endDate)}</span></span>
                      <RefineStatus tone={STAGE_TONE[stage]}>{stageLabel(stage)}</RefineStatus>
                      <Link to={`/competitions/${c.id}/operations`} className="rf-btn" aria-label={t('admin.accounts.comps.organiseAria', { name: c.name })}>{t('admin.accounts.comps.organise')}</Link>
                      <button type="button" className="ops-danger-link" aria-expanded={open} aria-label={t('admin.accounts.comps.deleteAria', { name: c.name })} disabled={busy} onClick={() => setAsking(open ? null : c.id)}>{t('common.delete')}</button>
                    </div>
                    {open && (
                      <DeleteAsk competition={c} stage={stage} busy={busy} onKeep={() => setAsking(null)} onDelete={() => void remove(c)} />
                    )}
                  </LeavingRow>
                );
              })}
              </AnimatePresence>
            </RefineList>
          </Fragment>
        ))}
        {!docked && (
          <div className="ops-new-comp">
            <Link to="/admin/competitions/new" className="rf-btn rf-btn-primary"><Plus className="h-4 w-4" aria-hidden="true" />{t('admin.accounts.newCompetition')}</Link>
          </div>
        )}
      </div>
    </RefinePage>
  );
}
