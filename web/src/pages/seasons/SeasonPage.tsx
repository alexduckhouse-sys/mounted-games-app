import { useEffect, useState, type FormEvent } from 'react';
import { ChevronLeft, Plus } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { SectionFormatLabel, type CompetitionDetail, type CompetitionSummary } from '../../types';
import { SeasonSettingsForm } from './SeasonSettingsForm';
import { seasonError, type PublicationView, type SeasonRoundView, type SeasonView, type StandingsView } from './seasonViewTypes';
import './seasonViews.css';

type SeasonTab = 'standings' | 'rounds' | 'settings';

export function SeasonPage() {
  const { seasonId } = useParams();
  const { user, editorMode } = useAuth();
  return <SeasonDetail key={`${seasonId}:${user?.id ?? 'public'}:${editorMode}`} id={seasonId ?? ''} />;
}

function SeasonDetail({ id }: { id: string }) {
  const { hasRole, canEdit } = useAuth();
  const [data, setData] = useState<{ season: SeasonView; table: StandingsView } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<SeasonTab>('standings');
  const [addingRound, setAddingRound] = useState(false);
  const [openRoundId, setOpenRoundId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.get<SeasonView>(`/seasons/${id}`, { signal: controller.signal }),
      api.get<StandingsView>(`/seasons/${id}/standings`, { signal: controller.signal }),
    ]).then(([season, table]) => {
      if (!controller.signal.aborted) { setData({ season: season.data, table: table.data }); setError(''); }
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(seasonError(reason, 'This season couldn’t be loaded. Check your connection and try again.'));
    });
    return () => controller.abort();
  }, [id, attempt]);

  const reload = () => setAttempt((value) => value + 1);
  const pageCanManage = !!data?.season.canManage && (!hasRole('Admin') || canEdit());
  if (!data) return <div className="skin season-shell py-5"><Link className="mg-text-link" to="/seasons">All seasons</Link>{error ? <p role="alert" className="mg-notice mt-4">{error} <button className="mg-text-link min-h-11" onClick={reload}>Try again</button></p> : <p role="status" className="mt-4">Loading season…</p>}</div>;

  const { season, table } = data;
  const canManage = pageCanManage;
  const included = season.rounds.filter((round) => round.isIncluded);
  const stale = season.rounds.some((round) => round.publishedVersion && !round.publicationIsCurrent);
  const tabs: { id: SeasonTab; label: string }[] = [
    { id: 'standings', label: 'Standings' },
    { id: 'rounds', label: `Rounds (${season.rounds.length})` },
    ...(canManage ? [{ id: 'settings' as const, label: 'Settings' }] : []),
  ];

  return <div className="skin season-shell py-5">
    <Link className="mg-text-link mb-4 inline-flex min-h-11 items-center gap-1" to="/seasons"><ChevronLeft className="h-4 w-4" />All seasons</Link>
    <header className="season-heading">
      <p className="season-kicker">{season.year} season</p>
      <h1 className="mg-h1">{season.title}</h1>
      <p className="mg-meta mt-2">{SectionFormatLabel[season.format]} · {season.ageGroup} · {season.bestResultsToCount ? `Best ${season.bestResultsToCount} results count` : 'All included rounds count'}</p>
    </header>

    {error && <p role="alert" className="mg-notice mb-4">{error} <button className="mg-text-link min-h-11" onClick={reload}>Try again</button></p>}
    <nav className="season-tabs" aria-label="Season sections">
      {tabs.map((item) => <button key={item.id} type="button" className="season-tab" aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}
    </nav>

    {tab === 'standings' && <section className="season-panel" aria-labelledby="season-standings-title">
      <div className="season-panel-heading"><div><h2 id="season-standings-title" className="mg-h1 mg-h1-sm">Standings</h2><p className="mg-meta mt-1">Published round points only. Tied teams share a place.</p></div></div>
      {stale && <p className="mg-notice mb-4">A result or points rule has changed since publication. The table stays on the published version until the organiser publishes again.</p>}
      {!table.standings.length ? <div className="season-empty"><h2>No standings yet</h2><p>Results will appear after the first round is published.</p></div> : <div className="season-table-wrap"><table className="season-table season-standings-table text-sm">
        <caption className="sr-only">Season standings. Crossed-out round points do not count towards the total.</caption>
        <thead><tr className="text-left"><th scope="col" className="season-rank-col">Pos.</th><th scope="col" className="season-team-col">Team</th>{included.map((round) => <th scope="col" key={round.id} className="text-center"><abbr className="no-underline" title={`${round.competitionName} · ${round.sectionName}`}>R{round.orderIndex}</abbr></th>)}<th scope="col" className="text-right">Points</th></tr></thead>
        <tbody>{table.standings.map((row) => <tr key={row.teamProfileId}>
          <td className="season-rank-col mg-display text-xl font-bold">{table.standings.filter((team) => team.rank === row.rank).length > 1 ? `=${row.rank}` : row.rank}</td>
          <th scope="row" className="season-team-col min-w-32 text-left"><Link className="mg-text-link" to={`/team-profiles/${row.teamProfileId}`}>{row.teamName}</Link><span className="mg-meta block font-normal">{row.clubName}</span></th>
          {included.map((round) => { const score = row.rounds.find((item) => item.roundId === round.id); return <td key={round.id} className="text-center tabular-nums">{score ? <span className={score.counted ? '' : 'line-through opacity-60'}>{score.seasonPoints}{!score.counted && <span className="sr-only">, not counted</span>}</span> : <span aria-label="No published result">—</span>}</td>; })}
          <td className="mg-display text-right text-2xl font-bold tabular-nums">{row.totalPoints}</td>
        </tr>)}</tbody>
      </table></div>}
      {season.bestResultsToCount && table.standings.length > 0 && <p className="mg-meta mt-3">Crossed-out scores fall outside each team’s best {season.bestResultsToCount} results.</p>}
    </section>}

    {tab === 'rounds' && <section className="season-panel" aria-labelledby="season-rounds-title">
      <div className="season-panel-heading">
        <div><h2 id="season-rounds-title" className="mg-h1 mg-h1-sm">Round history</h2><p className="mg-meta mt-1">Open a round to see its published versions{canManage ? ' or publish updated results' : ''}.</p></div>
        {canManage && <button type="button" className="mg-btn mg-btn-primary" aria-expanded={addingRound} onClick={() => setAddingRound((open) => !open)}><Plus className="h-4 w-4" />{addingRound ? 'Close add round' : 'Add round'}</button>}
      </div>
      {addingRound && canManage && <div className="mb-6"><AddRound season={season} onChanged={() => { setAddingRound(false); reload(); }} /></div>}
      {!season.rounds.length ? <div className="season-empty"><h2>No rounds added</h2><p>The organiser hasn’t linked an event section to this season yet.</p></div> : <div className="season-rounds">
        {season.rounds.map((round) => <Round key={`${round.id}:${round.publishedVersion}:${round.isIncluded}`} seasonId={id} round={round} canManage={canManage} expanded={openRoundId === round.id} onToggle={() => setOpenRoundId((current) => current === round.id ? null : round.id)} onChanged={reload} />)}
      </div>}
    </section>}

    {tab === 'settings' && canManage && <section className="season-panel" aria-labelledby="season-settings-title">
      <div className="season-panel-heading"><div><h2 id="season-settings-title" className="mg-h1 mg-h1-sm">Season settings</h2><p className="mg-meta mt-1">Division and scoring rules apply across every round.</p></div></div>
      <SeasonSettingsForm key={JSON.stringify(season.placePoints) + season.title + season.bestResultsToCount} value={season} onCancel={() => setTab('standings')} onSave={async (settings) => { await api.put(`/seasons/${id}`, settings); reload(); setTab('standings'); }} />
      <p className="mg-meta mt-5">Need to connect a team across events? <Link className="mg-text-link" to="/team-profiles">Open team profiles</Link>.</p>
    </section>}
  </div>;
}

