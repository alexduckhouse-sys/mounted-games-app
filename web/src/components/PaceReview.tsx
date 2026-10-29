import { useEffect, useState } from 'react';
import { useT } from '../i18n/LanguageContext';
import { api } from '../api';

interface PaceRow { game: string; ageGroup: string; arena: string; minutesPerSlot: number | null; samples: number; excludedHolds: number; source: string; typicalErrorMinutes: number | null }
/** Estimates remain separate from published times while organisers assess the evidence. */
export function PaceReview({ competitionId }: { competitionId: number }) {
  const t = useT();
  const [rows, setRows] = useState<PaceRow[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.get<{ rows: PaceRow[] }>(`/competitions/${competitionId}/pace-review`).then(({ data }) => {
      if (!Array.isArray(data?.rows)) throw new Error('Invalid pace response');
      if (!cancelled) { setRows(data.rows); setError(false); }
    }).catch(() => { if (!cancelled) { setRows([]); setError(true); } });
    return () => { cancelled = true; };
  }, [competitionId]);
  return <details className="mg-card p-3">
    <summary className="min-h-11 cursor-pointer font-semibold">{t('timing.review')}</summary>
    <p className="my-2 text-sm">{t('timing.explain')}</p>
    {error ? <p className="text-sm">{t('timing.loadError')}</p> : rows.length === 0 ? <p className="text-sm">{t('timing.empty')}</p> :
      <ul className="divide-y divide-[rgb(var(--mg-rule))]">{rows.map((row, index) => <li key={index} className="py-2 text-sm">
        <span className="font-semibold">{row.ageGroup} · {row.game}{row.arena ? ` · ${row.arena}` : ''}</span>
        <p>{row.minutesPerSlot == null ? t('timing.waiting') : t('timing.estimate', { minutes: row.minutesPerSlot, samples: row.samples })}</p>
        {row.excludedHolds > 0 && <p>{t('timing.holds', { count: row.excludedHolds })}</p>}
        {row.typicalErrorMinutes != null && <p>{t('timing.error', { minutes: row.typicalErrorMinutes })}</p>}
      </li>)}</ul>}
  </details>;
}
