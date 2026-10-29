import { useEffect, useState } from 'react';
import { api } from '../../api';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { RoundSearch } from '../../components/RoundSearch';
import { RefineChoiceRow, RefineNote, RefineSection, RefineSwitchRow } from '../refine/Refine';
import { VaccinationRecord } from './vaccinations/VaccinationRecord';
import { VaccinationSettings } from './vaccinations/VaccinationSettings';
import { isBoard, latestEvidence, message, type Board, type Pony } from './vaccinations/types';
import { useVaccinationT } from './vaccinations/useVaccinationT';

/** Event policy, supplied dates and official admission remain separate. Each row is a declared pony, never a name merge. */
export function PassportCheckTab({ competitionId }: { competitionId: string }) {
  const t = useVaccinationT();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/event-tools/competitions/${competitionId}/passport-check/vaccinations`;
  useEffect(() => {
    let live = true;
    api.get<Board>(base).then(({ data }) => {
      if (!isBoard(data)) throw new Error('Invalid passport response');
      if (live) { setBoard(data); setError(null); }
    }).catch(caught => { if (live) setError(message(caught, t('vaccinations.loadError'))); });
    return () => { live = false; };
  }, [base, attempt, t]);
  function changed(pony: Pony) { setBoard(current => current ? { ...current, ponies: current.ponies.map(p => p.riderEntryId === pony.riderEntryId ? pony : p) } : current); }
  async function toggle(enabled: boolean) {
    setBusy(true); setError(null);
    try { await api.put(`/event-tools/competitions/${competitionId}/passport-check/settings`, { enabled }); setAttempt(n => n + 1); }
    catch (caught) { setError(message(caught, t('vaccinations.saveError'))); }
    finally { setBusy(false); }
  }
  async function link(pony: Pony, horseId: string) {
    if (!horseId || !await confirmDialog({ title: t('vaccinations.confirmLink'), message: t('vaccinations.confirmLinkBody'), confirmLabel: t('vaccinations.link') })) return;
    setBusy(true);
    try { changed((await api.put<Pony>(`${base}/riders/${pony.riderEntryId}/horse`, { expectedRevision: pony.revision, horseId, confirmSameHorse: true })).data); }
    catch (caught) { setError(message(caught, t('vaccinations.saveError'))); }
    finally { setBusy(false); }
  }
  return <section aria-label={t('vaccinations.title')}>
    <RefineSection title={t('vaccinations.title')} />
    <RefineNote>{t('vaccinations.intro')}</RefineNote>
    {error && <Notice actionLabel={t('vaccinations.reload')} onAction={() => setAttempt(n => n + 1)}>{error}</Notice>}
    {!board && !error && <p role="status">{t('vaccinations.loading')}</p>}
    {board && <>
      <RefineSwitchRow label={t('vaccinations.enabled')} on={board.enabled} disabled={busy} onChange={toggle} />
      <VaccinationSettings key={`${competitionId}:${attempt}`} settings={board.settings} policies={board.policies} base={base} onChange={settings => { setBoard(current => current ? { ...current, settings } : current); setAttempt(n => n + 1); }} />
      {board.enabled && <>
        <RoundSearch label={t('vaccinations.search')} placeholder={t('vaccinations.search')} value={filter} onChange={setFilter} />
        {board.ponies.filter(p => `${p.ponyName} ${p.teamName}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(pony => {
          const evidence = latestEvidence(pony);
          return <div key={pony.riderEntryId} className="border-b border-[rgb(var(--mg-rule))]">
            <button type="button" className="rf-row w-full text-left" aria-label={`${pony.ponyName} · ${pony.teamName}`} aria-expanded={open === pony.riderEntryId} onClick={() => setOpen(open === pony.riderEntryId ? null : pony.riderEntryId)}>
              <span className="rf-grow"><span className="rf-t1">{pony.ponyName}</span><span className="rf-t2">{pony.teamName}</span></span>
              <span className="text-sm">{evidence ? t(`vaccinations.${evidence.evaluation.status}`) : t('vaccinations.MissingHistory')}</span>
            </button>
            {open === pony.riderEntryId && <div className="px-3">
              {!pony.horseId && board.ponies.some(p => p.horseId) && <RefineChoiceRow label={t('vaccinations.sameHorse')} value="" disabled={busy}
                options={[{ value: '', label: t('vaccinations.newHorse') }, ...board.ponies.filter(p => p.horseId).filter((p, i, all) => all.findIndex(x => x.horseId === p.horseId) === i).map(p => ({ value: p.horseId!, label: `${p.ponyName} · ${p.teamName}` }))]} onChange={id => link(pony, id)} />}
              <VaccinationRecord key={`${pony.riderEntryId}:${attempt}`} pony={pony} settings={board.settings} base={base} staff onChange={changed} onReload={() => setAttempt(n => n + 1)} />
            </div>}
          </div>;
        })}
        {board.ponies.length === 0 && <RefineNote>{t('vaccinations.noPonies')}</RefineNote>}
      </>}
    </>}
  </section>;
}
