import { useState } from 'react';
import { Notice } from '../../components/Notice';
import { usePageWidth } from '../../components/pageWidthState';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { RoundSearch } from '../../components/RoundSearch';
import { ChevronRight } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { StatsGamesView } from '../../components/stats/StatsGamesView';
import { StatsSummaryView } from '../../components/stats/StatsSummaryView';
import { useStatsBrowse, useStatsProfile, type StatsBrowseLoad } from '../../hooks/useStats';
import {
  STATS_KIND_LABELS, STATS_MAX_QUERY, STATS_PATHS, STATS_TABS, finalLabel, formatPercent, countText, isSearchableQuery, ordinalPlace,
  pointsOf, statsKindFromPath, statsProfileHref, tidyStatsQuery,
} from '../../lib/stats';
import { StatsSubjectKind, type StatsEntry, type StatsHit, type StatsProfile } from '../../types';
import { Chevron, RefineDisclosure, RefineList, RefineNote, RefinePage, RefineSection } from '../refine/Refine';
import { formatPoints } from '../../lib/formatPoints';
import { useT, useLanguage } from '../../i18n/LanguageContext';
import type { Translate } from '../../i18n/translate';
import { sectionFormatText } from '../../lib/sectionFormatText';
import { groupRiders, type RiderLine } from './riderList';
import '../../components/sitePages.css';
import '../../components/filterKit.css';

/** `/stats` browses and searches; `/stats/:kind?name=` shows one rider, pony, team or club. */
export function StatsPage() {
  const { kind: segment } = useParams();
  if (segment === undefined) return <StatsBrowseView />;
  return <StatsProfileRoute segment={segment} />;
}

function StatsBrowseView() {
  const t = useT();
  usePageWidth('wide');
  usePageHeader({ title: t('site.stats.title'), plain: true });
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

  // The tabs are links, so each keeps the words typed and the address says which one is showing.
  const tabHref = (next: StatsSubjectKind) => {
    const query = new URLSearchParams();
    if (next !== StatsSubjectKind.Rider) query.set('kind', STATS_PATHS[next]);
    if (text.trim()) query.set('q', text);
    const search = query.toString();
    return search ? `?${search}` : '?';
  };
  return <RefinePage wide>
    <h1 className="sr-only">{t('site.stats.title')}</h1>
    <div className="mg-band mg-band-header sp-top pb-3 pt-0">
      <RoundSearch band label={t('site.stats.search', { plural: tab.plural })} placeholder={t('site.stats.namePlaceholder', { kind: STATS_KIND_LABELS[kind].toLowerCase() })} value={text} maxLength={STATS_MAX_QUERY}
        onChange={(next) => { setText(next); remember(kind, next); }} />
    </div>
    <nav className="sp-seg sp-gap" aria-label={t('site.stats.show')}>
      {STATS_TABS.map((entry) => <Link key={entry.kind} to={tabHref(entry.kind)} replace aria-current={entry.kind === kind ? 'page' : undefined}>{entry.label}</Link>)}
    </nav>
    <div key={kind} className="mg-settle">
      {text.trim().length === 1 && <RefineNote>{t('site.stats.twoLetters')}</RefineNote>}
      {list.status === 'loading' && <p role="status" className="rf-note">{t('common.loading')}</p>}
      {list.status === 'error' && <Notice className="mt-3">{list.message}</Notice>}
      {list.status === 'ready' && <BrowseResults list={list} kind={kind} plural={tab.plural} label={tab.label} words={isSearchableQuery(text) ? tidyStatsQuery(text) : ''} />}
    </div>
  </RefinePage>;
}

function BrowseResults({ list, kind, plural: noun, label, words }: { list: Extract<StatsBrowseLoad, { status: 'ready' }>; kind: StatsSubjectKind; plural: string; label: string; words: string }) {
  const t = useT();
  if (list.items.length === 0) return <div className="py-6 text-[rgb(var(--mg-muted))]" role="status">
    <h2 className="m-0 mb-1 font-['Barlow_Condensed',sans-serif] text-xl font-bold text-[rgb(var(--mg-heading))]">{words ? t('site.stats.noMatches') : t('site.stats.noEvents')}</h2>
    <p className="m-0">{words
      ? t('site.stats.noMatchBody', { plural: noun, words })
      : t('site.stats.noEventsBody')}</p>
  </div>;
  const remaining = list.total - list.items.length;
  return <>
    {kind === StatsSubjectKind.Rider
      ? groupRiders(list.items).map((group) => <section key={group.letter} aria-label={t('site.stats.ridersLetter', { letter: group.letter })} className="mt-8 first:mt-4">
        <div className="fk-group-title">
          <h2>{group.letter}</h2>
          {/* Only a full list can be counted by letter; more pages would add to it. */}
          {remaining <= 0 && <span>{countText('rider', group.riders.length)}</span>}
        </div>
        <ul className="sp-card mt-2 list-none p-0" aria-label={t('site.stats.ridersLetter', { letter: group.letter })}>{group.riders.map((line) => <RiderRow key={line.hit.key} line={line} />)}</ul>
      </section>)
      : <ul className="sp-card sp-gap m-0 list-none p-0" aria-label={label}>{list.items.map((hit) => <HitRow key={hit.key} hit={hit} />)}</ul>}
    {list.moreError && <Notice className="mt-3">{list.moreError}</Notice>}
    {remaining > 0 && <button type="button" className="rf-btn rf-wide mt-3" disabled={list.loadingMore} onClick={list.loadMore}>
      {list.loadingMore ? t('common.loading') : t('site.stats.showMore', { count: remaining })}
    </button>}
    <RefineNote>{t('site.stats.finishedOnly')}</RefineNote>
  </>;
}