function AddRound({ season, onChanged }: { season: SeasonView; onChanged: () => void }) {
  const { canOrganise } = useAuth();
  const [competitions, setCompetitions] = useState<CompetitionSummary[] | null>(null);
  const [competitionId, setCompetitionId] = useState('');
  const [detail, setDetail] = useState<CompetitionDetail | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [actionError, setActionError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listAttempt, setListAttempt] = useState(0);
  const [detailAttempt, setDetailAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api.get<CompetitionSummary[]>('/competitions', { params: { includeArchived: true }, signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setCompetitions(data);
    }).catch((reason) => { if (!controller.signal.aborted) setListError(seasonError(reason, 'Competitions couldn’t be loaded. Try again.')); });
    return () => controller.abort();
  }, [listAttempt]);

  useEffect(() => {
    if (!competitionId) return;
    const controller = new AbortController();
    api.get<CompetitionDetail>(`/competitions/${competitionId}`, { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setDetail(data);
    }).catch((reason) => { if (!controller.signal.aborted) setDetailError(seasonError(reason, 'The competition couldn’t be loaded. Try again.')); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [competitionId, detailAttempt]);

  const sections = detail && canOrganise(detail) ? detail.sections.filter((section) => section.format === season.format && section.ageGroup.trim().toLowerCase() === season.ageGroup.trim().toLowerCase() && !season.rounds.some((round) => round.competitionSectionId === section.id)) : [];
  function chooseCompetition(next: string) {
    setCompetitionId(next); setDetail(null); setSectionId(''); setDetailError(''); setActionError(''); setDetailLoading(!!next);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!sectionId) return;
    setBusy(true); setActionError('');
    try { await api.post(`/seasons/${season.id}/rounds`, { competitionSectionId: Number(sectionId) }); setSectionId(''); onChanged(); }
    catch (reason) { setActionError(seasonError(reason, 'This round couldn’t be added. Try again.')); }
    finally { setBusy(false); }
  }

  return <form className="season-form" onSubmit={submit}>
    <fieldset disabled={busy} className="season-form-section space-y-4">
      <legend className="season-form-legend">Add an event round</legend>
      <p className="mg-meta">Choose a matching section from a competition you organise.</p>
      {listError && <p role="alert" className="mg-notice">{listError} <button type="button" className="mg-text-link min-h-11" onClick={() => { setListError(''); setListAttempt((value) => value + 1); }}>Try again</button></p>}
      {actionError && <p role="alert" className="mg-notice">{actionError}</p>}
      <label className="block font-semibold">Competition<select className="input mt-1" required value={competitionId} onChange={(event) => chooseCompetition(event.target.value)}><option value="">{competitions ? 'Choose a competition' : 'Loading competitions…'}</option>{competitions?.map((competition) => <option key={competition.id} value={competition.id}>{competition.name} · {new Date(competition.startDate).getFullYear()}</option>)}</select></label>
      {competitionId && detailLoading && <p role="status">Loading sections…</p>}
      {detailError && <p role="alert" className="mg-notice">{detailError} <button type="button" className="mg-text-link min-h-11" onClick={() => { setDetailLoading(true); setDetailError(''); setDetailAttempt((value) => value + 1); }}>Try again</button></p>}
      {detail && (sections.length ? <label className="block font-semibold">Section<select className="input mt-1" required value={sectionId} onChange={(event) => setSectionId(event.target.value)}><option value="">Choose a section</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.displayName}</option>)}</select></label> : <p className="mg-meta">There isn’t a matching unlinked section in this competition.</p>)}
    </fieldset>
    <button className="mg-btn mg-btn-primary" disabled={busy || !sectionId}>{busy ? 'Adding round…' : 'Add round'}</button>
  </form>;
}

