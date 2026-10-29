import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { useT } from '../../../i18n/LanguageContext';
import { api } from '../../../api';
import { Notice } from '../../../components/Notice';
import { competitionDateText } from '../../../lib/competitionDates';
import { copyOfCompetition } from '../../../lib/creatorLoad';
import { defaultDraft, type CreatorDraft } from '../../../lib/creatorDraft';
import type { CompetitionDetail, CompetitionSummary } from '../../../types';
import { SavedStartingPoints } from './SavedStartingPoints';
import { StepHeading } from './controls';

const TIME_ORDER = (a: CompetitionSummary, b: CompetitionSummary) => b.startDate.localeCompare(a.startDate);

/**
 * How to begin: from scratch, or from a past competition with every step filled in and the dates left empty. Choosing
 * either replaces the draft, so the page asks nothing more until the person has picked one to copy.
 */
export function StartStep({ draft, replace }: {
  draft: CreatorDraft;
  /** Swaps the whole draft. */
  replace: (next: CreatorDraft) => void;
}) {
  const t = useT();
  const copying = draft.startFrom === 'copy';
  const [list, setList] = useState<CompetitionSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingId, setLoadingId] = useState<number | null>(null);

  useEffect(() => {
    if (!copying || list) return;
    let cancelled = false;
    api.get<CompetitionSummary[]>('/competitions', { params: { includeArchived: true } })
      .then(({ data }) => { if (!cancelled) setList(Array.isArray(data) ? [...data].sort(TIME_ORDER) : []); })
      .catch(() => { if (!cancelled) { setList([]); setFailed(true); } });
    return () => { cancelled = true; };
  }, [copying, list]);

  const fresh = () => { replace({ ...defaultDraft(), step: draft.step, startFrom: 'scratch' }); };
  const wantCopy = () => { if (!copying) { replace({ ...draft, startFrom: 'copy', copiedFrom: undefined }); } };

  async function pick(c: CompetitionSummary) {
    setLoadingId(c.id);
    setFailed(false);
    try {
      const { data } = await api.get<CompetitionDetail>(`/competitions/${c.id}`);
      replace({ ...copyOfCompetition(data), step: draft.step });
    } catch {
      setFailed(true);
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <section aria-label={t('admin.creator.step.start')} className="flex flex-col">
      <StepHeading>{t('admin.creator.step.start')}</StepHeading>
      <div className="mt-3 flex flex-col gap-3.5">
        <div role="group" aria-label={t('admin.creator.start.howToStart')} className="cw-tiles">
          <button type="button" className="cw-tile" aria-pressed={!copying} onClick={fresh}>
            <strong>{t('admin.creator.start.scratch')}</strong>
            <span className="cw-tick" aria-hidden="true"><Check className="h-3 w-3" strokeWidth={3.5} /></span>
          </button>
          <button type="button" className="cw-tile" aria-pressed={copying} onClick={wantCopy}>
            <strong>{t('admin.creator.start.copy')}</strong>
            <span className="cw-t2">{t('admin.creator.start.copySub')}</span>
            <span className="cw-tick" aria-hidden="true"><Check className="h-3 w-3" strokeWidth={3.5} /></span>
          </button>
        </div>
        {copying && (
          <>
            <div className="cw-card" role="group" aria-label={t('admin.creator.start.copyFrom')} aria-busy={list === null}>
              {list === null && <div className="cw-row"><span className="cw-t2" role="status">{t('common.loading')}</span></div>}
              {list?.length === 0 && <div className="cw-row"><span className="cw-t2">{failed ? t('admin.creator.start.loadFailed') : t('admin.creator.start.noPast')}</span></div>}
              {list?.map((c) => {
                const on = copying && draft.copiedFrom === c.name;
                return (
                  <button key={c.id} type="button" className="cw-row" aria-pressed={on} disabled={loadingId !== null} onClick={() => void pick(c)}
                    style={on ? { background: 'rgb(var(--mg-tint) / .5)', boxShadow: 'inset 4px 0 0 rgb(var(--mg-heading))' } : undefined}>
                    <span className="cw-grow">
                      <span className="cw-t1">{c.name}</span>
                      <span className="cw-t2">{[competitionDateText(c.startDate, c.endDate ?? null), c.location, t('admin.creator.start.sections', { count: c.sectionCount })].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="cw-chip">{loadingId === c.id ? t('admin.creator.start.copying') : new Date(c.startDate) < new Date() ? t('admin.creator.start.past') : t('admin.creator.start.upcoming')}</span>
                  </button>
                );
              })}
            </div>
            {failed && list !== null && list.length > 0 && <Notice>{t('admin.creator.start.copyFailed')}</Notice>}
            <p className="cw-note">{t('admin.creator.start.note')}</p>
          </>
        )}
        <SavedStartingPoints />
      </div>
    </section>
  );
}
