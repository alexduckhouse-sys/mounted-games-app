import { Fragment, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Trophy } from 'lucide-react';
import type { CompetitionSection, Heat, Session, Team } from '../../types';
import { parseBibAndFlag } from '../../lib/bib';
import { statusLabel, statusLetter } from '../../lib/resultStatus';
import { ordinal, toplistNote, type FinalGroup, type GameStandingGroup, type Toplist } from '../../lib/toplist';
import { HeatScores } from './HeatScores';
import { TeamSheet } from './TeamSheet';
import { formatPoints } from '../../lib/formatPoints';

export type ToplistViewTab = 'finals' | 'totals' | 'sessions' | 'games' | 'heats';
type View = ToplistViewTab;

const separatorLabel = 'flex items-center gap-2 border-b border-[rgb(var(--mg-rule-soft))] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[rgb(var(--mg-red))]';
const dashes = <span aria-hidden="true" className="flex-1 border-t-2 border-dashed border-current" />;

/**
 * The age group's toplist: finals once they have results, totals with the final cut-off and any run-off,
 * points per session, or per-game breakdown across heats. Tapping a team opens its breakdown. `standalone` draws the view tabs as a full-width
 * band under the page header (the toplist page); embedded in the timetable they stay in the column.
 */
export function ToplistView({
  list,
  section,
  standalone = false,
  competitionId,
  teams,
  heats,
  chosenView,
  onChooseView,
}: {
  list: Toplist;
  section: CompetitionSection | null;
  standalone?: boolean;
  competitionId?: number;
  teams?: Team[];
  heats?: { session: Session; orderedHeats: Heat[]; heat: Heat }[];
  chosenView?: View | null;
  onChooseView?: (view: View) => void;
}) {
  const navigate = useNavigate();
  const hasFinals = list.finals.length > 0;
  const hasSessions = list.bySession.sessions.length > 0;
  const games = list.byGame ?? [];
  const hasGames = games.length > 0;
  const hasHeats = (heats?.length ?? 0) > 0;
  // null until the viewer picks one, so finals become the default the moment they have results.
  const [internalChosen, setInternalChosen] = useState<View | null>(null);
  const chosen = chosenView !== undefined ? chosenView : internalChosen;
  const setChosen = onChooseView ?? setInternalChosen;
  const [chosenGame, setChosenGame] = useState<string | null>(null);
  const [openTeam, setOpenTeam] = useState<{ sectionId: number | null; teamId: number } | null>(null);
  const currentSectionId = section?.id ?? null;
  const activeOpenTeam = openTeam?.sectionId === currentSectionId ? openTeam.teamId : null;
  const tabs: [View, string][] = [
    ...(hasFinals ? ([['finals', 'Finals']] as [View, string][]) : []),
    ['totals', 'Totals'],
    ...(hasSessions ? ([['sessions', 'By session']] as [View, string][]) : []),
    ...(hasGames ? ([['games', 'By game']] as [View, string][]) : []),
    ...(hasHeats ? ([['heats', 'Heat tables']] as [View, string][]) : []),
  ];
  const view: View = tabs.some(([id]) => id === chosen) ? chosen! : tabs[0][0];
  const places = section?.finalistCount ?? null;
  const sheet = activeOpenTeam == null ? null : list.detail.get(activeOpenTeam) ?? null;
  const open = (teamId: number) => {
    if (competitionId != null) return () => navigate(`/competitions/${competitionId}/teams/${teamId}`);
    return list.detail.has(teamId) ? () => setOpenTeam({ sectionId: currentSectionId, teamId }) : undefined;
  };
  const flagFor = (teamId: number) => parseBibAndFlag(teams?.find((t) => t.id === teamId)?.bibDescription).flag;
  const flagBadge = (teamId: number) => {
    const flag = flagFor(teamId);
    return flag ? <img src={`/flags/${flag}.png`} alt="" className="mr-1.5 inline-block h-3.5 w-5 shrink-0 rounded-[2px] object-cover align-middle" /> : null;
  };

  const tabBar = tabs.length > 1 && (
    <div className={standalone ? 'mg-band py-2' : undefined}>
      <div className="mg-seg" role="group" aria-label="Toplist view">
        {tabs.map(([id, label]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => setChosen(id)}>{label}</button>)}
      </div>
    </div>
  );

  return (
    <>
      {tabBar}
      <div className={`flex flex-col gap-3 ${tabs.length > 1 || standalone ? 'pt-3' : ''}`}>
        {view === 'finals' && <FinalsList groups={list.finals} onOpen={open} flagBadge={flagBadge} />}

        {view === 'totals' && <>
          {places != null && places > 0 && <p className="text-sm font-medium leading-snug text-[rgb(var(--mg-body))]">Top {places} make the final</p>}
          <section aria-label="Totals" className="mg-card overflow-hidden">
            <ol>
              {list.rows.map((row, index) => {
                const note = toplistNote(row);
                const lastInRunoff = row.runoff && list.rows[index + 1]?.runoff;
                const openRow = open(row.teamId);
                const leaderPoints = list.rows[0]?.points ?? 0;
                const gap = list.started && index > 0 && leaderPoints > row.points ? leaderPoints - row.points : 0;
                const content = <>
                  <span className="mg-display w-7 shrink-0 text-xl font-bold leading-none">{list.started ? row.position : '—'}<span className="sr-only">{list.started && row.joint ? ' (joint)' : ''}</span></span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
                    <span className="truncate text-base font-semibold leading-tight">{flagBadge(row.teamId)}{row.teamName}</span>
                    {note && <span className="text-[13.5px] font-medium leading-none text-[rgb(var(--mg-body))]">{note}</span>}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="mg-display text-xl font-bold leading-none tabular-nums text-[rgb(var(--mg-heading))]">{formatPoints(row.points)}<span className="sr-only"> points</span></span>
                    {gap > 0 && <span className="text-[11px] font-semibold leading-none tabular-nums text-[rgb(var(--mg-muted))]" title={`${formatPoints(gap)} behind leader`}>−{formatPoints(gap)}</span>}
                  </span>
                  {openRow && <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0 text-[rgb(var(--mg-dash))]" />}
                </>;
                return (
                  <Fragment key={row.teamId}>
                    <li className={`${lastInRunoff ? 'border-b border-dashed border-[rgb(var(--mg-rule))]' : 'border-b border-[rgb(var(--mg-rule-soft))]'} ${row.runoff ? 'shadow-[inset_6px_0_0_rgb(var(--mg-ink))]' : ''}`}>
                      {openRow
                        ? <button type="button" onClick={openRow} aria-haspopup="dialog" className="flex min-h-11 w-full items-center gap-2.5 px-3 text-left">{content}</button>
                        : <div className="flex min-h-11 items-center gap-2.5 px-3">{content}</div>}
                    </li>
                    {list.cutAfter === index && index < list.rows.length - 1 && (
                      <li role="separator" aria-label="Final cut-off" className={`${separatorLabel} !py-1.5 !text-[rgb(var(--mg-muted))]`}>
                        {dashes}Final cut-off{dashes}
                      </li>
                    )}
                  </Fragment>
                );
              })}
            </ol>
            {list.hc.length > 0 && <>
              <h3 className="border-b border-[rgb(var(--mg-rule-soft))] px-3 pb-1.5 pt-3 text-xs font-bold uppercase tracking-[0.06em] text-[rgb(var(--mg-muted))]">Hors concours</h3>
              <ul>
                {list.hc.map((team) => (
                  <li key={team.teamId} className="flex min-h-11 items-center gap-2.5 border-b border-[rgb(var(--mg-rule-soft))] px-3 text-[rgb(var(--mg-muted))] last:border-b-0">
                    <span className="mg-display w-7 shrink-0 text-xl font-bold leading-none text-[rgb(var(--mg-faint))]">HC</span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
                      <span className="truncate text-base font-semibold leading-tight">{team.teamName}</span>
                      {team.racesLeft > 0 && <span className="text-[13.5px] font-medium leading-none">{team.racesLeft} {team.racesLeft === 1 ? 'race' : 'races'} left</span>}
                    </span>
                    <span className="mg-display shrink-0 text-xl font-bold leading-none tabular-nums">{formatPoints(team.points)}<span className="sr-only"> points</span></span>
                  </li>
                ))}
              </ul>
            </>}
          </section>
        </>}

        {view === 'sessions' && (
          <section aria-label="Points by session" className="mg-card overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="mg-display border-b border-[rgb(var(--mg-rule))] text-xs font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-muted))]">
                  <th scope="col" className="w-9 py-1.5 pl-3 text-left font-bold">#</th>
                  <th scope="col" className="py-1.5 text-left font-bold">Team</th>
                  {list.bySession.sessions.map((s) => <th key={s.id} scope="col" className="w-9 py-1.5 text-center font-bold"><abbr title={s.title} className="no-underline">{s.label}</abbr></th>)}
                  <th scope="col" className="w-11 py-1.5 pr-3 text-right font-bold text-[rgb(var(--mg-heading))]">Pts</th>
                  <th scope="col" className="w-6"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((row) => {
                  const cells = list.bySession.cells.get(row.teamId);
                  const openRow = open(row.teamId);
                  return (
                    <tr key={row.teamId} className="border-b border-[rgb(var(--mg-rule-soft))] last:border-b-0">
                      <td className="mg-display h-11 py-0 pl-3 text-base font-bold">{list.started ? <>{row.position}{row.joint ? '=' : ''}</> : '—'}</td>
                      <th scope="row" className="min-w-0 py-0 pr-2 text-left text-[15px] font-semibold leading-tight">
                        {openRow ? <button type="button" onClick={openRow} aria-haspopup="dialog" className="block min-h-11 w-full text-left font-semibold">{flagBadge(row.teamId)}{row.teamName}</button> : <>{flagBadge(row.teamId)}{row.teamName}</>}
                      </th>
                      {list.bySession.sessions.map((s, i) => (
                        <td key={s.id} className="mg-display text-center text-base font-semibold tabular-nums">
                          {cells ? cells[i] : <><span aria-hidden="true" className="text-[rgb(var(--mg-dash))]">–</span><span className="sr-only">No points yet</span></>}
                        </td>
                      ))}
                      <td className="mg-display pr-3 text-right text-xl font-bold tabular-nums text-[rgb(var(--mg-heading))]">{formatPoints(row.points)}</td>
                      <td aria-hidden="true">{openRow && <ChevronRight className="mr-2 h-3 w-3 text-[rgb(var(--mg-dash))]" />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {view === 'games' && hasGames && (
          <GamesList
            groups={games}
            chosen={chosenGame}
            onChoose={setChosenGame}
            onOpen={open}
            flagBadge={flagBadge}
          />
        )}

        {view === 'heats' && heats && hasHeats && (
          <section aria-label="Heat tables" className="flex flex-col gap-3">
            {heats.map(({ session: s, orderedHeats, heat: h }) => (
              <HeatScores key={h.id} session={s} heats={orderedHeats} activeHeatId={h.id} />
            ))}
          </section>
        )}

        {list.runoff && view === 'totals' && (
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
                  <span className="min-w-0 flex-1 truncate text-base font-semibold">{row.teamName}</span>
                  <span className="shrink-0 text-sm font-semibold text-[rgb(var(--mg-body))]">{formatPoints(row.points)} pts</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
      {sheet && (
        <TeamSheet
          detail={sheet}
          sectionName={section?.displayName ?? null}
          competitionId={competitionId}
          team={teams?.find((t) => t.id === sheet.teamId) ?? null}
          onClose={() => setOpenTeam(null)}
        />
      )}
    </>
  );
}

function GamesList({
  groups,
  chosen,
  onChoose,
  onOpen,
  flagBadge,
}: {
  groups: GameStandingGroup[];
  chosen: string | null;
  onChoose: (name: string) => void;
  onOpen: (teamId: number) => (() => void) | undefined;
  flagBadge: (teamId: number) => React.ReactNode;
}) {
  const active = groups.find((g) => g.name === chosen) ?? groups[0];
  return (
    <div className="flex flex-col gap-2.5">
      {groups.length > 1 && (
        <div role="group" aria-label="Choose a game" className="mg-chips">
          {groups.map((g) => (
            <button key={g.name} type="button" className="mg-chip" aria-pressed={active.name === g.name} onClick={() => onChoose(g.name)}>
              {g.name}
            </button>
          ))}
        </div>
      )}
      <section aria-label={`Points by game: ${active.name}`} className="mg-card overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="mg-display border-b border-[rgb(var(--mg-rule))] text-xs font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-muted))]">
              <th scope="col" className="w-9 py-1.5 pl-3 text-left font-bold">#</th>
              <th scope="col" className="py-1.5 text-left font-bold">Team</th>
              <th scope="col" className="py-1.5 px-2 text-left font-bold">Heat</th>
              <th scope="col" className="w-12 py-1.5 text-center font-bold">Place</th>
              <th scope="col" className="w-11 py-1.5 pr-3 text-right font-bold text-[rgb(var(--mg-heading))]">Pts</th>
              <th scope="col" className="w-6"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {active.rows.map((row, idx) => {
              const openRow = onOpen(row.teamId);
              const placeLabel = row.isSitOut
                ? <><span aria-hidden="true" className="text-[rgb(var(--mg-dash))]">S</span><span className="sr-only">Sat out</span></>
                : row.eliminated
                  ? <><span aria-hidden="true" className="text-[rgb(var(--mg-elim))]">{statusLetter(true, row.status)}</span><span className="sr-only">{statusLabel(true, row.status)}</span></>
                  : row.placing != null ? ordinal(row.placing) : '–';
              return (
                <tr key={`${row.teamId}-${row.heatLabel}-${idx}`} className="border-b border-[rgb(var(--mg-rule-soft))] last:border-b-0">
                  <td className="mg-display h-11 py-0 pl-3 text-base font-bold">{row.position}{row.joint ? '=' : ''}</td>
                  <th scope="row" className="min-w-0 py-0 pr-2 text-left text-[15px] font-semibold leading-tight">
                    {openRow
                      ? <button type="button" onClick={openRow} aria-haspopup="dialog" className="block min-h-11 w-full text-left font-semibold">{flagBadge(row.teamId)}{row.teamName}</button>
                      : <>{flagBadge(row.teamId)}{row.teamName}</>}
                  </th>
                  <td className="py-0 px-2 text-xs font-medium text-[rgb(var(--mg-muted))]">{row.heatLabel}</td>
                  <td className="mg-display text-center text-sm font-semibold tabular-nums text-[rgb(var(--mg-body))]">{placeLabel}</td>
                  <td className="mg-display pr-3 text-right text-xl font-bold tabular-nums text-[rgb(var(--mg-heading))]">{formatPoints(row.points)}</td>
                  <td aria-hidden="true">{openRow && <ChevronRight className="mr-2 h-3 w-3 text-[rgb(var(--mg-dash))]" />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function FinalsList({
  groups,
  onOpen,
  flagBadge,
}: {
  groups: FinalGroup[];
  onOpen: (teamId: number) => (() => void) | undefined;
  flagBadge: (teamId: number) => React.ReactNode;
}) {
  return (
    <section aria-label="Finals" className="mg-card overflow-hidden">
      {groups.map((group, index) => (
        <Fragment key={group.id}>
          <h3 className={`${separatorLabel} ${index > 0 ? 'border-t' : ''}`}>{dashes}{group.label}{dashes}</h3>
          <ol aria-label={group.label}>
            {group.rows.map((row) => {
              const openRow = onOpen(row.teamId);
              const winner = row.place === 1;
              const content = <>
                <span className={`mg-display w-9 shrink-0 text-lg font-bold leading-none ${winner ? 'text-[rgb(var(--mg-late-time))]' : ''}`}>{row.place != null ? ordinal(row.place) : <span aria-hidden="true">–</span>}</span>
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="truncate text-base font-semibold leading-tight">{flagBadge(row.teamId)}{row.teamName}</span>
                  {winner && <Trophy aria-label="Winner" role="img" className="h-[13px] w-[13px] shrink-0 text-[rgb(var(--mg-late-time))]" />}
                  {row.qualifyingPosition != null && (
                    <span className="shrink-0 rounded bg-[rgb(var(--mg-tint))] px-1.5 py-[3px] text-xs font-bold leading-none text-[rgb(var(--mg-body))]">
                      <span aria-hidden="true">Q{row.qualifyingPosition}</span><span className="sr-only">Qualified {ordinal(row.qualifyingPosition)}</span>
                    </span>
                  )}
                </span>
                <span className="mg-display shrink-0 text-xl font-bold leading-none tabular-nums text-[rgb(var(--mg-heading))]">{row.points == null ? '–' : formatPoints(row.points)}<span className="sr-only"> points</span></span>
                {openRow && <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0 text-[rgb(var(--mg-dash))]" />}
              </>;
              return (
                <li key={row.teamId} className="border-b border-[rgb(var(--mg-rule-soft))] last:border-b-0">
                  {openRow
                    ? <button type="button" onClick={openRow} aria-haspopup="dialog" className="flex min-h-11 w-full items-center gap-2.5 px-3 text-left">{content}</button>
                    : <div className="flex min-h-11 items-center gap-2.5 px-3">{content}</div>}
                </li>
              );
            })}
          </ol>
        </Fragment>
      ))}
    </section>
  );
}
