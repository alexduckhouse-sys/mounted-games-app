import { Fragment, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { Check, Trophy } from 'lucide-react';
import { motion } from 'framer-motion';
import type { CompetitionSection, Team } from '../../types';
import type { FinalGroup, FinalLineup, Toplist } from '../../lib/toplist';
import type { TimetableRow } from '../../lib/timetableRows';
import { formatTime } from '../../lib/time';
import { ordinalText, sessionColumnTitle, toplistNoteText, toplistNoteTone } from '../../lib/toplistText';
import { useLanguage } from '../../i18n/LanguageContext';
import { useFavourites } from '../../hooks/useFavourites';
import { CompetitionContext } from './context';
import { parseBibAndFlag } from '../../lib/bib';
import { TeamSheet, type TeamSheetRider } from './TeamSheet';
import { api } from '../../api';
import { publicRiderName } from '../../lib/riderNames';
import type { DeclarationForm } from '../../types';
import { DropdownRow } from '../../components/DropdownRow';
import { Sheet } from '../../components/Sheet';
import { useOptionalTicker } from '../../components/TickerContext';
import { FollowStar } from '../../components/FollowStar';
import { useStillMotion } from '../../lite/useStillMotion';
import { Rosette } from '../../components/Rosette';
import { ScoreFlash } from '../../components/ScoreFlash';
import { TickerNumber } from '../../components/TickerNumber';
import { useRankMotion } from '../../hooks/useRankMotion';
import { EASE_OUT } from '../../lib/motion';
import type { Lang, Translate } from '../../i18n/translate';

// When a result moves teams, their rows slide to the new places rather than jumping.
const RESORT = { layout: { duration: 0.3, ease: EASE_OUT } };
import './toplist.css';
import { formatPoints } from '../../lib/formatPoints';


// 'finals' is the final results (kept as the id so a saved choice keeps its meaning); 'lineups' is who is in each final.
export type ToplistViewTab = 'finals' | 'totals' | 'sessions' | 'heats' | 'lineups' | 'times';
type View = ToplistViewTab;

const separatorLabel = 'tl-cut';
const NOTE_TONE = { safe: 'text-[rgb(var(--mg-ok))]', need: 'text-[rgb(var(--mg-late-time))]' } as const;

/**
 * The age group's toplist: finals once they have results, totals with the final cut-off and any run-off,
 * points per session, or the heat tables. A button beside the ticker dock opens a "Show" sheet to switch between them
 * (only when there is more than one; outside the app's shell a "Show" row does it instead). Tapping anywhere on a
 * team's row opens its team page (or its breakdown outside the app's pages).
 */
export function ToplistView({
  list,
  section,
  competitionId: suppliedCompetitionId,
  teams: suppliedTeams,
  chosenView,
  onChooseView,
  heatTables,
  finalLineups,
  times,
}: {
  list: Toplist;
  section: CompetitionSection | null;
  competitionId?: number;
  teams?: Team[];
  chosenView?: View | null;
  onChooseView?: (view: View) => void;
  /** The age group's heat tables, offered as "Heats" in the Show row. */
  heatTables?: ReactNode;
  /** The teams drawn into each final, offered as "Finals": names only, no places or points. */
  finalLineups?: FinalLineup[];
  /** The age group's planned heat times, offered as "Times". */
  times?: TimetableRow[];
}) {
  const { t, lang } = useLanguage();
  const still = useStillMotion();
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
        {flagBadge(teamId)}{teamName}<NameStar on={fav} />
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
  const hasFinals = list.finals.length > 0;
  // Every final has been run: the table is the final result, so there is no cut-off left to show.
  const finished = hasFinals && list.finals.every((group) => group.complete === true);
  const hasSessions = list.bySession.sessions.length > 0;
  // null until the viewer picks one, so finals become the default the moment they have results.
  const [internalChosen, setInternalChosen] = useState<View | null>(null);
  const chosen = chosenView !== undefined ? chosenView : internalChosen;
  const setChosen = onChooseView ?? setInternalChosen;
  const [openTeam, setOpenTeam] = useState<{ sectionId: number | null; teamId: number } | null>(null);
  // When results re-rank the table: climbers swell and lift, big climbs sparkle, and crossing the cut-off throws confetti.
  const rankIds = list.rows.map((row) => row.teamId);
  const totalsRef = useRankMotion<HTMLOListElement>(rankIds, list.cutAfter ?? null);
  const sessionsRef = useRankMotion<HTMLTableSectionElement>(rankIds, list.cutAfter ?? null);
  const currentSectionId = section?.id ?? null;
  const activeOpenTeam = openTeam?.sectionId === currentSectionId ? openTeam.teamId : null;
  // Listed in this order; finals are the default once they have results.
  // With no standings yet there is no table to show, only the planned times and any finals already drawn.
  const hasRows = list.rows.length > 0;
  const tabs: [View, string][] = [
    ...(hasRows ? ([['totals', t('competition.toplist.totals')]] as [View, string][]) : []),
    ...(hasSessions && hasRows ? ([['sessions', t('competition.toplist.bySession')]] as [View, string][]) : []),
    ...(finalLineups && finalLineups.length > 0 ? ([['lineups', t('competition.toplist.finals')]] as [View, string][]) : []),
    ...(hasFinals ? ([['finals', t('competition.toplist.finalResults')]] as [View, string][]) : []),
    ...(heatTables ? ([['heats', t('competition.toplist.scoresByHeat')]] as [View, string][]) : []),
    ...(times && times.length > 0 ? ([['times', t('competition.toplist.times')]] as [View, string][]) : []),
  ];
  const view: View | undefined = tabs.some(([id]) => id === chosen) ? chosen! : hasFinals ? 'finals' : hasRows ? 'totals' : tabs[0]?.[0];
  // The first view appears as it is; only a change of view or age group fades in.
  const viewKey = `${currentSectionId}-${view}`;
  const [seenView, setSeenView] = useState({ key: viewKey, changes: 0 });
  if (seenView.key !== viewKey) setSeenView({ key: viewKey, changes: seenView.changes + 1 });
  const viewChanged = seenView.changes > 0 || seenView.key !== viewKey;
  const places = section?.finalistCount ?? null;
  const sheet = activeOpenTeam == null ? null : list.detail.get(activeOpenTeam) ?? null;
  // A team's row opens its sheet (riders, ponies and heat-by-heat scores) so a spectator stays on Standings; the sheet links on to the team page.
  const open = (teamId: number) => {
    return list.detail.has(teamId) ? () => setOpenTeam({ sectionId: currentSectionId, teamId }) : undefined;
  };
  // Rows with no breakdown to show (hors concours) still link to the team page inside the app.
  const teamHref = (teamId: number) => (inRouter && competitionId != null ? `/competitions/${competitionId}/teams/${teamId}` : null);
  const sheetRiders = useSheetRiders(sheet ? competitionId : null, sheet?.teamId ?? null);
  const flagFor = (teamId: number) => parseBibAndFlag(teams?.find((t) => t.id === teamId)?.bibDescription).flag;
  const flagBadge = (teamId: number) => {
    const flag = flagFor(teamId);
    return flag ? <img src={`/flags/${flag}.png`} alt="" className="mr-1.5 inline-block h-3.5 w-5 shrink-0 rounded-[2px] object-cover align-middle" /> : null;
  };

  // A team has a place once results are in and it has raced (an elimination still counts: that is an awarded zero).
  // A team with nothing recorded keeps a dash, so it isn't shown level with every other team on nought.
  const isRanked = (teamId: number, points: number) => list.started && (points !== 0 || list.bySession.cells.has(teamId));

  // "What to show" sits beside the ticker dock and opens the Show sheet. Without the app's dock (a page on its own),
  // the old "Show  Totals ›" row does the same job.
  const setDockAction = useOptionalTicker()?.setDockAction;
  const [showOpen, setShowOpen] = useState(false);
  const canShow = tabs.length > 1;
  const showLabel = t('competition.toplist.whatToShow');
  useEffect(() => {
    if (!setDockAction || !canShow) return;
    setDockAction({ label: showLabel, count: 0, onClick: () => setShowOpen(true) });
    return () => setDockAction(null);
  }, [setDockAction, canShow, showLabel]);
  const viewRow = canShow && !setDockAction && (
    <DropdownRow label={t('competition.toplist.show')} value={view ?? ''} options={tabs.map(([value, label]) => ({ value, label }))} onChange={(next) => setChosen(next as View)} />
  );

  const sessionCount = list.bySession.sessions.length;
  const manySessions = sessionCount > 5;
  const sessionWidth = manySessions ? `calc((100% - 36px - 44px - 110px) / ${sessionCount})` : '36px';
  return (
    <>
      <div className="tl flex flex-col gap-3">
        {viewRow}
        <div key={viewKey} className={`flex flex-col gap-3${still || !viewChanged ? '' : ' mg-settle'}`}>
        {view === 'finals' && (
          <FinalsList
            groups={list.finals}
            t={t}
            lang={lang}
            onOpen={open}
            teamHref={teamHref}
            isFav={isFav}
            renderTeamName={renderTeamName}
          />
        )}

        {view === 'totals' && <>
          {finished && <h2 className="fl-heading fl-ruled">{t('competition.toplist.finalResults')}</h2>}
          {places != null && places > 0 && <p className="tl-lead">{t('competition.toplist.topMake', { places })}</p>}
          {!list.started && list.rows.length > 0 && <p role="status" className="tl-waiting"><span aria-hidden="true" className="tl-waiting-dot" />{t('competition.toplist.awaiting')}</p>}
          <span aria-live="polite" className="sr-only">{list.started && list.rows[0] ? `${t('competition.toplist.totals')}: ${list.rows[0].teamName}` : ''}</span>
          <section aria-label={t('competition.toplist.totals')} className="tl-totals">
            <ol ref={totalsRef} className="tl-list">
              {list.rows.map((row, index) => {
                const note = toplistNoteText(row, t);
                const tone = toplistNoteTone(row);
                const lastInRunoff = row.runoff && list.rows[index + 1]?.runoff;
                const openRow = open(row.teamId);
                const fav = isFav(row.teamId);
                const ranked = isRanked(row.teamId, row.points);
                // A tie is only between teams with a place: unscored teams share nothing, they just have no place yet.
                const tied = ranked && list.rows.some((other) => other !== row && other.position === row.position && isRanked(other.teamId, other.points));
                const content = <>
                  <Place ranked={ranked} still={still}>{ranked ? row.position : <span aria-hidden="true">—</span>}<span className="sr-only">{ranked ? (tied ? <>{' '}{t('competition.toplist.joint')}</> : '') : t('competition.toplist.noPlace')}</span></Place>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5">
                    <span data-grow="start" className="tl-name">{renderTeamName(row.teamId, row.teamName, fav, false)}</span>
                    {note && <span className={`tl-note ${tone ? NOTE_TONE[tone] : 'text-[rgb(var(--mg-body))]'}`}>{note}</span>}
                  </span>
                  <span data-grow="end" className="flex shrink-0 flex-col items-end gap-0.5">
                    <ScoreFlash value={row.points} className={`tl-points${ranked ? '' : ' tl-points-none'}`}><TickerNumber value={row.points} /><span className="sr-only">{' '}{t('competition.toplist.points')}</span></ScoreFlash>
                  </span>
                </>;
                return (
                  <Fragment key={row.teamId}>
                    <motion.li
                      layout="position"
                      transition={RESORT}
                      data-rank-id={row.teamId}
                      data-followed={fav ? 'true' : undefined}
                      data-tied={tied ? 'true' : undefined}
                      className={`tl-row${lastInRunoff ? ' tl-runoff-end' : ''}${fav ? ' tl-fav' : ''}${tied ? ' tl-tied' : ''}`}
                    >
                      <RowBox open={openRow} href={teamHref(row.teamId)}>{content}</RowBox>
                      <FollowGlimmer on={fav} />
                    </motion.li>
                    {!finished && list.cutAfter === index && index < list.rows.length - 1 && (
                      <motion.li layout="position" transition={RESORT} role="separator" aria-label={t('competition.toplist.cutoff')} className={separatorLabel}>
                        <span className="tl-cut-label">{t('competition.toplist.cutoff')}</span><span aria-hidden="true" className="tl-cut-line" />
                      </motion.li>
                    )}
                  </Fragment>
                );
              })}
            </ol>
            {list.hc.length > 0 && <>
              <h3 className="tl-sub-heading">Hors concours</h3>
              <ul className="tl-list">
                {list.hc.map((team) => {
                  const fav = isFav(team.teamId);
                  return (
                    <li key={team.teamId} data-followed={fav ? 'true' : undefined} className={`tl-row tl-hc${fav ? ' tl-fav' : ''}`}>
                      <RowBox href={teamHref(team.teamId)}>
                        <span className="tl-place tl-faint">HC</span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
                          <span className="tl-name">{renderTeamName(team.teamId, team.teamName, fav, false)}</span>
                        </span>
                        <span className="tl-points tl-muted">{formatPoints(team.points)}<span className="sr-only">{' '}{t('competition.toplist.points')}</span></span>
                      </RowBox>
                    </li>
                  );
                })}
              </ul>
            </>}
          </section>
        </>}

        {view === 'sessions' && (
          <section aria-label={t('competition.toplist.sessionPoints')} className="tl-table">
            <table className="w-full table-fixed border-collapse">
              <thead>
                <tr className="tl-thead">
                  <th scope="col" className="w-9 py-2 text-left">#</th>
                  <th scope="col" className="py-2 text-left">{t('competition.toplist.team')}</th>
                  {/* Session columns share what the team names leave (at least 110px), so the card never scrolls sideways. */}
                  {list.bySession.sessions.map((s) => <th key={s.id} scope="col" style={{ width: sessionWidth }} className="py-2 text-center"><abbr title={sessionColumnTitle(s.title, t)} className="no-underline">{s.label}</abbr></th>)}
                  <th scope="col" className="w-11 py-2 pr-1 text-right text-[rgb(var(--mg-heading))]">{t('competition.toplist.pts')}</th>
                </tr>
              </thead>
              <tbody ref={sessionsRef}>
                {list.rows.map((row) => {
                  const cells = list.bySession.cells.get(row.teamId);
                  const openRow = open(row.teamId);
                  const fav = isFav(row.teamId);
                  return (
                    <motion.tr key={row.teamId} layout="position" transition={RESORT} data-rank-id={row.teamId} data-followed={fav ? 'true' : undefined} className={`tl-tr${fav ? ' tl-fav-tr' : ''}`}>
                      <td className={`mg-display h-12 py-0 text-base font-bold${isRanked(row.teamId, row.points) ? '' : ' text-[rgb(var(--mg-dash))]'}`}>{isRanked(row.teamId, row.points) ? row.position : '—'}</td>
                      <th scope="row" className="min-w-0 break-words py-1.5 pr-2 text-left text-[15px] font-semibold leading-[1.3]">
                        {openRow
                          ? <button type="button" onClick={openRow} aria-haspopup="dialog" className="block min-h-11 w-full text-left font-semibold after:absolute after:inset-0">{renderTeamName(row.teamId, row.teamName, fav, false)}</button>
                          : teamHref(row.teamId)
                            ? <Link to={teamHref(row.teamId)!} className="after:absolute after:inset-0 hover:underline">{renderTeamName(row.teamId, row.teamName, fav, false)}</Link>
                            : renderTeamName(row.teamId, row.teamName, fav, false)}
                      </th>
                      {list.bySession.sessions.map((s, i) => (
                        <td key={s.id} className={`mg-display text-center font-semibold tabular-nums ${manySessions ? 'text-sm' : 'text-base'}`}>
                          {cells ? formatPoints(cells[i]) : <><span aria-hidden="true" className="text-[rgb(var(--mg-dash))]">–</span><span className="sr-only">{t('competition.toplist.noPoints')}</span></>}
                        </td>
                      ))}
                      <td className="mg-display pr-1 text-right text-xl font-bold tabular-nums text-[rgb(var(--mg-heading))]"><span data-grow="end"><ScoreFlash value={row.points}><TickerNumber value={row.points} /></ScoreFlash></span></td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {view === 'heats' && heatTables}

        {view === 'lineups' && finalLineups && (
          <section aria-label={t('competition.toplist.finals')} className="tl-finals">
            {finalLineups.map((lineup) => (
              <Fragment key={lineup.id}>
                <h3 className="fl-heading fl-ruled">{lineup.label}</h3>
                <ul aria-label={lineup.label} className="tl-list">
                  {lineup.teams.map((team) => {
                    const fav = isFav(team.teamId);
                    return (
                      <li key={team.teamId} data-followed={fav ? 'true' : undefined} className={`tl-row${fav ? ' tl-fav' : ''}`}>
                        <RowBox open={open(team.teamId)} href={teamHref(team.teamId)}>
                          <span className="tl-name min-w-0 flex-1 py-1.5">{renderTeamName(team.teamId, team.teamName, fav, false)}</span>
                        </RowBox>
                        <FollowGlimmer on={fav} />
                      </li>
                    );
                  })}
                </ul>
              </Fragment>
            ))}
          </section>
        )}

        {view === 'times' && times && <TimesList rows={times} competitionId={competitionId} inRouter={inRouter} t={t} />}

        {list.runoff && view === 'totals' && (
          <section aria-labelledby="runoff-title" className="tl-runoff">
            <div className="flex items-baseline gap-2.5">
              <h2 id="runoff-title" className="fl-heading !m-0 flex-1">{t('competition.toplist.runoffFor', { place: ordinalText(list.runoff.place, lang) })}</h2>
              <span className="tl-note text-[rgb(var(--mg-muted))]">{t('competition.toplist.pending')}</span>
            </div>
            <p className="tl-lead">
              {[section?.runoffRaceName?.trim() || t('competition.toplist.runoffRace'), list.sessionsDone < list.sessionsTotal ? t('competition.toplist.runoffAfter', { n: list.sessionsTotal }) : t('competition.toplist.runoffToRun')].join(' · ')}
            </p>
            <ol className="tl-list">
              {list.runoff.teams.map((row, i) => (
                <li key={row.teamId} className="tl-row gap-3 pr-1">
                  <span className="mg-display w-12 shrink-0 text-base font-bold text-[rgb(var(--mg-muted))]">{t('competition.toplist.lane', { n: i + 1 })}</span>
                  <span className="tl-name min-w-0 flex-1">{renderTeamName(row.teamId, row.teamName, isFav(row.teamId), true)}</span>
                  <span className="shrink-0 text-sm font-semibold text-[rgb(var(--mg-body))]">{t('competition.toplist.ptsValue', { points: formatPoints(row.points) })}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        </div>
      </div>
      {sheet && (
        <TeamSheet
          detail={sheet}
          sectionName={section?.displayName ?? null}
          competitionId={competitionId ?? undefined}
          team={teams?.find((t) => t.id === sheet.teamId) ?? null}
          riders={sheetRiders}
          onClose={() => setOpenTeam(null)}
        />
      )}
      {showOpen && (
        <Sheet title={t('competition.toplist.show')} onClose={() => setShowOpen(false)}>
          {({ close }) => (
            <div role="radiogroup" aria-label={t('competition.toplist.show')} className="-mx-5 flex flex-col">
              {tabs.map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={id === view}
                  onClick={() => close(() => { setShowOpen(false); setChosen(id); })}
                  className={`flex min-h-[52px] w-full items-center gap-3 border-t border-[rgb(var(--mg-rule-soft))] px-5 text-left text-[17px] font-medium text-[rgb(var(--mg-ink))] ${id === view ? 'bg-[rgb(var(--mg-tint))]' : ''}`}>
                  <span className="min-w-0 flex-1">{label}</span>
                  {id === view && <Check aria-hidden="true" className="h-5 w-5 shrink-0 text-[rgb(var(--mg-heading))]" strokeWidth={2.5} />}
                </button>
              ))}
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}

/** The place, or a quiet dash before the team has a result. The first number to arrive fades in rather than snapping. */
function Place({ ranked, still, children }: { ranked: boolean; still: boolean; children: ReactNode }) {
  // Remembers whether the place has just arrived, so the fade plays once (the same pattern as the view fade above).
  const [seen, setSeen] = useState({ ranked, arrived: false });
  if (seen.ranked !== ranked) setSeen({ ranked, arrived: ranked });
  const arrived = seen.ranked !== ranked ? ranked : seen.arrived;
  return <span className={`tl-place${ranked ? '' : ' tl-place-none'}${arrived && !still ? ' tl-place-in' : ''}`}>{children}</span>;
}

/** The gold star after a followed team's name. It stays mounted so following a team plays the pop and sparks. */
function NameStar({ on }: { on: boolean }) {
  return <span aria-hidden="true" className={`ml-1 inline-flex align-[-2px] text-[#C08308] ${on ? '' : 'hidden'}`}><FollowStar on={on} className="h-3.5 w-3.5" /></span>;
}

/**
 * A soft light sweep across a followed team's row, once each time the row comes into view: when the page opens, when you
 * scroll to it, and the moment you follow a team whose row is showing.
 */
function FollowGlimmer({ on }: { on: boolean }) {
  const still = useStillMotion();
  const anchor = useRef<HTMLSpanElement>(null);
  const [plays, setPlays] = useState(0);
  useEffect(() => {
    const row = anchor.current?.parentElement;
    if (!on || still || !row || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setPlays((n) => n + 1);
      observer.disconnect();
    }, { threshold: 0.6 });
    observer.observe(row);
    return () => observer.disconnect();
  }, [on, still]);
  return (
    <>
      <span ref={anchor} aria-hidden="true" hidden />
      {on && !still && plays > 0 && <span key={plays} aria-hidden="true" className="mg-follow-glimmer" />}
    </>
  );
}

/**
 * One team's row: a link to its team page inside the app, a button opening its breakdown when the list stands alone,
 * or plain text. The whole box is the target.
 */
function RowBox({ open, href, children }: { open?: () => void; href: string | null; children: ReactNode }) {
  const box = 'tl-box';
  if (open) return <button type="button" onClick={open} aria-haspopup="dialog" className={box}>{children}</button>;
  if (href) return <Link to={href} className={box}>{children}</Link>;
  return <div className={box}>{children}</div>;
}

function FinalsList({ groups, t, lang, onOpen, teamHref, isFav, renderTeamName }: {
  groups: FinalGroup[];
  t: Translate;
  lang: Lang;
  onOpen: (teamId: number) => (() => void) | undefined;
  teamHref: (teamId: number) => string | null;
  isFav: (teamId: number) => boolean;
  renderTeamName: (teamId: number, teamName: string, fav: boolean, asLink?: boolean) => React.ReactNode;
}) {
  return (
    <section aria-label={t('competition.toplist.finalResults')} className="tl-finals">
      {groups.map((group) => (
        <Fragment key={group.id}>
          <h3 className="fl-heading fl-ruled">{group.label}</h3>
          <ol aria-label={group.label} className="tl-list">
            {group.rows.map((row) => {
              const openRow = onOpen(row.teamId);
              const winner = row.place === 1;
              // Once the final is over its winners are champions: a gold row, a rosette and a shine across it.
              const champion = winner && group.complete === true;
              const fav = isFav(row.teamId);
              // Teams sharing a real place in this final show the same place on the tie band; no "=" sign, just "(joint)" read aloud.
              const tied = row.place != null && group.rows.some((other) => other !== row && other.place === row.place);
              return (
                <li key={row.teamId} data-followed={fav ? 'true' : undefined} data-tied={tied ? 'true' : undefined} className={`tl-row${champion ? ' mg-champion tl-bleed' : `${fav ? ' tl-fav' : ''}${tied ? ' tl-tied' : ''}`}`}>
                  <RowBox open={openRow} href={teamHref(row.teamId)}>
                    <span className={`tl-place tl-ordinal${winner ? ' text-[rgb(var(--mg-late-time))]' : ''}`}>{row.place != null ? ordinalText(row.place, lang) : <span aria-hidden="true">–</span>}{tied && <span className="sr-only">{' '}{t('competition.toplist.joint')}</span>}</span>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="tl-name">{renderTeamName(row.teamId, row.teamName, fav, false)}</span>
                      {winner && <Trophy aria-label={t('competition.toplist.winner')} role="img" className="h-[13px] w-[13px] shrink-0 text-[rgb(var(--mg-late-time))]" />}
                      {champion && <span className="mg-champion-label">{t('competition.toplist.champions')}</span>}
                    </span>
                    {champion && <span className="mg-champion-rosette"><Rosette width={26} /></span>}
                    <span className="tl-points">{row.points != null ? formatPoints(row.points) : '–'}<span className="sr-only">{' '}{t('competition.toplist.points')}</span></span>
                  </RowBox>
                  <FollowGlimmer on={fav} />
                </li>
              );
            })}
          </ol>
        </Fragment>
      ))}
    </section>
  );
}

/**
 * The age group's planned start times, heat by heat, under each session's name. These are the times on the draw, not a
 * race clock: a heat with no planned time shows a dash. Each row opens that heat.
 */
function TimesList({ rows, competitionId, inRouter, t }: { rows: TimetableRow[]; competitionId: number | null; inRouter: boolean; t: Translate }) {
  // Consecutive rows from the same session share one heading.
  const groups: { key: string; name: string; rows: TimetableRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.rows[0].session.id === row.session.id) last.rows.push(row);
    else groups.push({ key: row.key, name: row.session.name, rows: [row] });
  }
  return (
    <section aria-label={t('competition.toplist.times')} className="tl-finals">
      {groups.map((group) => (
        <Fragment key={group.key}>
          <h3 className="fl-heading fl-ruled">{group.name}</h3>
          <ol aria-label={group.name} className="tl-list">
            {group.rows.map((row) => {
              const name = row.heat ? row.heat.label || t('competition.timetable.heat', { n: row.heatIndex + 1 }) : row.session.name;
              const href = inRouter && competitionId != null ? `/competitions/${competitionId}/session/${row.session.id}${row.heat ? `?heat=${row.heat.id}` : ''}` : null;
              return (
                <li key={row.key} className="tl-row">
                  <RowBox href={href}>
                    <span className="tl-time">{row.scheduled ? formatTime(row.scheduled) : <span aria-hidden="true" className="tl-faint">–</span>}</span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5">
                      <span className="tl-name">{name}</span>
                      {row.session.arenaName && <span className="tl-note text-[rgb(var(--mg-muted))]">{row.session.arenaName}</span>}
                    </span>
                  </RowBox>
                </li>
              );
            })}
          </ol>
        </Fragment>
      ))}
    </section>
  );
}

/** The declared riders and ponies of the team whose sheet is open (the same public dec form the team page reads). */
function useSheetRiders(competitionId: number | null, teamId: number | null): TeamSheetRider[] {
  const [loaded, setLoaded] = useState<{ key: string; riders: TeamSheetRider[] } | null>(null);
  const key = competitionId != null && teamId != null ? `${competitionId}:${teamId}` : null;
  useEffect(() => {
    if (key == null || competitionId == null || teamId == null) return;
    let cancelled = false;
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId, teamId } })
      .then((r) => {
        if (cancelled) return;
        const form = (Array.isArray(r.data) ? r.data : []).find((f) => f.teamId === teamId);
        const riders = (form?.riders ?? [])
          .filter((rider) => !(rider.isReserve && !rider.horseName))
          .slice()
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((rider) => ({ fullName: publicRiderName(rider), horseName: rider.horseName, isReserve: rider.isReserve }));
        setLoaded({ key, riders });
      })
      .catch(() => { if (!cancelled) setLoaded({ key, riders: [] }); });
    return () => { cancelled = true; };
  }, [key, competitionId, teamId]);
  return loaded?.key === key ? loaded.riders : [];
}