function Round({ seasonId, round, canManage, expanded, onToggle, onChanged }: { seasonId: string; round: SeasonRoundView; canManage: boolean; expanded: boolean; onToggle: () => void; onChanged: () => void }) {
  const [preview, setPreview] = useState<PublicationView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const base = `/seasons/${seasonId}/rounds/${round.id}`;

  async function act(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (reason) { setError(seasonError(reason, 'This change couldn’t be saved. Check your connection and try again.')); setPreview(null); }
    finally { setBusy(false); }
  }

  const publicationStatus = round.publishedVersion
    ? `Version ${round.publishedVersion}${round.publicationIsCurrent ? '' : ' needs review'}`
    : 'Not published';
  return <article className="season-round-row">
    <div className="season-round-summary">
      <span className="season-round-number" aria-label={`Round ${round.orderIndex}`}>{round.orderIndex}</span>
      <div><Link className="season-round-title" to={`/competitions/${round.competitionId}`}>{round.competitionName}</Link><p className="mg-meta mt-1">{new Date(round.competitionDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {round.sectionName}</p></div>
      <div className="season-status"><strong>{publicationStatus}</strong>{round.isIncluded ? 'Counts in standings' : 'Excluded from standings'}</div>
      <button type="button" className="mg-btn mg-btn-secondary" aria-expanded={expanded} onClick={onToggle}>{expanded ? 'Close round' : canManage ? 'Review round' : 'Round details'}</button>
    </div>
    {expanded && <div className="season-round-detail space-y-4">
      {error && <p role="alert" className="mg-notice">{error}</p>}{notice && <p role="status" className="mg-notice">{notice}</p>}
      {canManage && <div className="flex flex-wrap gap-2">
        <button className="mg-btn mg-btn-secondary" disabled={busy} onClick={() => void act(async () => { await api.put(`${base}/included`, { isIncluded: !round.isIncluded }); onChanged(); })}>{round.isIncluded ? 'Exclude round' : 'Include round'}</button>
        <button className="mg-btn mg-btn-primary" disabled={busy} onClick={() => void act(async () => { const { data } = await api.get<PublicationView>(`${base}/publication-preview`); setPreview(data); })}>{busy ? 'Checking results…' : 'Preview publication'}</button>
      </div>}
      {preview && canManage && <section className="space-y-3" aria-label="Publication preview">
        <div><h3 className="mg-h1 mg-h1-sm">Version {preview.nextVersion} preview</h3><p className="mg-meta mt-1">{preview.rankingBasis}. Ties share a place and HC teams are excluded.</p></div>
        <PublicationResults publication={preview} />
        <p className="mg-meta">Publishing adds a new version. Earlier versions remain available.</p>
        <button className="mg-btn mg-btn-primary" disabled={busy} onClick={() => void act(async () => { await api.post(`${base}/publications`, { sourceFingerprint: preview.sourceFingerprint, expectedVersion: preview.nextVersion }); setPreview(null); setNotice('Round results published.'); onChanged(); })}>{busy ? 'Publishing…' : `Publish version ${preview.nextVersion}`}</button>
      </section>}
      {round.publishedVersion ? <PublicationHistory base={base} latest={round.publishedVersion} /> : !canManage && <p className="mg-meta">There are no published results for this round.</p>}
    </div>}
  </article>;
}

function PublicationResults({ publication }: { publication: Pick<PublicationView, 'results'> }) {
  return <div className="season-table-wrap"><table className="season-table text-sm"><thead><tr><th className="text-left" scope="col">Pos.</th><th className="text-left" scope="col">Team</th><th className="text-right" scope="col">Event points</th><th className="text-right" scope="col">Season points</th></tr></thead><tbody>{publication.results.map((row) => <tr key={row.teamProfileId}><td>{row.eventRank}</td><th className="text-left" scope="row">{row.teamName}</th><td className="text-right">{row.eventPoints}</td><td className="text-right font-bold">{row.seasonPoints}</td></tr>)}</tbody></table>{!publication.results.length && <p className="py-3">No eligible teams in this publication.</p>}</div>;
}

function PublicationHistory({ base, latest }: { base: string; latest: number }) {
  const [version, setVersion] = useState(latest);
  const [publication, setPublication] = useState<(PublicationView & { version: number; publishedAt: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <details><summary className="min-h-11 cursor-pointer py-2 font-semibold">Published versions</summary><form className="space-y-3 pt-2" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { const { data } = await api.get<PublicationView & { version: number; publishedAt: string }>(`${base}/publications/${version}`); setPublication(data); }
    catch (reason) { setError(seasonError(reason, 'This version couldn’t be loaded. Try again.')); }
    finally { setBusy(false); }
  }}>
    <div className="flex flex-wrap items-end gap-2"><label className="font-semibold">Version<input className="input mt-1 !w-24" type="number" min={1} max={latest} required value={version} onChange={(event) => setVersion(Number(event.target.value))} disabled={busy} /></label><button className="mg-btn mg-btn-secondary" disabled={busy}>{busy ? 'Loading…' : 'View version'}</button></div>
    {error && <p role="alert" className="mg-notice">{error}</p>}
    {publication && <><p className="mg-meta">Version {publication.version} · published {new Date(publication.publishedAt).toLocaleString('en-GB')}</p><p className="mg-meta">{publication.rankingBasis}</p><PublicationResults publication={publication} /></>}
  </form></details>;
}
