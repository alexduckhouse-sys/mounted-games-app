import { useEffect, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { SectionFormatLabel, type CompetitionDetail, type CompetitionSummary } from '../../types';
import { Chevron, RefineHeader, RefineList, RefineNote, RefinePage, RefineSection, RefineStatus, type RefineTab } from '../refine/Refine';
import { lastPublishedRound, positionLabels, roundStatus, shortDate } from './seasonModel';
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
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<{ season: SeasonView; table: StandingsView } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
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
  if (!data) return <RefinePage>
    <RefineHeader back="/seasons" backLabel="All seasons" context="Seasons" title="Season" />
    {error ? <p role="alert" className="mg-notice sv-msg">{error} <button className="mg-text-link min-h-11" onClick={reload}>Try again</button></p> : <p role="status" className="rf-note">Loading season…</p>}
  </RefinePage>;

  const { season, table } = data;
  const canManage = pageCanManage;
  const requested = params.get('tab');
  const tab: SeasonTab = requested === 'rounds' ? 'rounds' : requested === 'settings' && canManage ? 'settings' : 'standings';
  const tabLink = (next: SeasonTab) => next === 'standings' ? '?' : `?tab=${next}`;
  const tabs: RefineTab[] = ([['standings', 'Standings'], ['rounds', 'Rounds'], ...(canManage ? [['settings', 'Settings']] : [])] as [SeasonTab, string][])
    .map(([key, label]) => ({ label, to: tabLink(key), active: tab === key }));

  return <RefinePage>
    <RefineHeader
      back="/seasons" backLabel="All seasons" context={`Season ${season.year}`} title={season.title}
      tabs={tabs} tabsLabel="Season sections"
      actions={tab === 'rounds' && canManage ? <button type="button" className="rf-btn" aria-expanded={addingRound} onClick={() => setAddingRound((open) => !open)}><Plus className="h-4 w-4" aria-hidden="true" />{addingRound ? 'Close add round' : 'Add round'}</button> : undefined}
    />
    {error && <p role="alert" className="mg-notice sv-msg">{error} <button className="mg-text-link min-h-11" onClick={reload}>Try again</button></p>}
    {tab === 'standings' && <Standings season={season} table={table} />}
    {tab === 'rounds' && <>
      {addingRound && canManage && <AddRound season={season} onChanged={() => { setAddingRound(false); reload(); }} />}
      <RoundsList season={season} id={id} canManage={canManage} openRoundId={openRoundId} setOpenRoundId={setOpenRoundId} onChanged={reload} />
    </>}
    {tab === 'settings' && canManage && <>
      <SeasonSettingsForm key={JSON.stringify(season.placePoints) + season.title + season.bestResultsToCount} value={season} onSave={async (settings) => { await api.put(`/seasons/${id}`, settings); reload(); setParams({}); }} />
      <p className="rf-note">Need to connect a team across events? <Link to="/team-profiles">Open team profiles</Link>.</p>
    </>}
  </RefinePage>;
}

function Standings({ season, table }: { season: SeasonView; table: StandingsView }) {
  const included = season.rounds.filter((round) => round.isIncluded);
  const stale = season.rounds.some((round) => round.publishedVersion && !round.publicationIsCurrent);
  const labels = positionLabels(table.standings);
  const latest = lastPublishedRound(season.rounds);
  const best = season.bestResultsToCount;
  const notes = [
    best ? `Best ${best} of ${included.length} ${included.length === 1 ? 'round' : 'rounds'}` : `All ${included.length} included ${included.length === 1 ? 'round counts' : 'rounds count'}`,
    '= shared place',
    latest ? `after R${latest.orderIndex}, ${shortDate(latest.competitionDate, false)}` : null,
  ].filter(Boolean).join(' · ');
  return <>
    <div className="sv-filters">
      <label className="rf-fld"><span className="sr-only">Age section</span><select disabled aria-label="Age section" title="Each season covers one age section" value={season.ageGroup}><option>{season.ageGroup}</option></select></label>
      <label className="rf-fld"><span className="sr-only">Format</span><select disabled aria-label="Format" title="Each season covers one format" value={season.format}><option value={season.format}>{SectionFormatLabel[season.format]}</option></select></label>
    </div>
    {stale && <p className="mg-notice sv-msg">A result or points rule has changed since publication. The table stays on the published version until the organiser publishes again.</p>}
    {!table.standings.length ? <div className="sv-empty"><h2>No standings yet</h2><p>Results will appear after the first round is published.</p></div> : <>
      <div className="rf-table-wrap"><table className="rf-table sv-table">
        <caption className="sr-only">Season standings</caption>
        <thead><tr><th scope="col" className="sv-pos">Pos</th><th scope="col">Team</th><th scope="col" className="sv-mid">Rds</th><th scope="col">Pts</th></tr></thead>
        <tbody>{table.standings.map((row) => <tr key={row.teamProfileId}>
          <td className="rf-num">{labels.get(row.teamProfileId)}</td>
          <td><Link to={`/team-profiles/${row.teamProfileId}`}>{row.teamName}</Link>{row.clubName && !row.teamName.toLowerCase().includes(row.clubName.toLowerCase()) && <span className="sv-club">{row.clubName}</span>}</td>
          <td className="sv-mid">{row.rounds.length}</td>
          <td className="rf-num sv-end">{row.totalPoints}</td>
        </tr>)}</tbody>
      </table></div>
      <RefineNote>{notes}. Worked out from published results; not an official ranking unless the league says so.</RefineNote>
    </>}
  </>;
}

