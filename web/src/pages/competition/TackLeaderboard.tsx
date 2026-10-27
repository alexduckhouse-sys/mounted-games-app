import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { TackLeaderboard as Board } from '../../types';
import { useT } from '../../i18n/LanguageContext';

/**
 * The Tack & Turnout table for one age group: team points per tack sector. Shown only when the organiser scores
 * the tack check (a separate table, or bonus points added to the standings). Nothing shows until a team is marked.
 */
export function TackLeaderboard({ competitionId, sectionId, refresh = 0 }: { competitionId: number; sectionId: number; refresh?: number }) {
  const t = useT();
  const [board, setBoard] = useState<Board | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<Board>(`/event-tools/competitions/${competitionId}/tack-check/leaderboard`)
      .then(({ data }) => { if (!cancelled && Array.isArray(data?.sections)) setBoard(data); })
      // The table is extra: if it can't load, the standings above still stand on their own.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [competitionId, refresh]);

  const table = board?.sections.find((s) => s.sectionId === sectionId);
  if (!table || table.rows.length === 0) return null;
  return (
    <section aria-label={t('competition.tack.aria')} className="flex flex-col gap-1.5">
      <h2 className="mg-display text-base font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">{t('competition.tack.heading')}</h2>
      <p className="text-sm text-[rgb(var(--mg-body))]">
        {table.mode === 2 ? t('competition.tack.added') : t('competition.tack.separate')}
        {' '}{t('competition.tack.upTo', { n: table.maxPoints })}
      </p>
      <div className="mg-card overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="mg-display border-b border-[rgb(var(--mg-rule))] text-xs font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-muted))]">
              <th scope="col" className="w-9 py-1.5 pl-3 text-left font-bold">#</th>
              <th scope="col" className="py-1.5 text-left font-bold">{t('competition.toplist.team')}</th>
              {table.sectors.map((name) => <th key={name} scope="col" className="px-1 py-1.5 text-center font-bold">{name}</th>)}
              <th scope="col" className="w-11 py-1.5 pr-3 text-right font-bold text-[rgb(var(--mg-heading))]">{t('competition.toplist.pts')}</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.teamId} className="border-b border-[rgb(var(--mg-rule-soft))] last:border-b-0">
                <td className="mg-display h-11 py-0 pl-3 text-base font-bold">{row.rank ?? 'HC'}</td>
                <th scope="row" className="py-0 pr-2 text-left text-[15px] font-semibold leading-tight">
                  {row.teamName}
                  {row.clubName && <span className="block text-xs font-medium text-[rgb(var(--mg-muted))]">{row.clubName}</span>}
                </th>
                {row.points.map((points, i) => (
                  <td key={table.sectors[i] ?? i} className="mg-display text-center text-base font-semibold tabular-nums">
                    {points ?? <><span aria-hidden="true" className="text-[rgb(var(--mg-dash))]">–</span><span className="sr-only">{t('competition.tack.notMarked')}</span></>}
                  </td>
                ))}
                <td className="mg-display pr-3 text-right text-xl font-bold tabular-nums text-[rgb(var(--mg-heading))]">{row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
