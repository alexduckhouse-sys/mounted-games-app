import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link2, Plus, Save, Star } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { FAVOURITES_CHANGED, readFavourites, toggleFavourite } from '../../lib/favourites';
import { SectionFormatLabel } from '../../types';
import { Chevron, RefineDisclosure, RefineFoot, RefineHeader, RefineList, RefineNote, RefinePage, RefineSection, type RefineTab } from '../refine/Refine';
import { ordinal, positionLabels, shortDate } from './seasonModel';
import type { SeasonView, StandingView } from './seasonViewTypes';
import { buildRows, latestPerRound, seasonChoices, type SeasonDetail } from './teamHistoryModel';
import { TeamGameStats } from './TeamGameStats';
import type { ClubOption, CompetitionDetailOption, CompetitionSummaryOption, TeamProfile, TeamProfileHistory } from './teamProfileTypes';
import './seasonViews.css';
import { SelectField } from '../../components/SelectField';

type ProfileTab = 'history' | 'edit' | 'link';

/** The club choice that means "a club that isn't on the list yet". */
const NEW_CLUB = 'new';

function message(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { detail?: string; title?: string } } };
  return candidate.response?.data?.detail ?? candidate.response?.data?.title ?? fallback;
}

function date(value: string) {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function fetchPage(id: string | undefined, mayManage: boolean) {
  const [profilesResponse, clubsResponse] = await Promise.all([
    api.get<TeamProfile[]>('/team-profiles'),
    api.get<ClubOption[]>('/clubs'),
  ]);
  if (!id) return { profiles: profilesResponse.data, clubs: clubsResponse.data, history: null, competitions: [] };
  const { data: history } = await api.get<TeamProfileHistory>(`/team-profiles/${id}/history`);
  const competitions = history.profile.canManage && mayManage
    ? (await api.get<CompetitionSummaryOption[]>('/competitions', { params: { includeArchived: true } })).data
    : [];
  return { profiles: profilesResponse.data, clubs: clubsResponse.data, history, competitions };
}

export default function TeamProfilePage() {
  const params = useParams();
  const id = params.id ?? params.profileId;
  const { user } = useAuth();
  return <TeamProfilePageContent key={`${id ?? 'list'}:${user?.id ?? 'public'}`} id={id} />;
}

function TeamProfilePageContent({ id }: { id: string | undefined }) {
  const { user, canOrganise } = useAuth();
  const mayManage = canOrganise();
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const [profiles, setProfiles] = useState<TeamProfile[] | null>(null);
  const [history, setHistory] = useState<TeamProfileHistory | null>(null);
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionSummaryOption[]>([]);
  const [competition, setCompetition] = useState<CompetitionDetailOption | null>(null);
  const [competitionId, setCompetitionId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [clubId, setClubId] = useState('');
  const [newClubName, setNewClubName] = useState('');
  const [suffix, setSuffix] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [tab, setTab] = useState<ProfileTab>('history');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [favourites, setFavourites] = useState(readFavourites);
  const [seasonData, setSeasonData] = useState<{ seasonId: string; season: SeasonView; standings: StandingView[] } | null>(null);
  const canManageProfile = !!history?.profile.canManage && mayManage;

  const choices = useMemo(() => seasonChoices(history?.publishedResults ?? []), [history]);
  const selected = choices.find((choice) => choice.seasonId === query.get('season')) ?? choices[0] ?? null;
  const selectedId = selected?.seasonId ?? null;

  useEffect(() => {
    let cancelled = false;
    fetchPage(id, mayManage).then((page) => {
      if (cancelled) return;
      setProfiles(page.profiles);
      setClubs(page.clubs);
      setHistory(page.history);
      setCompetitions(page.competitions);
      if (page.history) {
        setClubId(String(page.history.profile.clubId));
        setSuffix(page.history.profile.suffix);
        setDisplayName(page.history.profile.displayName);
      }
      setError(null);
    }).catch((caught) => {
      if (!cancelled) setError(message(caught, id ? 'Couldn’t load this team profile.' : 'Couldn’t load team profiles.'));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, mayManage, user?.id, refresh]);

  useEffect(() => {
    if (!competitionId) return;
    let cancelled = false;
    api.get<CompetitionDetailOption>(`/competitions/${competitionId}`)
      .then(({ data }) => { if (!cancelled) setCompetition(data); })
      .catch((caught) => { if (!cancelled) setError(message(caught, 'Couldn’t load teams for that competition.')); });
    return () => { cancelled = true; };
  }, [competitionId, user?.id]);

  // The season's own settings and table give the place, the "best N" rule and which results were dropped.
  // If they can't be loaded the history still shows, just without those extras.
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    Promise.all([
      api.get<SeasonView>(`/seasons/${selectedId}`, { signal: controller.signal }),
      api.get<{ standings: StandingView[] }>(`/seasons/${selectedId}/standings`, { signal: controller.signal }),
    ]).then(([season, table]) => {
      if (!controller.signal.aborted) setSeasonData({ seasonId: selectedId, season: season.data, standings: table.data.standings });
    }).catch(() => { /* optional detail */ });
    return () => controller.abort();
  }, [selectedId, refresh]);

  useEffect(() => {
    const sync = () => setFavourites(readFavourites());
    window.addEventListener(FAVOURITES_CHANGED, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(FAVOURITES_CHANGED, sync); window.removeEventListener('storage', sync); };
  }, []);

  const matchingTeams = useMemo(() => {
    if (!competition || !history) return [];
    // Any team of the profile's club can be linked: teams can have their own names, and a suffix is optional.
    return competition.teams.filter((team) => team.clubId === history.profile.clubId);
  }, [competition, history]);

  function chooseCompetition(value: string) {
    setCompetitionId(value); setCompetition(null); setTeamId(''); setError(null); setSuccess(null);
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null); setSuccess(null);
    try {
      const club = clubId === NEW_CLUB ? { clubId: 0, clubName: newClubName.trim() } : { clubId: Number(clubId) };
      if (id) {
        await api.put(`/team-profiles/${id}`, { ...club, suffix, displayName });
        setSuccess('Profile saved.'); setRefresh((value) => value + 1);
      } else {
        const { data } = await api.post<TeamProfile>('/team-profiles', { ...club, suffix, displayName });
        navigate(`/team-profiles/${data.id}`);
      }
    } catch (caught) { setError(message(caught, 'Couldn’t save the profile. Check the details and try again.')); }
    finally { setBusy(false); }
  }

  async function linkTeam(event: FormEvent) {
    event.preventDefault();
    if (!id || !competitionId || !teamId) return;
    setBusy(true); setError(null); setSuccess(null);
    try {
      await api.post(`/competitions/${competitionId}/team-profile-links`, { teamProfileId: id, teamId: Number(teamId) });
      setSuccess('Event team linked.'); setCompetitionId(''); setTeamId(''); setCompetition(null); setTab('history'); setRefresh((value) => value + 1);
    } catch (caught) { setError(message(caught, 'Couldn’t link that event team.')); }
    finally { setBusy(false); }
  }

  if (loading) return <RefinePage><RefineHeader context="Team profiles" title={id ? 'Team history' : 'Team profiles'} /><p role="status" className="rf-note">Loading team history…</p></RefinePage>;

  if (!id) {
    if (creating && mayManage) return <RefinePage>
      <RefineHeader context="Team profiles" title="Create a team profile" subtitle="Use one profile for the same club team across different events." />
      {error && <div role="alert" className="mg-notice sv-msg">{error}</div>}
      <form onSubmit={saveProfile}>
        <fieldset disabled={busy} className="sv-fieldset sv-stack">
          <legend className="sr-only">Team details</legend>
          <label className="rf-fld">Club<SelectField value={clubId} onChange={(event) => setClubId(event.target.value)} required><option value="">Choose a club</option>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}<option value={NEW_CLUB}>A club that isn’t listed…</option></SelectField></label>
          {clubId === NEW_CLUB && <label className="rf-fld">New club name<input value={newClubName} onChange={(event) => setNewClubName(event.target.value)} maxLength={150} required /></label>}
          <div className="sv-two"><label className="rf-fld">Suffix<input value={suffix} onChange={(event) => setSuffix(event.target.value)} maxLength={10} placeholder="Optional" /></label><label className="rf-fld">Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={200} required /></label></div>
        </fieldset>
        <RefineFoot>
          <span className="rf-grow" />
          <button type="button" className="rf-btn rf-btn-text" onClick={() => setCreating(false)} disabled={busy}>Cancel</button>
          <button className="rf-btn rf-btn-primary" disabled={busy}><Plus className="h-4 w-4" aria-hidden="true" />{busy ? 'Creating…' : 'Create profile'}</button>
        </RefineFoot>
      </form>
    </RefinePage>;

    return <RefinePage>
      <RefineHeader
        context="Across every event" title="Team profiles" subtitle="Published results stay together when the same team competes at more than one event."
        actions={mayManage ? <button type="button" className="rf-btn" onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden="true" />New profile</button> : undefined}
      />
      {error && <div role="alert" className="mg-notice sv-msg">{error} <button type="button" className="mg-text-link min-h-11" onClick={() => { setLoading(true); setError(null); setRefresh((value) => value + 1); }}>Try again</button></div>}
      {!error && (profiles?.length ? <>
        <RefineSection title="All profiles" meta={profiles.length} />
        <RefineList label="Team profiles">{profiles.map((profile) => <li key={profile.id}><Link to={`/team-profiles/${profile.id}`} className="rf-row"><span className="rf-grow"><span className="rf-t1">{profile.displayName}</span><span className="rf-t2">{profile.clubName}{profile.suffix ? ` · suffix ${profile.suffix}` : ''}</span></span><Chevron /></Link></li>)}</RefineList>
      </> : <div className="sv-empty"><h2>No team profiles yet</h2><p>Profiles will appear here once an organiser creates them.</p></div>)}
    </RefinePage>;
  }

  if (!history) return <RefinePage>
    <RefineHeader back="/team-profiles" backLabel="Back to team profiles" context="Team profiles" title="Team history" />
    <div role="alert" className="mg-notice sv-msg">{error ?? 'Team profile not found.'} {error && <button type="button" className="mg-text-link min-h-11" onClick={() => { setLoading(true); setError(null); setRefresh((value) => value + 1); }}>Try again</button>}</div>
  </RefinePage>;

  const profile = history.profile;
  const identityLocked = history.eventTeams.length > 0 || history.publishedResults.length > 0;
  const tabs: (RefineTab & { id: ProfileTab })[] = canManageProfile ? ([['history', 'History'], ['edit', 'Edit profile'], ['link', 'Link event']] as [ProfileTab, string][])
    .map(([key, label]) => ({ id: key, label, active: tab === key, onSelect: () => { setTab(key); setError(null); setSuccess(null); } })) : [];

  const eventTeams = history.eventTeams;
  const following = eventTeams.length > 0 && eventTeams.every((team) => favourites.some((item) => item.competitionId === team.competitionId && item.teamId === team.teamId));
  function toggleStar() {
    let problem: string | null = null;
    for (const team of eventTeams) {
      const isFollowed = favourites.some((item) => item.competitionId === team.competitionId && item.teamId === team.teamId);
      if (following === isFollowed) problem = toggleFavourite({ competitionId: team.competitionId, teamId: team.teamId }) ?? problem;
    }
    setFavourites(readFavourites());
    setError(problem);
  }

  const seasonResults = history.publishedResults.filter((result) => result.seasonId === selectedId);
  const detail: SeasonDetail | null = seasonData && seasonData.seasonId === selectedId
    ? { season: seasonData.season, standing: seasonData.standings.find((row) => row.teamProfileId === profile.id) ?? null } : null;
  const rows = buildRows(seasonResults, detail);
  const entered = rows.filter((row) => row.place !== null).length;
  const standing = detail?.standing ?? null;
  const total = standing?.totalPoints ?? latestPerRound(seasonResults).reduce((sum, result) => sum + result.seasonPoints, 0);
  const bestCount = detail?.season.bestResultsToCount ?? null;
  const roundsText = bestCount && bestCount < entered ? `best ${bestCount} of ${entered} rounds` : `${entered} ${entered === 1 ? 'round' : 'rounds'}`;
  const placeLabel = standing && detail ? (() => {
    const label = positionLabels(seasonData!.standings).get(standing.teamProfileId) ?? String(standing.rank);
    return label.startsWith('=') ? `=${ordinal(standing.rank)}` : ordinal(standing.rank);
  })() : null;
  const context = !selected ? 'Team record' : detail ? `${detail.season.ageGroup} ${SectionFormatLabel[detail.season.format]} · ${detail.season.year}` : `${selected.title} · ${selected.year}`;
  const previous = choices.filter((choice) => choice.seasonId !== selectedId);

  return <RefinePage>
    <RefineHeader
      back={selected ? `/seasons/${selected.seasonId}` : '/team-profiles'} backLabel={selected ? 'Back to standings' : 'Back to team profiles'}
      context={context} title={profile.displayName}
      subtitle={selected ? <>{placeLabel && <><strong>{placeLabel}</strong> · </>}{total} pts · {roundsText}</> : profile.suffix ? `${profile.clubName} · suffix ${profile.suffix}` : profile.clubName}
      actions={history.eventTeams.length > 0 ? <button type="button" className="rf-ib sv-star" aria-pressed={following} aria-label={`${following ? 'Unstar' : 'Star'} ${profile.displayName}`} title="Follow on this device" onClick={toggleStar}><Star className="h-5 w-5" aria-hidden="true" /></button> : undefined}
      tabs={tabs} tabsKind="tablist" tabsLabel="Team profile sections"
    />
    {error && <div role="alert" className="mg-notice sv-msg">{error}</div>}
    {success && <div role="status" className="mg-notice sv-msg">{success}</div>}

    {tab === 'history' && <>
      {history.publishedResults.length === 0 ? <div className="sv-empty"><h2>No published results</h2><p>This team hasn’t appeared in a published season round yet.</p></div> : <>
        <div className="rf-table-wrap sv-gap"><table className="rf-table sv-table sv-hist">
          <caption className="sr-only">Rounds in {selected?.title}. Struck-through points fall outside the best results that count.</caption>
          <thead><tr><th scope="col">Round</th><th scope="col" className="sv-place">Place</th><th scope="col">Pts</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.key}>
            <td><span className="rf-t1">R{row.order} · {row.name}</span><span className="rf-t2">{shortDate(row.date, false)}{row.dropped ? ' · dropped' : row.place === null ? ' · did not enter' : ''}</span></td>
            <td className={row.place === null ? 'sv-dim' : row.dropped ? 'rf-num sv-dim' : 'rf-num'}>{row.place === null ? '—' : ordinal(row.place)}</td>
            <td className={row.points === null ? 'sv-dim' : 'rf-num'}>{row.points === null ? '—' : row.dropped ? <s className="sv-struck">{row.points}</s> : row.points}</td>
          </tr>)}</tbody>
        </table></div>
        {previous.length > 0 && <div className="sv-gap"><RefineList as="div"><RefineDisclosure title="Previous seasons" sub={`${previous.length} more`}>
          <div className="sv-prev">{previous.map((choice) => <Link key={choice.seasonId} className="rf-row" to={`?season=${choice.seasonId}`}><span className="rf-grow"><span className="rf-t1">{choice.title}</span><span className="rf-t2">{choice.year}</span></span><Chevron /></Link>)}</div>
        </RefineDisclosure></RefineList></div>}
        <RefineNote>Public results only. No rider names.</RefineNote>
      </>}
      <TeamGameStats profileId={profile.id} linked={history.eventTeams.length} />
      <RefineSection title="Linked events" />
      {history.eventTeams.length === 0 ? <p className="rf-note">No event teams are linked yet.</p> : <RefineList label="Linked events">{history.eventTeams.map((item) => <li key={item.id} className="rf-row"><span className="rf-grow"><span className="rf-t1">{item.competitionName}</span><span className="rf-t2">{item.teamName}</span></span><time className="rf-t2" dateTime={item.linkedAt}>Linked {date(item.linkedAt)}</time></li>)}</RefineList>}
    </>}

    {tab === 'edit' && canManageProfile && <>
      <RefineSection title="Edit profile" />
      <form onSubmit={saveProfile} className="sv-stack">
        <fieldset disabled={busy} className="sv-fieldset sv-stack">
          <legend className="sr-only">Profile details</legend>
          <label className="rf-fld">Club<SelectField value={clubId} onChange={(event) => setClubId(event.target.value)} required disabled={identityLocked}>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}<option value={NEW_CLUB}>A club that isn’t listed…</option></SelectField></label>
          {clubId === NEW_CLUB && <label className="rf-fld">New club name<input value={newClubName} onChange={(event) => setNewClubName(event.target.value)} maxLength={150} required disabled={identityLocked} /></label>}
          <div className="sv-two"><label className="rf-fld">Suffix<input value={suffix} onChange={(event) => setSuffix(event.target.value)} maxLength={10} placeholder="Optional" disabled={identityLocked} /></label><label className="rf-fld">Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={200} required /></label></div>
        </fieldset>
        <RefineNote>Once linked, the club and suffix stay fixed.</RefineNote>
        <button className="rf-btn rf-btn-primary" disabled={busy}><Save className="h-4 w-4" aria-hidden="true" />{busy ? 'Saving…' : 'Save profile'}</button>
      </form>
    </>}

    {tab === 'link' && canManageProfile && <>
      <RefineSection title="Link an event team" />
      <form onSubmit={linkTeam} className="sv-stack">
        <fieldset disabled={busy} className="sv-fieldset sv-stack">
          <legend className="sr-only">Event team link</legend>
          <label className="rf-fld">Competition<SelectField value={competitionId} onChange={(event) => chooseCompetition(event.target.value)} required><option value="">Choose a competition</option>{competitions.map((item) => <option key={item.id} value={item.id}>{item.name} · {date(item.startDate)}</option>)}</SelectField></label>
          <label className="rf-fld">Event team<SelectField value={teamId} onChange={(event) => setTeamId(event.target.value)} required disabled={!competition}><option value="">Choose the matching team</option>{matchingTeams.map((team) => <option key={team.id} value={team.id}>{team.displayName}</option>)}</SelectField></label>
          {competition && matchingTeams.length === 0 && <p className="rf-note sv-flush">There’s no unlinked team from this profile’s club in that competition.</p>}
        </fieldset>
        <RefineNote>Choose the event team yourself. The system won’t match teams by name.</RefineNote>
        <button className="rf-btn rf-btn-primary" disabled={busy || !teamId}><Link2 className="h-4 w-4" aria-hidden="true" />{busy ? 'Linking…' : 'Link event team'}</button>
      </form>
    </>}
  </RefinePage>;
}
