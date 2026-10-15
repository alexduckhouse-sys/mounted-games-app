import { Fragment, useState } from 'react';
import type { CompetitionSection } from '../../types';
import { ordinal, toplistNote, type Toplist } from '../../lib/toplist';

/** The age group's toplist: totals with the final cut-off and any run-off, or points per session. */
export function ToplistView({ list, section }: { list: Toplist; section: CompetitionSection | null }) {
  const [view, setView] = useState<'totals' | 'sessions'>('totals');
  const places = section?.finalistCount ?? null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[13px] font-medium leading-snug text-[rgb(var(--mg-body))]">{places ? `Top ${places} make the final` : ''}</span>
        {list.bySession.sessions.length > 0 && (
          <div className="mg-toggle" role="group" aria-label="Toplist view">
            <button type="button" aria-pressed={view === 'totals'} onClick={() => setView('totals')}>Totals</button>
            <button type="button" aria-pressed={view === 'sessions'} onClick={() => setView('sessions')}>By session</button>
          </div>
        )}
      </div>

      {view === 'totals' ? (
        <section aria-label="Totals" className="mg-card overflow-hidden">
          <ol>
            {list.rows.map((row, index) => {
              const note = toplistNote(row);
              const lastInRunoff = row.runoff && list.rows[index + 1]?.runoff;
              return (
                <Fragment key={row.teamId}>
                  <li className={`flex min-h-14 items-center gap-3 px-3.5 ${lastInRunoff ? 'border-b border-dashed border-[rgb(var(--mg-rule))]' : 'border-b border-[rgb(var(--mg-rule-soft))]'} ${row.runoff ? 'shadow-[inset_6px_0_0_rgb(var(--mg-ink))]' : ''}`}>
                    <span className="mg-display w-8 shrink-0 text-[22px] font-bold leading-none">{row.position}<span className="sr-only">{row.joint ? ' (joint)' : ''}</span></span>
                    <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                      <span className="truncate text-base font-semibold leading-tight">{row.teamName}</span>
                      {note && <span className="text-[13px] font-medium leading-none text-[rgb(var(--mg-body))]">{note}</span>}
                    </span>
                    <span className="mg-display shrink-0 text-2xl font-bold leading-none tabular-nums">{row.points}<span className="sr-only"> points</span></span>
                  </li>
                  {list.cutAfter === index && index < list.rows.length - 1 && (
                    <li role="separator" aria-label="Final cut-off" className="flex items-center gap-2.5 border-b border-[rgb(var(--mg-rule-soft))] px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[rgb(var(--mg-muted))]">
                      <span aria-hidden="true" className="flex-1 border-t-2 border-dashed border-[rgb(var(--mg-dash))]" />Final cut-off<span aria-hidden="true" className="flex-1 border-t-2 border-dashed border-[rgb(var(--mg-dash))]" />
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ol>
          {list.hc.length > 0 && <>
            <h3 className="border-b border-[rgb(var(--mg-rule-soft))] px-3.5 pb-1.5 pt-3 text-xs font-bold uppercase tracking-[0.06em] text-[rgb(var(--mg-muted))]">Hors concours</h3>
            <ul>
              {list.hc.map((team) => (
                <li key={team.teamId} className="flex min-h-14 items-center gap-3 border-b border-[rgb(var(--mg-rule-soft))] px-3.5 text-[rgb(var(--mg-muted))] last:border-b-0">
                  <span className="mg-display w-8 shrink-0 text-[22px] font-bold leading-none text-[rgb(var(--mg-faint))]">HC</span>
                  <span className="min-w-0 flex-1 truncate text-base font-semibold">{team.teamName}</span>
                  <span className="mg-display shrink-0 text-2xl font-bold leading-none tabular-nums">{team.points}<span className="sr-only"> points</span></span>
                </li>
              ))}
            </ul>
          </>}
        </section>
      ) : (
        <section aria-label="Points by session" className="mg-card overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="mg-display border-b border-[rgb(var(--mg-rule))] text-xs font-bold uppercase tracking-[0.03em] text-[rgb(var(--mg-muted))]">
                <th scope="col" className="w-10 px-3.5 py-2.5 text-left font-bold">#</th>
                <th scope="col" className="py-2.5 text-left font-bold">Team</th>
                {list.bySession.sessions.map((s) => <th key={s.id} scope="col" className="w-11 py-2.5 text-center font-bold"><abbr title={s.title} className="no-underline">{s.label}</abbr></th>)}
                <th scope="col" className="w-12 px-3.5 py-2.5 text-right font-bold text-[rgb(var(--mg-heading))]">Pts</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row) => {
                const cells = list.bySession.cells.get(row.teamId);
                return (
                  <tr key={row.teamId} className="border-b border-[rgb(var(--mg-rule-soft))] last:border-b-0">
                    <td className="mg-display px-3.5 py-3 text-lg font-bold">{row.position}</td>
                    <th scope="row" className="min-w-0 py-3 pr-2 text-left text-[15px] font-semibold leading-tight">{row.teamName}</th>
                    {list.bySession.sessions.map((s, i) => (
                      <td key={s.id} className="mg-display text-center text-[17px] font-semibold tabular-nums">
                        {cells ? cells[i] : <><span aria-hidden="true" className="text-[rgb(var(--mg-dash))]">–</span><span className="sr-only">No points yet</span></>}
                      </td>
                    ))}
                    <td className="mg-display px-3.5 text-right text-[22px] font-bold tabular-nums text-[rgb(var(--mg-heading))]">{row.points}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {list.runoff && (
        <section aria-labelledby="runoff-title" className="mg-card flex flex-col gap-3 p-3.5">
          <div className="flex items-baseline gap-2.5">
            <h2 id="runoff-title" className="mg-h2 flex-1">Run-off for {ordinal(list.runoff.place)}</h2>
            <span className="text-xs font-semibold text-[rgb(var(--mg-muted))]">Pending</span>
          </div>
          <p className="text-sm font-medium leading-snug text-[rgb(var(--mg-body))]">
            {[section?.runoffRaceName?.trim() || 'Run-off race', list.sessionsDone < list.sessionsTotal ? `after session ${list.sessionsTotal}, if still tied` : 'to be run'].join(' · ')}
          </p>
          <ol className="overflow-hidden rounded-[10px] border border-[rgb(var(--mg-rule-soft))]">
            {list.runoff.teams.map((row, i) => (
              <li key={row.teamId} className="flex min-h-12 items-center gap-3 border-b border-[rgb(var(--mg-rule-soft))] px-3 last:border-b-0">
                <span className="mg-display w-12 shrink-0 text-base font-bold text-[rgb(var(--mg-muted))]">Lane {i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{row.teamName}</span>
                <span className="shrink-0 text-[13px] font-semibold text-[rgb(var(--mg-body))]">{row.points} pts</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
