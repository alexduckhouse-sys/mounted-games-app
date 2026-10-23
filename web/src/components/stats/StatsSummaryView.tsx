import type { StatsSummary } from '../../types';
import { summaryTiles } from '../../lib/stats';

/** The headline numbers every visitor sees. `raceFiguresAllFormats` false adds the note about team events. */
export function StatsSummaryView({ summary, raceFiguresAllFormats }: { summary: StatsSummary; raceFiguresAllFormats: boolean }) {
  return (
    <section aria-label="Summary" className="pt-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {summaryTiles(summary).map((tile) => (
          <div key={tile.label} className="flex flex-col gap-0.5 rounded-[10px] border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))] px-3 py-2.5">
            <dt className="text-xs font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-muted))]">{tile.label}</dt>
            <dd className="m-0 font-['Barlow_Condensed',sans-serif] text-[28px] font-bold leading-none tabular-nums text-[rgb(var(--mg-heading))]">{tile.value}</dd>
            <dd className="m-0 text-[13px] text-[rgb(var(--mg-muted))]">{tile.detail}</dd>
          </div>
        ))}
      </dl>
      {!raceFiguresAllFormats && (
        <p className="rf-note">Point quota and races won count individual and pairs competitions. Team competitions show the team’s result instead.</p>
      )}
    </section>
  );
}
