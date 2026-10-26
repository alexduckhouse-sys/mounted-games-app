import { useState } from 'react';
import { CardDropdownRow } from '../../components/CardDropdownRow';
import { usePageWidth } from '../../components/pageWidthState';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { RoundSearch } from '../../components/RoundSearch';
import { ChevronRight } from 'lucide-react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { StatsGamesView } from '../../components/stats/StatsGamesView';
import { StatsSummaryView } from '../../components/stats/StatsSummaryView';
import { useStatsBrowse, useStatsProfile, type StatsBrowseLoad } from '../../hooks/useStats';
import {
  STATS_KIND_LABELS, STATS_MAX_QUERY, STATS_PATHS, STATS_TABS, finalLabel, formatPercent, isSearchableQuery, ordinalPlace, plural,
  pointsOf, statsKindFromPath, statsProfileHref, tidyStatsQuery,
} from '../../lib/stats';
import { SectionFormatLabel, StatsSubjectKind, type StatsEntry, type StatsHit, type StatsProfile } from '../../types';
import { Chevron, RefineDisclosure, RefineHeader, RefineList, RefineNote, RefinePage, RefineSection } from '../refine/Refine';
import { formatPoints } from '../../lib/formatPoints';
import '../../components/sitePages.css';

/** `/stats` browses and searches; `/stats/:kind?name=` shows one rider, pony, team or club. */
export function StatsPage() {
  const { kind: segment } = useParams();
  if (segment === undefined) return <StatsBrowseView />;
  return <StatsProfileRoute segment={segment} />;
}

function StatsBrowseView() {
  usePageWidth('wide');
  usePageHeader({ title: 'Rider and team stats', plain: true });
  const [params, setParams] = useSearchParams();
  const kind = statsKindFromPath(params.get('kind') ?? undefined) ?? StatsSubjectKind.Rider;
  const [text, setText] = useState(() => params.get('q') ?? '');
  const tab = STATS_TABS.find((entry) => entry.kind === kind) ?? STATS_TABS[0];
  const list = useStatsBrowse(kind, text);

  // Keep the tab and words in the address, so going back from a profile returns to the same list.
  function remember(nextKind: StatsSubjectKind, nextText: string) {
    const next = new URLSearchParams();
    if (nextKind !== StatsSubjectKind.Rider) next.set('kind', STATS_PATHS[nextKind]);
    if (nextText.trim()) next.set('q', nextText);
    setParams(next, { replace: true });
  }

  const kindOptions = STATS_TABS.map((entry) => ({ value: String(entry.kind), label: entry.label }));
  return <RefinePage wide>
    <h1 className="sr-only">Rider and team stats</h1>
    <div className="mg-band mg-band-header sp-top pb-3 pt-0">
      <RoundSearch band label={`Search ${tab.plural}`} placeholder={`Name of a ${STATS_KIND_LABELS[kind].toLowerCase()}`} value={text} maxLength={STATS_MAX_QUERY}
        onChange={(next) => { setText(next); remember(kind, next); }} />
    </div>
    <div className="sp-card sp-gap">
      <CardDropdownRow label="Show" value={String(kind)} options={kindOptions} onChange={(value) => remember(Number(value) as StatsSubjectKind, text)} />
    </div>
    <div>
      {text.trim().length === 1 && <RefineNote>Type at least two letters to narrow the list.</RefineNote>}
      {list.status === 'loading' && <p role="status" className="rf-note">Loading…</p>}
      {list.status === 'error' && <div role="alert" className="mg-notice mt-3">{list.message}</div>}
      {list.status === 'ready' && <BrowseResults list={list} plural={tab.plural} label={tab.label} words={isSearchableQuery(text) ? tidyStatsQuery(text) : ''} />}
    </div>
  </RefinePage>;
}

function BrowseResults({ list, plural: noun, label, words }: { list: Extract<StatsBrowseLoad, { status: 'ready' }>; plural: string; label: string; words: string }) {
  if (list.items.length === 0) return <div className="py-6 text-[rgb(var(--mg-muted))]" role="status">
    <h2 className="m-0 mb-1 font-['Barlow_Condensed',sans-serif] text-xl font-bold text-[rgb(var(--mg-heading))]">{words ? 'No matches' : 'No finished events yet'}</h2>
    <p className="m-0">{words
      ? `No ${noun} in a finished competition match “${words}”. Check the spelling or try part of the name.`
      : 'Statistics appear here once a competition has finished and its races have been scored.'}</p>
  </div>;
  const remaining = list.total - list.items.length;
  return <>
    <ul className="sp-card sp-gap m-0 list-none p-0" aria-label={label}>{list.items.map((hit) => <HitRow key={hit.key} hit={hit} />)}</ul>
    {list.moreError && <div role="alert" className="mg-notice mt-3">{list.moreError}</div>}
    {remaining > 0 && <button type="button" className="rf-btn rf-wide mt-3" disabled={list.loadingMore} onClick={list.loadMore}>
      {list.loadingMore ? 'Loading…' : `Show more (${remaining} left)`}
    </button>}
    <RefineNote>Only finished competitions count. Riders who asked to be shown by their surname initial appear that way here too.</RefineNote>
  </>;
}