/** "Barker, Arthur", surname first; nothing under it. */
function RiderRow({ line }: { line: RiderLine }) {
  const { hit } = line;
  return <li><Link to={statsProfileHref(hit.kind, hit.key)} className="sp-row">
    <span className="sp-grow"><span className="sp-t1 sp-big">{line.given ? <>{line.surname}, <span className="font-medium">{line.given}</span></> : line.surname}</span></span>
    <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
  </Link></li>;
}

function HitRow({ hit }: { hit: StatsHit }) {
  return <li><Link to={statsProfileHref(hit.kind, hit.key)} className="sp-row">
    <span className="sp-t1 sp-big sp-grow">{hit.name}</span>
    <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
  </Link></li>;
}

function StatsProfileRoute({ segment }: { segment: string }) {
  const t = useT();
  const kind = statsKindFromPath(segment);
  const [params] = useSearchParams();
  const name = params.get('name') ?? '';
  const { user } = useAuth();
  const valid = kind !== null && isSearchableQuery(name);
  const load = useStatsProfile(valid ? `/stats/${STATS_PATHS[kind]}?name=${encodeURIComponent(name)}` : null, user?.id ?? 'public');
  const label = kind === null ? t('site.stats.statsWord') : t('site.stats.kindStats', { kind: STATS_KIND_LABELS[kind] });
  // One sub-page header (back arrow and the name) in the app bar, rather than a second bar under it.
  usePageHeader({
    title: load.status === 'ready' ? load.data.name : name || t('site.stats.notFound'),
    subtitle: label,
    plain: true,
    backTo: kind === null ? '/stats' : `/stats?kind=${STATS_PATHS[kind]}`,
    backLabel: t('site.stats.backToList'),
  });

  if (!valid || load.status === 'missing') return <RefinePage>
    <div className="py-6 text-[rgb(var(--mg-muted))]"><h2 className="m-0 mb-1 font-['Barlow_Condensed',sans-serif] text-xl font-bold text-[rgb(var(--mg-heading))]">{t('site.stats.noneFound')}</h2>
      <p className="m-0">{t('site.stats.noneFoundBody')} <Link to="/stats" className="font-semibold text-[rgb(var(--mg-heading))]">{t('site.stats.browse')}</Link></p></div>
  </RefinePage>;
  if (load.status === 'error') return <RefinePage><Notice className="mt-3">{load.message}</Notice></RefinePage>;
  if (load.status !== 'ready') return <RefinePage><p role="status" className="rf-note">{t('site.stats.loading')}</p></RefinePage>;
  return <RefinePage><ProfileBody profile={load.data} /></RefinePage>;
}

const partnerTitle = (kind: StatsSubjectKind, t: Translate) => t(kind === 0 ? 'site.stats.poniesRidden' : kind === 1 ? 'site.stats.ridersTitle' : 'site.stats.ridersAndPonies');

