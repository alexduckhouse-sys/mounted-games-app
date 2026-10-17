import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Link2, Plus, Save } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import type { ClubOption, CompetitionDetailOption, CompetitionSummaryOption, TeamProfile, TeamProfileHistory } from './teamProfileTypes';
import './seasonViews.css';

type ProfileTab = 'history' | 'edit' | 'link';

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
  const { user, editorMode } = useAuth();
  return <TeamProfilePageContent key={`${id ?? 'list'}:${user?.id ?? 'public'}:${editorMode}`} id={id} />;
}

function TeamProfilePageContent({ id }: { id: string | undefined }) {
  const { user, canOrganise, hasRole, canEdit } = useAuth();
  const mayManage = canOrganise() && (!hasRole('Admin') || canEdit());
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<TeamProfile[] | null>(null);
  const [history, setHistory] = useState<TeamProfileHistory | null>(null);
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionSummaryOption[]>([]);
  const [competition, setCompetition] = useState<CompetitionDetailOption | null>(null);
  const [competitionId, setCompetitionId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [clubId, setClubId] = useState('');
  const [suffix, setSuffix] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [tab, setTab] = useState<ProfileTab>('history');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const canManageProfile = !!history?.profile.canManage && mayManage;

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

  const matchingTeams = useMemo(() => {
    if (!competition || !history) return [];
    return competition.teams.filter((team) => team.clubId === history.profile.clubId
      && team.suffix.trim().toLocaleLowerCase() === history.profile.suffix.trim().toLocaleLowerCase());
  }, [competition, history]);

  function chooseCompetition(value: string) {
    setCompetitionId(value); setCompetition(null); setTeamId(''); setError(null); setSuccess(null);
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null); setSuccess(null);
    try {
      if (id) {
        await api.put(`/team-profiles/${id}`, { clubId: Number(clubId), suffix, displayName });
        setSuccess('Profile saved.'); setRefresh((value) => value + 1);
      } else {
        const { data } = await api.post<TeamProfile>('/team-profiles', { clubId: Number(clubId), suffix, displayName });
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

  if (loading) return <p role="status" className="skin season-shell py-5">Loading team history…</p>;

  if (!id) {
    if (creating && mayManage) return <div className="skin season-shell season-shell-narrow py-5">
      <button type="button" className="mg-text-link mb-5 inline-flex min-h-11 items-center gap-1" onClick={() => setCreating(false)}><ChevronLeft className="h-4 w-4" />Back to team profiles</button>
      <header className="season-heading"><p className="season-kicker">Stable team identity</p><h1 className="mg-h1">Create a team profile</h1><p className="mg-meta mt-2">Use one profile for the same club team across different events.</p></header>
      {error && <div role="alert" className="mg-notice mb-4">{error}</div>}
      <form className="season-form" onSubmit={saveProfile}>
        <fieldset disabled={busy} className="season-form-section space-y-4"><legend className="season-form-legend">Team details</legend>
          <label className="block font-semibold">Club<select className="input mt-1" value={clubId} onChange={(event) => setClubId(event.target.value)} required><option value="">Choose a club</option>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label>
          <div className="grid gap-4 sm:grid-cols-[140px_1fr]"><label className="block font-semibold">Suffix<input className="input mt-1" value={suffix} onChange={(event) => setSuffix(event.target.value)} maxLength={10} required /></label><label className="block font-semibold">Display name<input className="input mt-1" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={200} required /></label></div>
        </fieldset>
        <div className="flex flex-wrap gap-2"><button className="mg-btn mg-btn-primary" disabled={busy}><Plus className="h-4 w-4" />{busy ? 'Creating…' : 'Create profile'}</button><button type="button" className="mg-btn mg-btn-secondary" onClick={() => setCreating(false)} disabled={busy}>Cancel</button></div>
      </form>
    </div>;

    return <div className="skin season-shell py-5">
      <header className="season-index-header"><div><p className="season-kicker">Across every event</p><h1 className="mg-h1">Team profiles</h1><p className="mg-meta mt-2">Published results stay together when the same team competes at more than one event.</p></div>{mayManage && <button className="mg-btn mg-btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New profile</button>}</header>
      {error && <div role="alert" className="mg-notice mb-4">{error} <button type="button" className="mg-text-link min-h-11" onClick={() => { setLoading(true); setError(null); setRefresh((value) => value + 1); }}>Try again</button></div>}
      {!error && (profiles?.length ? <ul className="season-list" aria-label="Team profiles">{profiles.map((profile) => <li key={profile.id}><Link to={`/team-profiles/${profile.id}`} className="season-list-row team-profile-row"><span className="season-list-main"><strong>{profile.displayName}</strong><span>{profile.clubName} · suffix {profile.suffix}</span></span><span className="season-list-rule">View history</span><ChevronRight className="h-5 w-5" /></Link></li>)}</ul> : <div className="season-empty"><h2>No team profiles yet</h2><p>Profiles will appear here once an organiser creates them.</p></div>)}
    </div>;
  }

  if (!history) return <div className="skin season-shell py-5" role="alert"><p className="mg-notice">{error ?? 'Team profile not found.'} {error && <button type="button" className="mg-text-link min-h-11" onClick={() => { setLoading(true); setError(null); setRefresh((value) => value + 1); }}>Try again</button>}</p><Link className="mg-text-link mt-3 inline-flex min-h-11 items-center" to="/team-profiles">Back to profiles</Link></div>;
  const profile = history.profile;
  const identityLocked = history.eventTeams.length > 0 || history.publishedResults.length > 0;
  const tabs: { id: ProfileTab; label: string }[] = [
    { id: 'history', label: 'History' },
    ...(canManageProfile ? [{ id: 'edit' as const, label: 'Edit profile' }, { id: 'link' as const, label: 'Link event' }] : []),
  ];

  return <div className="skin season-shell py-5">
    <Link to="/team-profiles" className="mg-text-link mb-4 inline-flex min-h-11 items-center gap-1"><ChevronLeft className="h-4 w-4" />Team profiles</Link>
    <header className="season-heading"><p className="season-kicker">Team record</p><h1 className="mg-h1">{profile.displayName}</h1><p className="mg-meta mt-2">{profile.clubName} · suffix {profile.suffix}</p></header>
    {error && <div role="alert" className="mg-notice mb-4">{error}</div>}
    {success && <div role="status" className="mg-notice mb-4">{success}</div>}
    <nav className="season-tabs" aria-label="Team profile sections">{tabs.map((item) => <button key={item.id} type="button" className="season-tab" aria-pressed={tab === item.id} onClick={() => { setTab(item.id); setError(null); setSuccess(null); }}>{item.label}</button>)}</nav>

    {tab === 'history' && <section className="season-panel" aria-labelledby="profile-history-title">
      <div className="season-panel-heading"><div><h2 id="profile-history-title" className="mg-h1 mg-h1-sm">Published season history</h2><p className="mg-meta mt-1">The latest published result from each season round.</p></div></div>
      {history.publishedResults.length === 0 ? <div className="season-empty"><h2>No published results</h2><p>This team hasn’t appeared in a published season round yet.</p></div> : <div className="season-table-wrap"><table className="season-table text-sm"><thead><tr><th className="text-left">Season</th><th className="text-left">Event</th><th className="text-center">Pos.</th><th className="text-center">Event pts</th><th className="text-center">Season pts</th></tr></thead><tbody>{history.publishedResults.map((result) => <tr key={`${result.roundId}-${result.publicationVersion}`}><td><Link className="mg-text-link font-semibold" to={`/seasons/${result.seasonId}`}>{result.seasonTitle}</Link><span className="mg-meta block">{result.seasonYear} · R{result.roundOrder}</span></td><td>{result.competitionName}<span className="mg-meta block">{date(result.competitionDate)}</span></td><td className="text-center font-bold">{result.eventRank}</td><td className="text-center">{result.eventPoints}</td><td className="text-center font-bold">{result.seasonPoints}</td></tr>)}</tbody></table></div>}
      <div className="mt-8"><h2 className="mg-h1 mg-h1-sm">Linked events</h2>{history.eventTeams.length === 0 ? <p className="mg-meta mt-2">No event teams are linked yet.</p> : <ul className="profile-event-list mt-3">{history.eventTeams.map((item) => <li key={item.id}><span><strong>{item.competitionName}</strong><span>{item.teamName}</span></span><time dateTime={item.linkedAt}>Linked {date(item.linkedAt)}</time></li>)}</ul>}</div>
    </section>}

    {tab === 'edit' && canManageProfile && <section className="season-panel"><h2 className="mg-h1 mg-h1-sm mb-1">Edit profile</h2><p className="mg-meta mb-5">Once this profile is linked, the club and suffix stay fixed. You can still correct the display name.</p>
      <form className="season-form" onSubmit={saveProfile}><fieldset disabled={busy} className="season-form-section space-y-4"><legend className="sr-only">Profile details</legend><label className="block font-semibold">Club<select className="input mt-1" value={clubId} onChange={(event) => setClubId(event.target.value)} required disabled={identityLocked}>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label><div className="grid gap-4 sm:grid-cols-[140px_1fr]"><label className="block font-semibold">Suffix<input className="input mt-1" value={suffix} onChange={(event) => setSuffix(event.target.value)} maxLength={10} required disabled={identityLocked} /></label><label className="block font-semibold">Display name<input className="input mt-1" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={200} required /></label></div></fieldset><button className="mg-btn mg-btn-primary" disabled={busy}><Save className="h-4 w-4" />{busy ? 'Saving…' : 'Save profile'}</button></form>
    </section>}

    {tab === 'link' && canManageProfile && <section className="season-panel"><h2 className="mg-h1 mg-h1-sm mb-1">Link an event team</h2><p className="mg-meta mb-5">Choose the event team yourself. The system won’t match teams by name.</p>
      <form className="season-form" onSubmit={linkTeam}><fieldset disabled={busy} className="season-form-section space-y-4"><legend className="sr-only">Event team link</legend><label className="block font-semibold">Competition<select className="input mt-1" value={competitionId} onChange={(event) => chooseCompetition(event.target.value)} required><option value="">Choose a competition</option>{competitions.map((item) => <option key={item.id} value={item.id}>{item.name} · {date(item.startDate)}</option>)}</select></label><label className="block font-semibold">Event team<select className="input mt-1" value={teamId} onChange={(event) => setTeamId(event.target.value)} required disabled={!competition}><option value="">Choose the matching team</option>{matchingTeams.map((team) => <option key={team.id} value={team.id}>{team.displayName}</option>)}</select></label>{competition && matchingTeams.length === 0 && <p className="mg-meta">There’s no unlinked team with this profile’s club and suffix in that competition.</p>}</fieldset><button className="mg-btn mg-btn-primary" disabled={busy || !teamId}><Link2 className="h-4 w-4" />{busy ? 'Linking…' : 'Link event team'}</button></form>
    </section>}
  </div>;
}