function HitRow({ hit }: { hit: StatsHit }) {
  return <li><Link to={statsProfileHref(hit.kind, hit.key)} className="sp-row">
    <span className="sp-t1 sp-big sp-grow">{hit.name}</span>
    <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
  </Link></li>;
}

function StatsProfileRoute({ segment }: { segment: string }) {
  const kind = statsKindFromPath(segment);
  const [params] = useSearchParams();
  const name = params.get('name') ?? '';
  const { user } = useAuth();
  const valid = kind !== null && isSearchableQuery(name);
  const load = useStatsProfile(valid ? `/stats/${STATS_PATHS[kind]}?name=${encodeURIComponent(name)}` : null, user?.id ?? 'public');
  const label = kind === null ? 'Stats' : `${STATS_KIND_LABELS[kind]} stats`;
  const back = <RefineHeader back={kind === null ? '/stats' : `/stats?kind=${STATS_PATHS[kind]}`} backLabel="Back to the list" context={label} title={load.status === 'ready' ? load.data.name : name || 'Not found'} />;

  if (!valid || load.status === 'missing') return <RefinePage>{back}
    <div className="py-6 text-[rgb(var(--mg-muted))]"><h2 className="m-0 mb-1 font-['Barlow_Condensed',sans-serif] text-xl font-bold text-[rgb(var(--mg-heading))]">No statistics found</h2>
      <p className="m-0">There are no finished competitions under this name. <Link to="/stats" className="font-semibold text-[rgb(var(--mg-heading))]">Browse the list</Link></p></div>
  </RefinePage>;
  if (load.status === 'error') return <RefinePage>{back}<div role="alert" className="mg-notice mt-3">{load.message}</div></RefinePage>;
  if (load.status !== 'ready') return <RefinePage>{back}<p role="status" className="rf-note">Loading statistics…</p></RefinePage>;
  return <RefinePage>{back}<ProfileBody profile={load.data} /></RefinePage>;
}

const PARTNER_TITLES: Record<StatsSubjectKind, string> = { 0: 'Ponies ridden', 1: 'Riders', 2: 'Riders and ponies', 3: 'Riders and ponies' };

