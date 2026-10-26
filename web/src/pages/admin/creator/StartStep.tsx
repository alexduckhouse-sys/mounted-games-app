import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { api } from '../../../api';
import { competitionDateText } from '../../../lib/competitionDates';
import { copyOfCompetition } from '../../../lib/creatorLoad';
import { defaultDraft, type CreatorDraft } from '../../../lib/creatorDraft';
import type { CompetitionDetail, CompetitionSummary } from '../../../types';
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
    <section aria-label="Start" className="flex flex-col">
      <StepHeading>Start</StepHeading>
      <div className="mt-3 flex flex-col gap-3.5">
        <div role="group" aria-label="How to start" className="cw-tiles">
          <button type="button" className="cw-tile" aria-pressed={!copying} onClick={fresh}>
            <strong>Start from scratch</strong>
            <span className="cw-t2">Fill in each step yourself</span>
            <span className="cw-tick" aria-hidden="true"><Check className="h-3 w-3" strokeWidth={3.5} /></span>
          </button>
          <button type="button" className="cw-tile" aria-pressed={copying} onClick={wantCopy}>
            <strong>Copy a past competition</strong>
            <span className="cw-t2">Every step filled in, dates left empty</span>
            <span className="cw-tick" aria-hidden="true"><Check className="h-3 w-3" strokeWidth={3.5} /></span>
          </button>
        </div>
        {copying && (
          <>
            <div className="cw-card" role="group" aria-label="Copy from" aria-busy={list === null}>
              {list === null && <div className="cw-row"><span className="cw-t2" role="status">Loading…</span></div>}
              {list?.length === 0 && <div className="cw-row"><span className="cw-t2">{failed ? 'Couldn’t load your competitions.' : 'No past competitions yet.'}</span></div>}
              {list?.map((c) => {
                const on = copying && draft.copiedFrom === c.name;
                return (
                  <button key={c.id} type="button" className="cw-row" aria-pressed={on} disabled={loadingId !== null} onClick={() => void pick(c)}
                    style={on ? { background: 'rgb(var(--mg-tint) / .5)', boxShadow: 'inset 4px 0 0 rgb(var(--mg-heading))' } : undefined}>
                    <span className="cw-grow">
                      <span className="cw-t1">{c.name}</span>
                      <span className="cw-t2">{[competitionDateText(c.startDate, c.endDate ?? null), c.location, `${c.sectionCount} ${c.sectionCount === 1 ? 'section' : 'sections'}`].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="cw-chip">{loadingId === c.id ? 'Copying…' : new Date(c.startDate) < new Date() ? 'Past competition' : 'Upcoming'}</span>
                  </button>
                );
              })}
            </div>
            {failed && list !== null && list.length > 0 && <p role="alert" className="cw-note" style={{ color: 'rgb(var(--mg-elim))' }}>Couldn’t copy that one. Try again.</p>}
            <p className="cw-note">Dates are left empty. Entries and results aren’t copied.</p>
          </>
        )}
      </div>
    </section>
  );
}