function RoundsList({ season, id, canManage, openRoundId, setOpenRoundId, onChanged }: { season: SeasonView; id: string; canManage: boolean; openRoundId: string | null; setOpenRoundId: (next: string | null | ((current: string | null) => string | null)) => void; onChanged: () => void }) {
  if (!season.rounds.length) return <div className="sv-empty"><h2>No rounds added</h2><p>The organiser hasn’t linked an event section to this season yet.</p></div>;
  const withResults = season.rounds.filter((round) => round.publishedVersion).length;
  const provisional = season.rounds.some((round) => round.isIncluded && round.publishedVersion && !round.publicationIsCurrent);
  return <>
    <RefineSection title={`${season.rounds.length} ${season.rounds.length === 1 ? 'round' : 'rounds'}`} meta={`${withResults} with results`} />
    <RefineList as="ol" label="Rounds">
      {season.rounds.map((round) => <Round key={`${round.id}:${round.publishedVersion}:${round.isIncluded}`} seasonId={id} round={round} canManage={canManage} expanded={openRoundId === round.id} onToggle={() => setOpenRoundId((current) => current === round.id ? null : round.id)} onChanged={onChanged} />)}
    </RefineList>
    {provisional && <RefineNote>Provisional results are included in standings and may still change.</RefineNote>}
  </>;
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

  return <form className="sv-add" onSubmit={submit}>
    <fieldset disabled={busy} className="sv-fieldset sv-stack">
      <legend className="rf-sec">Add an event round</legend>
      <p className="rf-note sv-flush">Choose a matching section from a competition you organise.</p>
      {listError && <p role="alert" className="mg-notice">{listError} <button type="button" className="mg-text-link min-h-11" onClick={() => { setListError(''); setListAttempt((value) => value + 1); }}>Try again</button></p>}
      {actionError && <p role="alert" className="mg-notice">{actionError}</p>}
      <label className="rf-fld">Competition<select required value={competitionId} onChange={(event) => chooseCompetition(event.target.value)}><option value="">{competitions ? 'Choose a competition' : 'Loading competitions…'}</option>{competitions?.map((competition) => <option key={competition.id} value={competition.id}>{competition.name} · {new Date(competition.startDate).getFullYear()}</option>)}</select></label>
      {competitionId && detailLoading && <p role="status" className="rf-note sv-flush">Loading sections…</p>}
      {detailError && <p role="alert" className="mg-notice">{detailError} <button type="button" className="mg-text-link min-h-11" onClick={() => { setDetailLoading(true); setDetailError(''); setDetailAttempt((value) => value + 1); }}>Try again</button></p>}
      {detail && (sections.length ? <label className="rf-fld">Section<select required value={sectionId} onChange={(event) => setSectionId(event.target.value)}><option value="">Choose a section</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.displayName}</option>)}</select></label> : <p className="rf-note sv-flush">There isn’t a matching unlinked section in this competition.</p>)}
    </fieldset>
    <button className="rf-btn rf-btn-primary" disabled={busy || !sectionId}>{busy ? 'Adding round…' : 'Add round'}</button>
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

  const status = roundStatus(round);
  const publicationStatus = round.publishedVersion
    ? `Version ${round.publishedVersion}${round.publicationIsCurrent ? '' : ' needs review'}`
    : 'Not published';
  return <li>
    <button type="button" className="rf-row" aria-expanded={expanded} onClick={onToggle}>
      <span className={`rf-num sv-rn ${round.isIncluded ? '' : 'sv-rn-dim'}`.trim()}><span className="sr-only">Round {round.orderIndex}</span><span aria-hidden="true">R{round.orderIndex}</span></span>
      <span className="rf-grow"><span className="rf-t1">{round.competitionName}</span><span className="rf-t2">{shortDate(round.competitionDate)} · {round.sectionName}</span></span>
      <RefineStatus tone={status.tone}>{status.label}</RefineStatus>
      <Chevron down />
    </button>
    {expanded && <div className="sv-round-detail">
      {error && <p role="alert" className="mg-notice">{error}</p>}{notice && <p role="status" className="mg-notice">{notice}</p>}
      <p className="rf-note sv-flush"><strong>{publicationStatus}</strong> · {round.isIncluded ? 'Counts in standings' : 'Excluded from standings'}. <Link className="sv-link" to={`/competitions/${round.competitionId}`}>Open {round.competitionName}</Link></p>
      {canManage && <div className="sv-actions">
        <button type="button" className="rf-btn" disabled={busy} onClick={() => void act(async () => { await api.put(`${base}/included`, { isIncluded: !round.isIncluded }); onChanged(); })}>{round.isIncluded ? 'Exclude round' : 'Include round'}</button>
        <button type="button" className="rf-btn rf-btn-primary" disabled={busy} onClick={() => void act(async () => { const { data } = await api.get<PublicationView>(`${base}/publication-preview`); setPreview(data); })}>{busy ? 'Checking results…' : 'Preview publication'}</button>
      </div>}
      {preview && canManage && <section className="sv-stack" aria-label="Publication preview">
        <div><h3 className="rf-sec">Version {preview.nextVersion} preview</h3><p className="rf-note sv-flush">{preview.rankingBasis}. Ties share a place and HC teams are excluded.</p></div>
        <PublicationResults publication={preview} />
        <p className="rf-note sv-flush">Publishing adds a new version. Earlier versions remain available.</p>
        <button type="button" className="rf-btn rf-btn-primary" disabled={busy} onClick={() => void act(async () => { await api.post(`${base}/publications`, { sourceFingerprint: preview.sourceFingerprint, expectedVersion: preview.nextVersion }); setPreview(null); setNotice('Round results published.'); onChanged(); })}>{busy ? 'Publishing…' : `Publish version ${preview.nextVersion}`}</button>
      </section>}
      {round.publishedVersion ? <PublicationHistory base={base} latest={round.publishedVersion} /> : !canManage && <p className="rf-note sv-flush">There are no published results for this round.</p>}
    </div>}
  </li>;
}