/** The profile itself: the summary, then every game, competition, season, club and partnership, for everyone. */
function ProfileBody({ profile }: { profile: StatsProfile }) {
  const t = useT();
  const { summary } = profile;
  const games = profile.games != null ? <>
    <RefineSection title={profile.raceFiguresAllFormats ? t('site.stats.games') : t('site.stats.gamesIndividualPairs')} meta={profile.games.length} />
    <StatsGamesView games={profile.games} best={profile.bestGames ?? []} worst={profile.worstGames ?? []}
      emptyText={profile.raceFiguresAllFormats ? t('site.stats.noRaces') : t('site.stats.noIndividualRaces')} />
  </> : null;
  return <>
    <StatsSummaryView summary={summary} raceFiguresAllFormats={profile.raceFiguresAllFormats} />
    {games}
    <RefineSection title={t('site.stats.competitions')} meta={profile.entries?.length ?? 0} />
    {profile.entries?.length ? <RefineList as="div" label={t('site.stats.competitions')}>{profile.entries.map((entry) => <EntryRow key={`${entry.teamId}`} entry={entry} />)}</RefineList>
      : <RefineNote>{t('site.stats.noCompetitions')}</RefineNote>}
    {profile.seasons?.length ? <>
      <RefineSection title={t('site.stats.seasons')} meta={profile.seasons.length} />
      <RefineList label={t('site.stats.seasons')}>{profile.seasons.map((season) => <li key={`${season.seasonId}:${season.teamProfileId}`}>
        <Link to={`/seasons/${season.seasonId}`} className="rf-row">
          <span className="rf-grow">
            <span className="rf-t1">{season.seasonName}</span>
            <span className="rf-t2">{season.teamName} · {countText('competition', season.eventsEntered)} · {t('site.stats.pts', { points: formatPoints(season.points) })}{season.rank != null ? ` · ${ordinalPlace(season.rank)}` : ''}</span>
          </span>
          <Chevron />
        </Link>
      </li>)}</RefineList>
    </> : null}
    {profile.clubs?.length ? <>
      <RefineSection title={t('site.stats.clubsRepresented')} meta={profile.clubs.length} />
      <RefineList label={t('site.stats.clubsRepresented')}>{profile.clubs.map((club) => <li key={club.clubName}>
        <Link to={statsProfileHref(StatsSubjectKind.Club, club.clubName.toLowerCase())} className="rf-row">
          <span className="rf-grow">
            <span className="rf-t1">{club.clubName}</span>
            <span className="rf-t2">{countText('entry', club.entries)} · {countText('competition', club.competitions)}</span>
          </span>
          <Chevron />
        </Link>
      </li>)}</RefineList>
    </> : null}
    <RefineSection title={partnerTitle(profile.kind, t)} meta={profile.partnerships?.length ?? 0} />
    {profile.partnerships?.length ? <RefineList label={partnerTitle(profile.kind, t)}>{profile.partnerships.map((pair) => <li key={`${pair.riderName}|${pair.ponyName}`}>
      {/* The whole row is the link: to the pony for a rider, to the rider for a pony or a team. */}
      <Link to={statsProfileHref(profile.kind === StatsSubjectKind.Rider ? StatsSubjectKind.Pony : StatsSubjectKind.Rider, (profile.kind === StatsSubjectKind.Rider ? pair.ponyName : pair.riderName).toLowerCase())} className="rf-row">
        <span className="rf-grow">
          <span className="rf-t1">{profile.kind === StatsSubjectKind.Rider ? pair.ponyName : profile.kind === StatsSubjectKind.Pony ? pair.riderName : `${pair.riderName} ${t('site.stats.onPony')} ${pair.ponyName}`}</span>
          <span className="rf-t2">{countText('entry', pair.entries)} · {countText('competition', pair.competitions)}</span>
        </span>
        <Chevron />
      </Link>
    </li>)}</RefineList> : <RefineNote>{t('site.stats.noPonies')}</RefineNote>}
    <RefineNote>{t('site.stats.placesNote')}</RefineNote>
  </>;
}

function EntryRow({ entry }: { entry: StatsEntry }) {
  const t = useT();
  const { locale } = useLanguage();
  const final = finalLabel(entry.finalTier);
  const place = entry.isHorsConcours ? 'HC' : entry.place == null ? '—' : ordinalPlace(entry.place);
  const who = [entry.riderName && t('site.stats.withRider', { name: entry.riderName }), entry.ponyName && t('site.stats.onPonyName', { name: entry.ponyName })].filter(Boolean).join(' ');
  const date = new Date(entry.startDate).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  return <RefineDisclosure
    title={entry.competitionName}
    sub={`${date} · ${entry.sectionName} (${sectionFormatText(entry.format, t)}) · ${entry.teamName}${who ? ` ${who}` : ''}`}
    trailing={<span className="text-right"><span className="rf-num block">{place}</span>{!entry.isHorsConcours && entry.teamsPlaced > 0 && <span className="rf-t2">{t('site.stats.ofTeams', { count: entry.teamsPlaced })}</span>}</span>}
  >
    <Link to={`/competitions/${entry.competitionId}`} className="rf-row"><span className="rf-grow rf-t1">{t('site.stats.openCompetition', { name: entry.competitionName })}</span><Chevron /></Link>
    <div className="flex flex-col gap-1 px-4 pb-3 text-sm">
      <p className="m-0">{final ? `${final}. ` : ''}{t('site.stats.quotaLine', { percent: formatPercent(entry.pointQuotaPercent), points: pointsOf(entry.points, entry.maxPoints), races: countText('race', entry.races) })}</p>
      {entry.sessions.length > 0 && <table className="w-full text-left text-sm">
        <caption className="sr-only">{t('site.stats.sessionsAt', { name: entry.competitionName })}</caption>
        <thead><tr className="text-xs uppercase text-[rgb(var(--mg-muted))]"><th scope="col" className="py-1 font-bold">{t('site.stats.session')}</th><th scope="col" className="py-1 font-bold">{t('site.stats.points')}</th><th scope="col" className="py-1 text-right font-bold">{t('site.stats.place')}</th></tr></thead>
        <tbody>{entry.sessions.map((session) => <tr key={session.sessionId} className="border-t border-[rgb(var(--mg-rule-soft))]">
          <td className="py-1.5">{session.name}</td>
          <td className="py-1.5 tabular-nums">{t('site.of', { a: formatPoints(session.points), b: formatPoints(session.maxPoints) })}</td>
          <td className="py-1.5 text-right tabular-nums">{session.rank == null ? 'HC' : t('site.of', { a: ordinalPlace(session.rank), b: session.teams })}</td>
        </tr>)}</tbody>
      </table>}
    </div>
  </RefineDisclosure>;
}
