import { Fragment, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { Check, Star, Trophy } from 'lucide-react';
import { motion } from 'framer-motion';
import type { CompetitionSection, Team } from '../../types';
import type { FinalGroup, Toplist } from '../../lib/toplist';
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
import { Rosette } from '../../components/Rosette';
import { ScoreFlash } from '../../components/ScoreFlash';
import { TickerNumber } from '../../components/TickerNumber';
import { useRankMotion } from '../../hooks/useRankMotion';
import { EASE_OUT } from '../../lib/motion';
import type { Lang, Translate } from '../../i18n/translate';

// When a result moves teams, their rows slide to the new places rather than jumping.
const RESORT = { layout: { duration: 0.5, ease: EASE_OUT } };
import { formatPoints } from '../../lib/formatPoints';


export type ToplistViewTab = 'finals' | 'totals' | 'sessions' | 'heats';
type View = ToplistViewTab;

const separatorLabel = 'flex items-center gap-2 border-b border-[rgb(var(--mg-rule-soft))] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[rgb(var(--mg-red))]';
const dashes = <span aria-hidden="true" className="flex-1 border-t-2 border-dashed border-current" />;
// Tied teams share a number and a soft tint, nothing more.
const TIED = { background: 'rgb(var(--mg-heading) / .07)' };
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
}: {
  list: Toplist;
  section: CompetitionSection | null;
  competitionId?: number;
  teams?: Team[];
  chosenView?: View | null;
  onChooseView?: (view: View) => void;
  /** The age group's heat tables, offered as "Heats" in the Show row. */
  heatTables?: ReactNode;
}) {
  const { t, lang } = useLanguage();
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
  const hasFinals = list.finals.length > 0;
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
  const tabs: [View, string][] = [
    ['totals', t('competition.toplist.totals')],
    ...(hasSessions ? ([['sessions', t('competition.toplist.bySession')]] as [View, string][]) : []),
    ...(hasFinals ? ([['finals', t('competition.toplist.finals')]] as [View, string][]) : []),
    ...(heatTables ? ([['heats', t('competition.toplist.scoresByHeat')]] as [View, string][]) : []),
  ];
  const view: View = tabs.some(([id]) => id === chosen) ? chosen! : hasFinals ? 'finals' : 'totals';
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
    <DropdownRow label={t('competition.toplist.show')} value={view} options={tabs.map(([value, label]) => ({ value, label }))} onChange={(next) => setChosen(next as View)} />
  );

  return (
    <>
      <div className="flex flex-col gap-3 pt-3">
        {viewRow}
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
          {places != null && places > 0 && <p className="text-sm font-medium leading-snug text-[rgb(var(--mg-body))]">{t('competition.toplist.topMake', { places })}</p>}
          <section aria-label={t('competition.toplist.totals')} className="mg-card overflow-hidden">
            <ol ref={totalsRef}>
              {list.rows.map((row, index) => {
                const note = toplistNoteText(row, t);
                const tone = toplistNoteTone(row);
                const lastInRunoff = row.runoff && list.rows[index + 1]?.runoff;
                const openRow = open(row.teamId);
                const fav = isFav(row.teamId);
                const tied = list.started && row.joint;
                const content = <>
                  <span className="mg-display w-7 shrink-0 text-xl font-bold leading-none">{list.started ? row.position : '—'}<span className="sr-only">{list.started && row.joint ? <>{' '}{t('competition.toplist.joint')}</> : ''}</span></span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
                    <span data-grow="start" className="truncate text-base font-semibold leading-tight">{renderTeamName(row.teamId, row.teamName, fav, false)}</span>
                    {note && <span className={`text-[13.5px] font-medium leading-none ${tone ? NOTE_TONE[tone] : 'text-[rgb(var(--mg-body))]'}`}>{note}</span>}
                  </span>
                  <span data-grow="end" className="flex shrink-0 flex-col items-end gap-0.5">
                    <ScoreFlash value={row.points} className="mg-display text-xl font-bold leading-none tabular-nums text-[rgb(var(--mg-heading))]"><TickerNumber value={row.points} /><span className="sr-only">{' '}{t('competition.toplist.points')}</span></ScoreFlash>
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
                      style={tied ? TIED : undefined}
                      className={`flex min-h-11 items-center pr-1 ${lastInRunoff ? 'border-b border-dashed border-[rgb(var(--mg-rule))]' : 'border-b border-[rgb(var(--mg-rule-soft))]'} ${fav ? 'bg-[rgb(var(--mg-tint))] shadow-[inset_3px_0_0_#C08308]' : ''}`}
                    >
                      <RowBox open={openRow} href={teamHref(row.teamId)}>{content}</RowBox>
                    </motion.li>
                    {list.cutAfter === index && index < list.rows.length - 1 && (
                      <motion.li layout="position" transition={RESORT} role="separator" aria-label={t('competition.toplist.cutoff')} className={`${separatorLabel} !py-1.5`}>
                        {dashes}{t('competition.toplist.cutoff')}{dashes}
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
                    <li key={team.teamId} data-followed={fav ? 'true' : undefined} className={`flex min-h-11 items-center border-b border-[rgb(var(--mg-rule-soft))] pr-1 text-[rgb(var(--mg-muted))] last:border-b-0 ${fav ? 'bg-[rgb(var(--mg-tint))] shadow-[inset_3px_0_0_#C08308]' : ''}`}>
                      <RowBox href={teamHref(team.teamId)}>
                        <span className="mg-display w-7 shrink-0 text-xl font-bold leading-none text-[rgb(var(--mg-faint))]">HC</span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
                          <span className="truncate text-base font-semibold leading-tight">{renderTeamName(team.teamId, team.teamName, fav, false)}</span>
                        </span>
                        <span className="mg-display shrink-0 text-xl font-bold leading-none tabular-nums">{formatPoints(team.points)}<span className="sr-only">{' '}{t('competition.toplist.points')}</span></span>
                      </RowBox>
                    </li>
                  );
                })}
              </ul>
            </>}
          </section>
        </>}

        {view === 'sessions' && (
          <section aria-label={t('competition.toplist.sessionPoints')} className="mg-card overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="mg-display border-b border-[rgb(var(--mg-rule))] text-xs font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-muted))]">
                  <th scope="col" className="w-9 py-1.5 pl-3 text-left font-bold">#</th>
                  <th scope="col" className="py-1.5 text-left font-bold">{t('competition.toplist.team')}</th>
                  {list.bySession.sessions.map((s) => <th key={s.id} scope="col" className="w-9 py-1.5 text-center font-bold"><abbr title={sessionColumnTitle(s.title, t)} className="no-underline">{s.label}</abbr></th>)}
                  <th scope="col" className="w-11 py-1.5 pr-3 text-right font-bold text-[rgb(var(--mg-heading))]">{t('competition.toplist.pts')}</th>
                </tr>
              </thead>
              <tbody ref={sessionsRef}>
                {list.rows.map((row) => {
                  const cells = list.bySession.cells.get(row.teamId);
                  const openRow = open(row.teamId);
                  const fav = isFav(row.teamId);
                  return (
                    <motion.tr key={row.teamId} layout="position" transition={RESORT} data-rank-id={row.teamId} data-followed={fav ? 'true' : undefined} className={`relative border-b border-[rgb(var(--mg-rule-soft))] last:border-b-0 ${fav ? 'bg-[rgb(var(--mg-tint))] shadow-[inset_3px_0_0_#C08308]' : ''}`}>
                      <td className="mg-display h-11 py-0 pl-3 text-base font-bold">{list.started ? row.position : '—'}</td>
                      <th scope="row" className="min-w-0 py-0 pr-2 text-left text-[15px] font-semibold leading-tight">
                        {openRow
                          ? <button type="button" onClick={openRow} aria-haspopup="dialog" className="block min-h-11 w-full text-left font-semibold after:absolute after:inset-0">{renderTeamName(row.teamId, row.teamName, fav, false)}</button>
                          : teamHref(row.teamId)
                            ? <Link to={teamHref(row.teamId)!} className="after:absolute after:inset-0 hover:underline">{renderTeamName(row.teamId, row.teamName, fav, false)}</Link>
                            : renderTeamName(row.teamId, row.teamName, fav, false)}
                      </th>
                      {list.bySession.sessions.map((s, i) => (
                        <td key={s.id} className="mg-display text-center text-base font-semibold tabular-nums">
                          {cells ? formatPoints(cells[i]) : <><span aria-hidden="true" className="text-[rgb(var(--mg-dash))]">–</span><span className="sr-only">{t('competition.toplist.noPoints')}</span></>}
                        </td>
                      ))}
                      <td className="mg-display pr-3 text-right text-xl font-bold tabular-nums text-[rgb(var(--mg-heading))]"><span data-grow="end"><ScoreFlash value={row.points}><TickerNumber value={row.points} /></ScoreFlash></span></td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {view === 'heats' && heatTables}

        {list.runoff && view === 'totals' && (
          <section aria-labelledby="runoff-title" className="mg-card flex flex-col gap-3 p-3.5">
            <div className="flex items-baseline gap-2.5">
              <h2 id="runoff-title" className="mg-h2 flex-1">{t('competition.toplist.runoffFor', { place: ordinalText(list.runoff.place, lang) })}</h2>
              <span className="text-xs font-semibold text-[rgb(var(--mg-muted))]">{t('competition.toplist.pending')}</span>
            </div>
            <p className="text-sm font-medium leading-snug text-[rgb(var(--mg-body))]">
              {[section?.runoffRaceName?.trim() || t('competition.toplist.runoffRace'), list.sessionsDone < list.sessionsTotal ? t('competition.toplist.runoffAfter', { n: list.sessionsTotal }) : t('competition.toplist.runoffToRun')].join(' · ')}
            </p>
            <ol className="overflow-hidden rounded-[10px] border border-[rgb(var(--mg-rule-soft))]">
              {list.runoff.teams.map((row, i) => (
                <li key={row.teamId} className="flex min-h-12 items-center gap-3 border-b border-[rgb(var(--mg-rule-soft))] px-3 last:border-b-0">
                  <span className="mg-display w-12 shrink-0 text-base font-bold text-[rgb(var(--mg-muted))]">{t('competition.toplist.lane', { n: i + 1 })}</span>
                  <span className="min-w-0 flex-1 truncate text-base font-semibold">{renderTeamName(row.teamId, row.teamName, isFav(row.teamId), true)}</span>
                  <span className="shrink-0 text-sm font-semibold text-[rgb(var(--mg-body))]">{t('competition.toplist.ptsValue', { points: formatPoints(row.points) })}</span>
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

/**
 * One team's row: a link to its team page inside the app, a button opening its breakdown when the list stands alone,
 * or plain text. The whole box is the target.
 */
function RowBox({ open, href, children }: { open?: () => void; href: string | null; children: ReactNode }) {
  const box = 'flex min-h-11 min-w-0 flex-1 items-center gap-2.5 pl-3 pr-1 text-left';
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
    <section aria-label={t('competition.toplist.finals')} className="mg-card overflow-hidden">
      {groups.map((group, index) => (
        <Fragment key={group.id}>
          <h3 className={`${separatorLabel} ${index > 0 ? 'border-t' : ''}`}>{dashes}{group.label}{dashes}</h3>
          <ol aria-label={group.label}>
            {group.rows.map((row) => {
              const openRow = onOpen(row.teamId);
              const winner = row.place === 1;
              // Once the final is over its winners are champions: a gold row, a rosette and a shine across it.
              const champion = winner && group.complete === true;
              const fav = isFav(row.teamId);
              return (
                <li key={row.teamId} data-followed={fav ? 'true' : undefined} className={`flex min-h-11 items-center pr-1 border-b border-[rgb(var(--mg-rule-soft))] last:border-b-0 ${champion ? 'mg-champion' : fav ? 'bg-[rgb(var(--mg-tint))] shadow-[inset_3px_0_0_#C08308]' : ''}`}>
                  <RowBox open={openRow} href={teamHref(row.teamId)}>
                    <span className={`mg-display w-9 shrink-0 text-lg font-bold leading-none ${winner ? 'text-[rgb(var(--mg-late-time))]' : ''}`}>{row.place != null ? ordinalText(row.place, lang) : <span aria-hidden="true">–</span>}</span>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="truncate text-base font-semibold leading-tight">{renderTeamName(row.teamId, row.teamName, fav, false)}</span>
                      {winner && <Trophy aria-label={t('competition.toplist.winner')} role="img" className="h-[13px] w-[13px] shrink-0 text-[rgb(var(--mg-late-time))]" />}
                      {champion && <span className="mg-champion-label">{t('competition.toplist.champions')}</span>}
                    </span>
                    {champion && <span className="mg-champion-rosette"><Rosette width={26} /></span>}
                    <span className="mg-display shrink-0 text-xl font-bold leading-none tabular-nums text-[rgb(var(--mg-heading))]">{row.points != null ? formatPoints(row.points) : '–'}<span className="sr-only">{' '}{t('competition.toplist.points')}</span></span>
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
