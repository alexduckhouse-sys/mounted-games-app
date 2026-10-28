import type { StatsSummary } from '../../types';
import { summaryTiles } from '../../lib/stats';
import { useT } from '../../i18n/LanguageContext';

/** The headline numbers every visitor sees. `raceFiguresAllFormats` false adds the note about team events. */
export function StatsSummaryView({ summary, raceFiguresAllFormats }: { summary: StatsSummary; raceFiguresAllFormats: boolean }) {
  const t = useT();
  const bFinals = summary.bFinals ?? 0;
  const cFinals = summary.cFinals ?? 0;
  return (
    <section aria-label={t('site.stats.summary')} className="pt-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {summaryTiles(summary).map((tile) => (
          <div key={tile.label} className="flex flex-col gap-0.5 rounded-[10px] border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))] px-3 py-2.5">
            <dt className="text-xs font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-muted))]">{tile.label}</dt>
            <dd className="m-0 font-['Barlow_Condensed',sans-serif] text-[28px] font-bold leading-none tabular-nums text-[rgb(var(--mg-heading))]">{tile.value}</dd>
            <dd className="m-0 text-[13px] text-[rgb(var(--mg-muted))]">{tile.detail}</dd>
          </div>
        ))}
      </dl>
      {(bFinals > 0 || cFinals > 0) && (
        <p className="rf-note" aria-label={t('site.stats.finalsBreakdown')}>{t('site.stats.finalsReached', { a: summary.aFinals, b: bFinals, c: cFinals })}</p>
      )}
      {!raceFiguresAllFormats && (
        <p className="rf-note">{t('site.stats.quotaNote')}</p>
      )}
    </section>
  );
}
