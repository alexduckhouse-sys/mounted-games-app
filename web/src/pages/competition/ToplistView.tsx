import { Fragment, useContext, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { ChevronRight, Star, Trophy } from 'lucide-react';
import { motion } from 'framer-motion';
import { api } from '../../api';
import type { CompetitionSection, DeclarationForm, Heat, Session, Team } from '../../types';
import { ordinal, toplistNote, type FinalGroup, type GameStandingGroup, type Toplist } from '../../lib/toplist';
import { useFavourites } from '../../hooks/useFavourites';
import { CompetitionContext } from './context';
import { parseBibAndFlag } from '../../lib/bib';
import { statusLabel, statusLetter } from '../../lib/resultStatus';
import { HeatScores } from './HeatScores';
import { TeamSheet } from './TeamSheet';
import { Rosette } from '../../components/Rosette';
import { ScoreFlash } from '../../components/ScoreFlash';
import { TickerNumber } from '../../components/TickerNumber';
import { useRankMotion } from '../../hooks/useRankMotion';
import { EASE_OUT } from '../../lib/motion';

// When a result moves teams, their rows slide to the new places rather than jumping.
const RESORT = { layout: { duration: 0.5, ease: EASE_OUT } };
import { formatPoints } from '../../lib/formatPoints';
import { publicRiderName } from '../../lib/riderNames';


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
  competitionId: suppliedCompetitionId,
  teams: suppliedTeams,
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
  const compCtx = useContext(CompetitionContext);
  const inRouter = useInRouterContext();
  const teams = suppliedTeams ?? compCtx?.competition.teams ?? [];
  const competitionId = suppliedCompetitionId ?? compCtx?.competition.id ?? section?.competitionId ?? null;
  const favHook = useFavourites() as {
    favourites?: { competitionId: number; teamId: number }[];
    isTeamFav?: (compId: number, teamId: number) => boolean;
  };
  const isFav = (teamId: number) => {
    if (competitionId != null && typeof favHook.isTeamFav === 'function') {
      return favHook.isTeamFav(competitionId, teamId);
    }
    return (favHook.favourites ?? []).some((f) => (competitionId == null || f.competitionId === competitionId) && f.teamId === teamId);
  };
  const renderTeamName = (teamId: number, teamName: string, fav: boolean, asLink = false) => {
    const inner = (
      <>
        {fav && <Star aria-hidden="true" className="mr-1 inline h-3.5 w-3.5 shrink-0 fill-[#C08308] text-[#C08308]" />}
        {flagBadge(teamId)}{teamName}
      </>
    );
    if (asLink && inRouter && competitionId != null) {
      return (
        <Link
          to={`/competitions/${competitionId}/teams/${teamId}`}
          className="hover:underline"
        >
          {inner}
        </Link>
      );
    }
    return inner;
  };
  const renderTeamLink = (teamId: number, teamName: string) =>
    inRouter && competitionId != null ? (
      <Link
        to={`/competitions/${competitionId}/teams/${teamId}`}
        aria-label={`${teamName} team page`}
        title={`${teamName} team page`}
        className="flex h-11 w-7 shrink-0 items-center justify-center text-[rgb(var(--mg-dash))] hover:text-[rgb(var(--mg-heading))]"
      >
        <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    ) : (
      <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0 text-[rgb(var(--mg-dash))]" />
    );

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
  // When results re-rank the table: climbers swell and lift, big climbs sparkle, and crossing the cut-off throws confetti.
  const rankIds = list.rows.map((row) => row.teamId);
  const totalsRef = useRankMotion<HTMLOListElement>(rankIds, list.cutAfter ?? null);
  const sessionsRef = useRankMotion<HTMLTableSectionElement>(rankIds, list.cutAfter ?? null);
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
    if (inRouter && competitionId != null) return undefined;
    return list.detail.has(teamId) ? () => setOpenTeam({ sectionId: currentSectionId, teamId }) : undefined;
  };
  const flagFor = (teamId: number) => parseBibAndFlag(teams?.find((t) => t.id === teamId)?.bibDescription).flag;
  const flagBadge = (teamId: number) => {
    const flag = flagFor(teamId);
    return flag ? <img src={`/flags/${flag}.png`} alt="" className="mr-1.5 inline-block h-3.5 w-5 shrink-0 rounded-[2px] object-cover align-middle" /> : null;
  };

  const tabBar = tabs.length > 1 && (
    <div className={standalone ? 'mg-band-header pb-2.5 pt-1' : undefined}>
      <div className="mg-seg" role="group" aria-label="Toplist view">
        {tabs.map(([id, label]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => setChosen(id)}>{label}</button>)}
      </div>
    </div>
  );

  return (
    <>
      {tabBar}
      <div className={`flex flex-col gap-3 ${tabs.length > 1 || standalone ? 'pt-3' : ''}`}>
        {view === 'finals' && (
          <FinalsList
            groups={list.finals}
            onOpen={open}
            isFav={isFav}
            renderTeamName={renderTeamName}
            renderTeamLink={renderTeamLink}
            competitionId={competitionId}
            teams={teams}
          />
        )}

        {view === 'totals' && <>
          {places != null && places > 0 && <p className="text-sm font-medium leading-snug text-[rgb(var(--mg-body))]">Top {places} make the final</p>}
          <section aria-label="Totals" className="mg-card overflow-hidden">
            <ol ref={totalsRef}>
              {list.rows.map((row, index) => {
                const note = toplistNote(row);
                const lastInRunoff = row.runoff && list.rows[index + 1]?.runoff;
                const openRow = open(row.teamId);
                const fav = isFav(row.teamId);
                const leaderPoints = list.rows[0]?.points ?? 0;
                const gap = list.started && index > 0
                  ? Number(formatPoints(leaderPoints)) - Number(formatPoints(row.points))
                  : 0;
                const content = <>
                  <span className="mg-display w-7 shrink-0 text-xl font-bold leading-none">{list.started ? row.position : '—'}<span className="sr-only">{list.started && row.joint ? ' (joint)' : ''}</span></span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
                    <span data-grow="start" className="truncate text-base font-semibold leading-tight">{renderTeamName(row.teamId, row.teamName, fav, !openRow)}</span>
                    {note && <span className="text-[13.5px] font-medium leading-none text-[rgb(var(--mg-body))]">{note}</span>}
                  </span>
                  <span data-grow="end" className="flex shrink-0 flex-col items-end gap-0.5">
                    <ScoreFlash value={row.points} className="mg-display text-xl font-bold leading-none tabular-nums text-[rgb(var(--mg-heading))]"><TickerNumber value={row.points} /><span className="sr-only"> points</span></ScoreFlash>
                    {gap > 0 && <span className="text-[11px] font-semibold leading-none tabular-nums text-[rgb(var(--mg-muted))]" title={`${formatPoints(gap)} behind leader`}>−{formatPoints(gap)}</span>}
                  </span>
                </>;
                return (
                  <Fragment key={row.teamId}>
                    <motion.li
                      layout="position"
                      transition={RESORT}
                      data-rank-id={row.teamId}
                      data-followed={fav ? 'true' : undefined}
                      className={`flex min-h-11 items-center pr-1 ${lastInRunoff ? 'border-b border-dashed border-[rgb(var(--mg-rule))]' : 'border-b border-[rgb(var(--mg-rule-soft))]'} ${row.runoff ? 'shadow-[inset_6px_0_0_rgb(var(--mg-ink))]' : fav ? 'bg-[rgb(var(--mg-tint))] shadow-[inset_3px_0_0_#C08308]' : ''}`}
                    >
                      {openRow
                        ? <button type="button" onClick={openRow} aria-haspopup="dialog" className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 pl-3 pr-1 text-left">{content}</button>
                        : <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 pl-3 pr-1">{content}</div>}
                      {openRow && renderTeamLink(row.teamId, row.teamName)}
                    </motion.li>
                    {list.cutAfter === index && index < list.rows.length - 1 && (
                      <motion.li layout="position" transition={RESORT} role="separator" aria-label="Final cut-off" className={`${separatorLabel} !py-1.5 !text-[rgb(var(--mg-muted))]`}>
                        {dashes}Final cut-off{dashes}
                      </motion.li>
                    )}
                  </Fragment>
                );
              })}
            </ol>
            {list.hc.length > 0 && <>
              <h3 className="border-b border-[rgb(var(--mg-rule-soft))] px-3 pb-1.5 pt-3 text-xs font-bold uppercase tracking-[0.06em] text-[rgb(var(--mg-muted))]">Hors concours</h3>
              <ul>
                {list.hc.map((team) => {
                  const fav = isFav(team.teamId);
                  return (
                    <li key={team.teamId} data-followed={fav ? 'true' : undefined} className={`flex min-h-11 items-center gap-2.5 border-b border-[rgb(var(--mg-rule-soft))] px-3 text-[rgb(var(--mg-muted))] last:border-b-0 ${fav ? 'bg-[rgb(var(--mg-tint))] shadow-[inset_3px_0_0_#C08308]' : ''}`}>
                      <span className="mg-display w-7 shrink-0 text-xl font-bold leading-none text-[rgb(var(--mg-faint))]">HC</span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
                        <span className="truncate text-base font-semibold leading-tight">{renderTeamName(team.teamId, team.teamName, fav, true)}</span>
                        {team.racesLeft > 0 && <span className="text-[13.5px] font-medium leading-none">{team.racesLeft} {team.racesLeft === 1 ? 'race' : 'races'} left</span>}
                      </span>
                      <span className="mg-display shrink-0 text-xl font-bold leading-none tabular-nums">{formatPoints(team.points)}<span className="sr-only"> points</span></span>
                    </li>
                  );
                })}
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
              <tbody ref={sessionsRef}>
                {list.rows.map((row) => {
                  const cells = list.bySession.cells.get(row.teamId);
                  const openRow = open(row.teamId);
                  const fav = isFav(row.teamId);
                  return (
                    <motion.tr key={row.teamId} layout="position" transition={RESORT} data-rank-id={row.teamId} data-followed={fav ? 'true' : undefined} className={`border-b border-[rgb(var(--mg-rule-soft))] last:border-b-0 ${fav ? 'bg-[rgb(var(--mg-tint))] shadow-[inset_3px_0_0_#C08308]' : ''}`}>
                      <td className="mg-display h-11 py-0 pl-3 text-base font-bold">{list.started ? row.position : '—'}</td>
                      <th scope="row" className="min-w-0 py-0 pr-2 text-left text-[15px] font-semibold leading-tight">
                        {openRow ? <button type="button" onClick={openRow} aria-haspopup="dialog" className="block min-h-11 w-full text-left font-semibold">{renderTeamName(row.teamId, row.teamName, fav, false)}</button> : renderTeamName(row.teamId, row.teamName, fav, true)}
                      </th>
                      {list.bySession.sessions.map((s, i) => (
                        <td key={s.id} className="mg-display text-center text-base font-semibold tabular-nums">
                          {cells ? formatPoints(cells[i]) : <><span aria-hidden="true" className="text-[rgb(var(--mg-dash))]">–</span><span className="sr-only">No points yet</span></>}
                        </td>
                      ))}
                      <td className="mg-display pr-3 text-right text-xl font-bold tabular-nums text-[rgb(var(--mg-heading))]"><span data-grow="end"><ScoreFlash value={row.points}><TickerNumber value={row.points} /></ScoreFlash></span></td>
                      <td>{openRow && renderTeamLink(row.teamId, row.teamName)}</td>
                    </motion.tr>
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
            renderTeamName={(id, name) => renderTeamName(id, name, isFav(id), true)}
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
                  <span className="min-w-0 flex-1 truncate text-base font-semibold">{renderTeamName(row.teamId, row.teamName, isFav(row.teamId), true)}</span>
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
          competitionId={competitionId ?? undefined}
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
  renderTeamName,
}: {
  groups: GameStandingGroup[];
  chosen: string | null;
  onChoose: (name: string) => void;
  onOpen: (teamId: number) => (() => void) | undefined;
  renderTeamName: (teamId: number, name: string) => React.ReactNode;
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
                      ? <button type="button" onClick={openRow} aria-haspopup="dialog" className="block min-h-11 w-full text-left font-semibold">{renderTeamName(row.teamId, row.teamName)}</button>
                      : <>{renderTeamName(row.teamId, row.teamName)}</>}
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

function FinalsList({ groups, onOpen, isFav, renderTeamName, renderTeamLink, competitionId, teams }: {
  groups: FinalGroup[];
  onOpen: (teamId: number) => (() => void) | undefined;
  isFav: (teamId: number) => boolean;
  renderTeamName: (teamId: number, teamName: string, fav: boolean, asLink?: boolean) => React.ReactNode;
  renderTeamLink: (teamId: number, teamName: string) => React.ReactNode;
  competitionId: number | null;
  teams: Team[];
}) {
  const [prizeGiving, setPrizeGiving] = useState(false);
  const [declarations, setDeclarations] = useState<DeclarationForm[] | null>(null);

  function togglePrizeGiving() {
    const next = !prizeGiving;
    setPrizeGiving(next);
    if (next && declarations === null && competitionId != null) {
      api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId } })
        .then((r) => setDeclarations(Array.isArray(r?.data) ? r.data : []))
        .catch(() => setDeclarations([]));
    }
  }

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const decByTeamId = new Map((declarations ?? []).map((d) => [d.teamId, d]));

  return (
    <section aria-label="Finals" className="mg-card overflow-hidden">
      <div className="flex items-center justify-end border-b border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] px-3 py-1.5">
        <button
          type="button"
          aria-pressed={prizeGiving}
          onClick={togglePrizeGiving}
          className="text-xs font-bold text-[rgb(var(--mg-heading))] hover:underline"
        >
          Prize Giving (Last to First)
        </button>
      </div>
      {groups.map((group, index) => (
        <Fragment key={group.id}>
          <h3 className={`${separatorLabel} ${index > 0 ? 'border-t' : ''}`}>{dashes}{group.label}{dashes}</h3>
          {prizeGiving ? (
            <ol aria-label={`${group.label} prize giving`}>
              {group.rows.slice().reverse().map((row) => {
                const teamObj = teamById.get(row.teamId);
                const dec = decByTeamId.get(row.teamId);
                const trainer = dec?.trainerName?.trim() || dec?.submittedByName?.trim() || teamObj?.trainerName?.trim() || null;
                const riders = dec?.riders?.slice().sort((a, b) => a.orderIndex - b.orderIndex) ?? [];
                return (
                  <li key={row.teamId} className="flex flex-col gap-1 border-b border-[rgb(var(--mg-rule-soft))] px-3 py-2.5 last:border-b-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="mg-display text-lg font-bold text-[rgb(var(--mg-heading))]">
                        {row.place != null ? ordinal(row.place) : '–'} · {row.teamName}
                      </span>
                      <span className="mg-display text-base font-bold tabular-nums text-[rgb(var(--mg-heading))]">
                        {row.points != null ? formatPoints(row.points) : '–'} pts
                      </span>
                    </div>
                    {teamObj?.clubName && (
                      <div className="text-xs font-medium text-[rgb(var(--mg-muted))]">{teamObj.clubName}</div>
                    )}
                    {trainer && (
                      <div className="text-xs font-semibold text-[rgb(var(--mg-body))]">Trained by {trainer}</div>
                    )}
                    {riders.length > 0 && (
                      <ul className="mt-0.5 flex flex-col gap-0.5 text-xs text-[rgb(var(--mg-ink))]">
                        {riders.map((r) => (
                          <li key={r.id}>
                            {publicRiderName(r)}{r.horseName ? ` — ${r.horseName}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <ol aria-label={group.label}>
              {group.rows.map((row) => {
                const openRow = onOpen(row.teamId);
                const winner = row.place === 1;
                // Once the final is over its winners are champions: a gold row, a rosette and a shine across it.
                const champion = winner && group.complete === true;
                const fav = isFav(row.teamId);
                const content = <>
                  <span className={`mg-display w-9 shrink-0 text-lg font-bold leading-none ${winner ? 'text-[rgb(var(--mg-late-time))]' : ''}`}>{row.place != null ? ordinal(row.place) : <span aria-hidden="true">–</span>}</span>
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate text-base font-semibold leading-tight">{renderTeamName(row.teamId, row.teamName, fav, !openRow)}</span>
                    {winner && <Trophy aria-label="Winner" role="img" className="h-[13px] w-[13px] shrink-0 text-[rgb(var(--mg-late-time))]" />}
                    {champion && <span className="mg-champion-label">Champions</span>}
                    {row.qualifyingPosition != null && (
                      <span className="shrink-0 rounded bg-[rgb(var(--mg-tint))] px-1.5 py-[3px] text-xs font-bold leading-none text-[rgb(var(--mg-body))]">
                        <span aria-hidden="true">Q{row.qualifyingPosition}</span><span className="sr-only">Qualified {ordinal(row.qualifyingPosition)}</span>
                      </span>
                    )}
                  </span>
                  {champion && <span className="mg-champion-rosette"><Rosette width={26} /></span>}
                  <span className="mg-display shrink-0 text-xl font-bold leading-none tabular-nums text-[rgb(var(--mg-heading))]">{row.points != null ? formatPoints(row.points) : '–'}<span className="sr-only"> points</span></span>
                </>;
                return (
                  <li key={row.teamId} data-followed={fav ? 'true' : undefined} className={`flex min-h-11 items-center pr-1 border-b border-[rgb(var(--mg-rule-soft))] last:border-b-0 ${champion ? 'mg-champion' : fav ? 'bg-[rgb(var(--mg-tint))] shadow-[inset_3px_0_0_#C08308]' : ''}`}>
                    {openRow
                      ? <button type="button" onClick={openRow} aria-haspopup="dialog" className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 pl-3 pr-1 text-left">{content}</button>
                      : <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 pl-3 pr-1">{content}</div>}
                    {openRow && renderTeamLink(row.teamId, row.teamName)}
                  </li>
                );
              })}
            </ol>
          )}
        </Fragment>
      ))}
    </section>
  );
}