/** The profile itself, shared with nothing else: summary for everyone, then the detail a signed-in viewer gets. */
function ProfileBody({ profile }: { profile: StatsProfile }) {
  const location = useLocation();
  const { summary } = profile;
  // A team's per-game figures are public; the API leaves them out for riders and ponies until you sign in.
  const games = profile.detailed || profile.games != null ? <>
    <RefineSection title={profile.raceFiguresAllFormats ? 'Games' : 'Games in individual and pairs'} meta={profile.games?.length ?? 0} />
    <StatsGamesView games={profile.games ?? []} best={profile.bestGames ?? []} worst={profile.worstGames ?? []}
      emptyText={profile.raceFiguresAllFormats ? 'No races to show yet.' : 'No individual or pairs races yet. Team competitions are listed below.'} />
  </> : null;
  return <>
    <StatsSummaryView summary={summary} raceFiguresAllFormats={profile.raceFiguresAllFormats} />
    {!profile.detailed ? <>
      {games}
      <div className="mt-3 rounded-[10px] border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-subtle))] p-3">
        <p className="m-0 text-sm">{games ? 'Sign in to see every competition and the rider and pony partnerships.' : 'Sign in to see each game, every competition and the rider and pony partnerships.'}</p>
        <Link to="/login" state={{ from: location.pathname + location.search }} className="rf-btn rf-btn-primary mt-2">Sign in</Link>
      </div>
    </> : <>
      {games}
      <RefineSection title="Competitions" meta={profile.entries?.length ?? 0} />
      {profile.entries?.length ? <RefineList as="div" label="Competitions">{profile.entries.map((entry) => <EntryRow key={`${entry.teamId}`} entry={entry} />)}</RefineList>
        : <RefineNote>No finished competitions yet.</RefineNote>}
      {profile.seasons?.length ? <>
        <RefineSection title="Seasons" meta={profile.seasons.length} />
        <RefineList label="Seasons">{profile.seasons.map((season) => <li key={`${season.seasonId}:${season.teamProfileId}`} className="rf-row">
          <span className="rf-grow">
            <Link to={`/seasons/${season.seasonId}`} className="rf-t1">{season.seasonName}</Link>
            <span className="rf-t2">{season.teamName} · {plural(season.eventsEntered, 'competition')} · {formatPoints(season.points)} pts{season.rank != null ? ` · ${ordinalPlace(season.rank)}` : ''}</span>
          </span>
        </li>)}</RefineList>
      </> : null}
      {profile.clubs?.length ? <>
        <RefineSection title="Clubs represented" meta={profile.clubs.length} />
        <RefineList label="Clubs represented">{profile.clubs.map((club) => <li key={club.clubName}>
          <Link to={statsProfileHref(StatsSubjectKind.Club, club.clubName.toLowerCase())} className="rf-row">
            <span className="rf-grow">
              <span className="rf-t1">{club.clubName}</span>
              <span className="rf-t2">{plural(club.entries, 'entry', 'entries')} · {plural(club.competitions, 'competition')}</span>
            </span>
            <Chevron />
          </Link>
        </li>)}</RefineList>
      </> : null}
      <RefineSection title={PARTNER_TITLES[profile.kind]} meta={profile.partnerships?.length ?? 0} />
      {profile.partnerships?.length ? <RefineList label={PARTNER_TITLES[profile.kind]}>{profile.partnerships.map((pair) => <li key={`${pair.riderName}|${pair.ponyName}`} className="rf-row">
        <span className="rf-grow"><span className="rf-t1">{profile.kind === StatsSubjectKind.Rider
          ? <Link to={statsProfileHref(StatsSubjectKind.Pony, pair.ponyName.toLowerCase())}>{pair.ponyName}</Link>
          : profile.kind === StatsSubjectKind.Pony
            ? <Link to={statsProfileHref(StatsSubjectKind.Rider, pair.riderName.toLowerCase())}>{pair.riderName}</Link>
            : <><Link to={statsProfileHref(StatsSubjectKind.Rider, pair.riderName.toLowerCase())}>{pair.riderName}</Link> on <Link to={statsProfileHref(StatsSubjectKind.Pony, pair.ponyName.toLowerCase())}>{pair.ponyName}</Link></>}</span>
          <span className="rf-t2">{plural(pair.entries, 'entry', 'entries')} · {plural(pair.competitions, 'competition')}</span></span>
      </li>)}</RefineList> : <RefineNote>No ponies were named on the declaration forms.</RefineNote>}
      <RefineNote>Places come from each age group’s final standings. Hors concours teams have no place.</RefineNote>
    </>}
  </>;
}

function EntryRow({ entry }: { entry: StatsEntry }) {
  const final = finalLabel(entry.finalTier);
  const place = entry.isHorsConcours ? 'HC' : entry.place == null ? '—' : ordinalPlace(entry.place);
  const who = [entry.riderName && `with ${entry.riderName}`, entry.ponyName && `on ${entry.ponyName}`].filter(Boolean).join(' ');
  const date = new Date(entry.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return <RefineDisclosure
    title={entry.competitionName}
    sub={`${date} · ${entry.sectionName} (${SectionFormatLabel[entry.format]}) · ${entry.teamName}${who ? ` ${who}` : ''}`}
    trailing={<span className="text-right"><span className="rf-num block">{place}</span>{!entry.isHorsConcours && entry.teamsPlaced > 0 && <span className="rf-t2">of {entry.teamsPlaced}</span>}</span>}
  >
    <div className="flex flex-col gap-1 px-4 pb-3 text-sm">
      <p className="m-0">{final ? `${final}. ` : ''}Point quota {formatPercent(entry.pointQuotaPercent)} ({pointsOf(entry.points, entry.maxPoints)} over {plural(entry.races, 'race')}).</p>
      {entry.sessions.length > 0 && <table className="w-full text-left text-sm">
        <caption className="sr-only">Sessions at {entry.competitionName}</caption>
        <thead><tr className="text-xs uppercase text-[rgb(var(--mg-muted))]"><th scope="col" className="py-1 font-bold">Session</th><th scope="col" className="py-1 font-bold">Points</th><th scope="col" className="py-1 text-right font-bold">Place</th></tr></thead>
        <tbody>{entry.sessions.map((session) => <tr key={session.sessionId} className="border-t border-[rgb(var(--mg-rule-soft))]">
          <td className="py-1.5">{session.name}</td>
          <td className="py-1.5 tabular-nums">{formatPoints(session.points)} of {formatPoints(session.maxPoints)}</td>
          <td className="py-1.5 text-right tabular-nums">{session.rank == null ? 'HC' : `${ordinalPlace(session.rank)} of ${session.teams}`}</td>
        </tr>)}</tbody>
      </table>}
    </div>
  </RefineDisclosure>;
}