function PublicationResults({ publication }: { publication: Pick<PublicationView, 'results'> }) {
  return <div className="rf-table-wrap"><table className="rf-table sv-table"><thead><tr><th className="sv-pos" scope="col">Pos</th><th scope="col">Team</th><th scope="col" className="sv-mid">Event pts</th><th scope="col">Season pts</th></tr></thead><tbody>{publication.results.map((row) => <tr key={row.teamProfileId}><td className="rf-num">{row.eventRank}</td><th scope="row" className="sv-rowhead">{row.teamName}</th><td className="sv-mid">{row.eventPoints}</td><td className="rf-num sv-end">{row.seasonPoints}</td></tr>)}</tbody></table>{!publication.results.length && <p className="rf-note" style={{ paddingInline: 16 }}>No eligible teams in this publication.</p>}</div>;
}

function PublicationHistory({ base, latest }: { base: string; latest: number }) {
  const [version, setVersion] = useState(latest);
  const [publication, setPublication] = useState<(PublicationView & { version: number; publishedAt: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <details className="sv-versions"><summary>Published versions</summary><form className="sv-versions-form" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { const { data } = await api.get<PublicationView & { version: number; publishedAt: string }>(`${base}/publications/${version}`); setPublication(data); }
    catch (reason) { setError(seasonError(reason, 'This version couldn’t be loaded. Try again.')); }
    finally { setBusy(false); }
  }}>
    <div className="sv-versions-pick"><label className="rf-fld">Version<input type="number" min={1} max={latest} required value={version} onChange={(event) => setVersion(Number(event.target.value))} disabled={busy} /></label><button className="rf-btn" disabled={busy}>{busy ? 'Loading…' : 'View version'}</button></div>
    {error && <p role="alert" className="mg-notice">{error}</p>}
    {publication && <><p className="rf-note sv-flush">Version {publication.version} · published {new Date(publication.publishedAt).toLocaleString('en-GB')}</p><p className="rf-note sv-flush">{publication.rankingBasis}</p><PublicationResults publication={publication} /></>}
  </form></details>;
}
