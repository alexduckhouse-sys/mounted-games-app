import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { Notice } from '../../components/Notice';
import { PageProblem } from '../../components/PageProblem';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../auth/AuthContext';
import { sectionFormatText } from '../../lib/sectionFormatText';
import { type CompetitionDetail, type CompetitionSummary } from '../../types';
import { Chevron, RefineList, RefineNote, RefinePage, RefineSection, RefineStatus } from '../refine/Refine';
import { filterStandingsByDivision, positionLabels, teamNameForAge, roundDivision, roundStatus, seasonDivisions, shortDate } from './seasonModel';
import { SeasonSettingsForm } from './SeasonSettingsForm';
import { EmbedCard } from '../competition/EmbedCard';
import { seasonError, type PublicationView, type SeasonRoundView, type SeasonView, type StandingsView } from './seasonViewTypes';
import './seasonViews.css';
import { SelectField } from '../../components/SelectField';
import { NumberField } from '../../components/NumberField';
import { Sheet } from '../../components/Sheet';
import { confirmDialog } from '../../components/ConfirmDialog';
import { useLanguage, useT } from '../../i18n/LanguageContext';
import { ChevronDown } from 'lucide-react';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { AddBar } from '../admin/creator/controls';
import '../../components/sitePages.css';
import '../../components/filterKit.css';

type SeasonTab = 'standings' | 'rounds' | 'settings';

export function SeasonPage() {
  const { seasonId } = useParams();
  const { user } = useAuth();
  return <SeasonDetail key={`${seasonId}:${user?.id ?? 'public'}`} id={seasonId ?? ''} />;
}

function SeasonDetail({ id }: { id: string }) {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<{ season: SeasonView; table: StandingsView } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [addingRound, setAddingRound] = useState(false);
  const [openRoundId, setOpenRoundId] = useState<string | null>(null);
  usePageHeader({ title: data?.season.title ?? t('site.seasons.season'), subtitle: data ? t('site.seasons.seasonYear', { year: data.season.year }) : undefined, plain: true, backTo: '/seasons', backLabel: t('site.seasons.all') });

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.get<SeasonView>(`/seasons/${id}`, { signal: controller.signal }),
      api.get<StandingsView>(`/seasons/${id}/standings`, { signal: controller.signal }),
    ]).then(([season, table]) => {
      if (!controller.signal.aborted) { setData({ season: season.data, table: table.data }); setError(''); }
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(seasonError(reason, t('site.seasons.seasonLoadFailed')));
    });
    return () => controller.abort();
  }, [id, attempt, t]);

  const reload = () => setAttempt((value) => value + 1);
  const pageCanManage = !!data?.season.canManage;
  if (!data) return <RefinePage>
    {error ? <PageProblem title={t('site.seasons.seasonLoadTitle')} primaryLabel={t('common.tryAgain')} onPrimary={reload}>{error}</PageProblem> : <p role="status" className="sp-note">{t('site.seasons.loadingOne')}</p>}
  </RefinePage>;

  const { season, table } = data;
  const canManage = pageCanManage;
  const requested = params.get('tab');
  const tab: SeasonTab = requested === 'rounds' ? 'rounds' : requested === 'settings' && canManage ? 'settings' : 'standings';
  const tabLink = (next: SeasonTab) => next === 'standings' ? '?' : `?tab=${next}`;
  const tabs = ([['standings', t('site.seasons.standings')], ['rounds', t('site.seasons.roundsTab')], ...(canManage ? [['settings', t('site.seasons.settings')]] : [])] as [SeasonTab, string][]);

  return <RefinePage>
    <h1 className="sr-only">{season.title}</h1>
    <nav className="sp-seg" aria-label={t('site.seasons.sections')}>
      {tabs.map(([key, label]) => <Link key={key} to={tabLink(key)} aria-current={tab === key ? 'page' : undefined}>{label}</Link>)}
    </nav>
    {error && <Notice className="sv-msg" actionLabel={t('common.tryAgain')} onAction={reload}>{error}</Notice>}
    <div key={tab} className="mg-settle">
    {tab === 'standings' && <Standings season={season} table={table} canManage={canManage} />}
    {tab === 'rounds' && <>
      {canManage && <div className="sp-gap"><AddBar onClick={() => setAddingRound((open) => !open)}>{addingRound ? 'Close add round' : 'Add a round'}</AddBar></div>}
      {addingRound && canManage && <AddRound season={season} onChanged={() => { setAddingRound(false); reload(); }} />}
      <RoundsList season={season} id={id} canManage={canManage} openRoundId={openRoundId} setOpenRoundId={setOpenRoundId} onChanged={reload} />
    </>}
    {tab === 'settings' && canManage && <>
      <SeasonSettingsForm key={JSON.stringify(season.placePoints) + season.title + season.bestResultsToCount} value={season} onSave={async (settings) => { await api.put(`/seasons/${id}`, settings); reload(); setParams({}); }} />
      <p className="rf-note">Need to connect a team across events? <Link to="/team-profiles">Open team profiles</Link>.</p>
      <EmbedCard kind="season" seasonId={id} title={season.title} />
    </>}
    </div>
  </RefinePage>;
}

function Standings({ season, table, canManage }: { season: SeasonView; table: StandingsView; canManage: boolean }) {
  const t = useT();
  const formats = [...new Set(season.rounds.filter((round) => round.isIncluded).map((round) => round.format ?? season.format))];
  const [selectedFormat, setSelectedFormat] = useState(season.format);
  const activeFormat = formats.includes(selectedFormat) ? selectedFormat : formats[0] ?? season.format;
  const formatRounds = season.rounds.filter((round) => (round.format ?? season.format) === activeFormat);
  const divisions = seasonDivisions(formatRounds, season.ageGroup);
  const hasMultipleDivisions = divisions.length > 1;
  const [selectedDivision, setSelectedDivision] = useState<string>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const activeDivision = hasMultipleDivisions && divisions.includes(selectedDivision) ? selectedDivision : 'all';
  const divisionRounds = formatRounds.filter((round) => activeDivision === 'all' || roundDivision(round, season.ageGroup) === activeDivision);
  const included = divisionRounds.filter((round) => round.isIncluded);
  const publishedRounds = [...included].filter((round) => round.publishedVersion != null).sort((a, b) => a.orderIndex - b.orderIndex);
  const visibleStandings = filterStandingsByDivision(season, table.standings, activeDivision, activeFormat);
  const stale = season.rounds.some((round) => round.publishedVersion && !round.publicationIsCurrent);
  const labels = positionLabels(visibleStandings);
  const ageOptions = hasMultipleDivisions
    ? [{ value: 'all', label: t('site.seasons.allAgeGroups') }, ...divisions.map((div) => ({ value: div, label: div }))]
    : [{ value: 'all', label: season.ageGroup }];
  const formatOptions = (formats.length ? formats : [activeFormat]).map((format) => ({ value: String(format), label: sectionFormatText(format, t) }));
  const ageLabel = ageOptions.find((option) => option.value === activeDivision)?.label ?? season.ageGroup;
  const formatLabel = sectionFormatText(activeFormat, t);
  const changeable = hasMultipleDivisions || formats.length > 1;
  return <>
    <button type="button" className="fk-where sp-gap" disabled={!changeable} aria-haspopup={changeable ? 'dialog' : undefined}
      aria-label={changeable ? t('site.seasons.changeAria', { age: ageLabel, format: formatLabel }) : `${ageLabel}, ${formatLabel}`} onClick={() => setSheetOpen(true)}>
      <span>{ageLabel}<small>· {formatLabel}</small></span>
      {changeable && <ChevronDown aria-hidden="true" className="h-[18px] w-[18px] shrink-0" strokeWidth={2.2} />}
    </button>
    {sheetOpen && changeable && (
      <Sheet title={t('site.seasons.sheetTitle')} className="fk-sheet" onClose={() => setSheetOpen(false)}>
        {({ close }) => (
          <>
            {hasMultipleDivisions && (
              <div className="fk-group" role="group" aria-label={t('site.seasons.ageGroup')}>
                <span className="fk-label" aria-hidden="true">{t('site.seasons.ageGroup')}</span>
                <div className="fk-tiles">
                  {ageOptions.map((option) => (
                    <button key={option.value} type="button" className="fk-tile" aria-pressed={activeDivision === option.value} onClick={() => setSelectedDivision(option.value)}>
                      <strong>{option.label}</strong>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {formats.length > 1 && (
              <div className="fk-group" role="group" aria-label={t('site.seasons.show')}>
                <span className="fk-label" aria-hidden="true">{t('site.seasons.show')}</span>
                <div className="fk-tiles">
                  {formatOptions.map((option) => (
                    <button key={option.value} type="button" className="fk-tile" aria-pressed={String(activeFormat) === option.value}
                      onClick={() => { setSelectedFormat(Number(option.value) as typeof activeFormat); setSelectedDivision('all'); }}>
                      <strong>{option.label}</strong>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button type="button" className="kit-pill kit-pill-fill fk-show" onClick={() => close()}>{t('common.done')}</button>
          </>
        )}
      </Sheet>
    )}
    {stale && canManage && <Notice className="sv-msg" role={null}>{t('site.seasons.stale')}</Notice>}
    {!visibleStandings.length ? <div className="sv-empty"><h2>{t('site.seasons.noStandings')}</h2><p>{t('site.seasons.noStandingsBody')}</p></div> : <>
      <div className="rf-table-wrap sp-gap"><table className="rf-table sv-table sv-standings">
        <caption className="sr-only">{t('site.seasons.caption')}</caption>
        <thead>
          <tr>
            <th scope="col" className="sv-pos"><span className="sr-only">{t('site.seasons.position')}</span></th>
            <th scope="col">{activeFormat === 1 ? t('site.stats.kind.rider') : t('site.stats.kind.team')}</th>
            {publishedRounds.map((round) => (
              <th key={round.id} scope="col" className="sv-mid" title={round.competitionName}>R{round.orderIndex}</th>
            ))}
            <th scope="col">{t('site.seasons.pts')}</th>
          </tr>
        </thead>
        <tbody>{visibleStandings.map((row) => <tr key={row.teamProfileId}>
          <td className="rf-num">{labels.get(row.teamProfileId)}</td>
          <td><Link to={`/team-profiles/${row.teamProfileId}`} className="sv-team">{teamNameForAge(row.teamName, ageLabel)}</Link></td>
          {publishedRounds.map((round) => {
            const cell = row.rounds.find((r) => r.roundId === round.id);
            if (!cell) return <td key={round.id} className="sv-mid sv-dim">–</td>;
            if (!cell.counted) {
              return <td key={round.id} className="sv-mid"><span className="sv-struck line-through opacity-55" title={t('site.seasons.dropped')}>{cell.seasonPoints}</span></td>;
            }
            return <td key={round.id} className="sv-mid">{cell.seasonPoints}</td>;
          })}
          <td className="rf-num sv-end">{row.totalPoints}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </>;
}

function RoundsList({ season, id, canManage, openRoundId, setOpenRoundId, onChanged }: { season: SeasonView; id: string; canManage: boolean; openRoundId: string | null; setOpenRoundId: (next: string | null | ((current: string | null) => string | null)) => void; onChanged: () => void }) {
  const t = useT();
  if (!season.rounds.length) return <div className="sv-empty"><h2>{t('site.seasons.noRounds')}</h2><p>{t('site.seasons.noRoundsBody')}</p></div>;
  const withResults = season.rounds.filter((round) => round.publishedVersion).length;
  const provisional = season.rounds.some((round) => round.isIncluded && round.publishedVersion && !round.publicationIsCurrent);
  return <>
    <RefineSection title={t('site.seasons.rounds', { count: season.rounds.length })} meta={t('site.seasons.withResults', { count: withResults })} />
    <RefineList as="ol" label={t('site.seasons.roundsTab')}>
      {season.rounds.map((round) => <Round key={`${round.id}:${round.publishedVersion}:${round.isIncluded}`} seasonId={id} round={round} canManage={canManage} expanded={openRoundId === round.id} onToggle={() => setOpenRoundId((current) => current === round.id ? null : round.id)} onChanged={onChanged} />)}
    </RefineList>
    {provisional && <RefineNote>{t('site.seasons.provisionalNote')}</RefineNote>}
  </>;
}

function AddRound({ season, onChanged }: { season: SeasonView; onChanged: () => void }) {
  const { canOrganise } = useAuth();
  const [competitions, setCompetitions] = useState<CompetitionSummary[] | null>(null);
  const [competitionId, setCompetitionId] = useState('');
  const [detail, setDetail] = useState<CompetitionDetail | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [multiplier, setMultiplier] = useState('1');
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
    }).catch((reason) => { if (!controller.signal.aborted) setListError(seasonError(reason, 'Competitions couldn’t be loaded. Check your signal and try again.')); });
    return () => controller.abort();
  }, [listAttempt]);

  useEffect(() => {
    if (!competitionId) return;
    const controller = new AbortController();
    api.get<CompetitionDetail>(`/competitions/${competitionId}`, { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setDetail(data);
    }).catch((reason) => { if (!controller.signal.aborted) setDetailError(seasonError(reason, 'The competition couldn’t be loaded. Check your signal and try again.')); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [competitionId, detailAttempt]);

  const sections = detail && canOrganise(detail) ? detail.sections.filter((section) => !season.rounds.some((round) => round.competitionSectionId === section.id)) : [];
  function chooseCompetition(next: string) {
    setCompetitionId(next); setDetail(null); setSectionId(''); setDetailError(''); setActionError(''); setDetailLoading(!!next);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!sectionId) return;
    setBusy(true); setActionError('');
    const mult = Number(multiplier);
    try {
      await api.post(`/seasons/${season.id}/rounds`, {
        competitionSectionId: Number(sectionId),
        ...(mult !== 1 ? { pointsMultiplier: mult } : {}),
      });
      setSectionId(''); setMultiplier('1'); onChanged();
    }
    catch (reason) { setActionError(seasonError(reason, 'This round couldn’t be added. Check your signal and try again.')); }
    finally { setBusy(false); }
  }

  return <form className="sv-add" onSubmit={submit}>
    <fieldset disabled={busy} className="sv-fieldset sv-stack">
      <legend className="rf-sec">Add an event round</legend>
      {listError && <Notice actionLabel="Try again" onAction={() => { setListError(''); setListAttempt((value) => value + 1); }}>{listError}</Notice>}
      {actionError && <Notice>{actionError}</Notice>}
      <label className="rf-fld">Competition<SelectField required value={competitionId} onChange={(event) => chooseCompetition(event.target.value)}><option value="">{competitions ? 'Choose a competition' : 'Loading competitions…'}</option>{competitions?.map((competition) => <option key={competition.id} value={competition.id}>{competition.name} · {new Date(competition.startDate).getFullYear()}</option>)}</SelectField></label>
      {competitionId && detailLoading && <p role="status" className="rf-note sv-flush">Loading sections…</p>}
      {detailError && <Notice actionLabel="Try again" onAction={() => { setDetailLoading(true); setDetailError(''); setDetailAttempt((value) => value + 1); }}>{detailError}</Notice>}
      {detail && (sections.length ? <>
        <label className="rf-fld">Section<SelectField required value={sectionId} onChange={(event) => setSectionId(event.target.value)}><option value="">Choose a section</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.displayName}</option>)}</SelectField></label>
        <label className="rf-fld">Points multiplier<SelectField value={multiplier} onChange={(event) => setMultiplier(event.target.value)}><option value="1">1× (standard)</option><option value="1.5">1.5× (major)</option><option value="2">2× (championship)</option></SelectField></label>
      </> : <p className="rf-note sv-flush">There isn’t an unlinked section in this competition.</p>)}
    </fieldset>
    <button className="rf-btn rf-btn-primary" disabled={busy || !sectionId}>{busy ? 'Adding round…' : 'Add round'}</button>
  </form>;
}

function Round({ seasonId, round, canManage, expanded, onToggle, onChanged }: { seasonId: string; round: SeasonRoundView; canManage: boolean; expanded: boolean; onToggle: () => void; onChanged: () => void }) {
  const [preview, setPreview] = useState<PublicationView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const t = useT();
  const { locale } = useLanguage();
  const base = `/seasons/${seasonId}/rounds/${round.id}`;
  const mult = round.pointsMultiplier && round.pointsMultiplier > 0 ? round.pointsMultiplier : 1;

  async function act(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); }
    catch (reason) { setError(seasonError(reason, 'This change couldn’t be saved. Check your signal and try again.')); setPreview(null); }
    finally { setBusy(false); }
  }

  async function remove() {
    const confirmed = await confirmDialog({
      title: t('competition.seasonRound.confirmTitle'),
      message: t(round.publishedVersion ? 'competition.seasonRound.confirmMessagePublished' : 'competition.seasonRound.confirmMessage', { name: round.competitionName }),
      confirmLabel: t('competition.seasonRound.confirmLabel'),
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true); setError('');
    try { await api.delete(base); onChanged(); }
    catch (reason) { setError(seasonError(reason, t('competition.seasonRound.error'))); setBusy(false); }
  }

  const status = roundStatus(round);
  const publicationStatus = round.publishedVersion
    ? `${t('site.seasons.version', { n: round.publishedVersion })}${round.publicationIsCurrent ? '' : ` ${t('site.seasons.needsReview')}`}`
    : t('site.seasons.notPublished');
  return <li>
    <button type="button" className="rf-row" aria-expanded={expanded} onClick={onToggle}>
      <span className={`rf-num sv-rn ${round.isIncluded ? '' : 'sv-rn-dim'}`.trim()}><span className="sr-only">{t('site.seasons.roundN', { n: round.orderIndex })}</span><span aria-hidden="true">R{round.orderIndex}</span></span>
      <span className="rf-grow"><span className="rf-t1">{round.competitionName}</span><span className="rf-t2">{shortDate(round.competitionDate, true, locale)} · {round.sectionName}{mult !== 1 ? ` · ${t('site.seasons.multPts', { n: mult })}` : ''}</span></span>
      <RefineStatus tone={status.tone}>{status.label}</RefineStatus>
      <Chevron down />
    </button>
    {expanded && <div className="sv-round-detail">
      {error && <Notice>{error}</Notice>}{toast.node}
      <p className="rf-note sv-flush"><strong>{publicationStatus}</strong> · {round.isIncluded ? t('site.seasons.counts') : t('site.seasons.excludedFrom')}{mult !== 1 ? ` · ${t('site.seasons.multPoints', { n: mult })}` : ''}. <Link className="sv-link" to={`/competitions/${round.competitionId}`}>{t('site.seasons.open', { name: round.competitionName })}</Link></p>
      {canManage && <div className="sv-actions">
        <label className="rf-fld">
          <span className="sr-only">Points multiplier</span>
          <SelectField
            aria-label="Points multiplier"
            disabled={busy}
            value={String(mult)}
            onChange={(event) => void act(async () => { await api.put(`${base}/multiplier`, { pointsMultiplier: Number(event.target.value) }); onChanged(); })}
          >
            <option value="1">1× (standard)</option>
            <option value="1.5">1.5× (major)</option>
            <option value="2">2× (championship)</option>
          </SelectField>
        </label>
        <button type="button" className="rf-btn" disabled={busy} onClick={() => void act(async () => { await api.put(`${base}/included`, { isIncluded: !round.isIncluded }); onChanged(); })}>{round.isIncluded ? 'Exclude round' : 'Include round'}</button>
        <button type="button" className="rf-btn rf-btn-primary" disabled={busy} onClick={() => void act(async () => { const { data } = await api.get<PublicationView>(`${base}/publication-preview`); setPreview(data); })}>{busy ? 'Checking results…' : 'Preview publication'}</button>
        <button type="button" className="rf-btn" disabled={busy} onClick={() => void remove()}>{t('competition.seasonRound.remove')}</button>
      </div>}
      {preview && canManage && <section className="sv-stack" aria-label="Publication preview">
        <div><h3 className="rf-sec">Version {preview.nextVersion} preview</h3><p className="rf-note sv-flush">{preview.rankingBasis}. Ties share a place and HC teams are excluded.</p></div>
        <PublicationResults publication={preview} />
        <button type="button" className="rf-btn rf-btn-primary" disabled={busy} onClick={() => void act(async () => { await api.post(`${base}/publications`, { sourceFingerprint: preview.sourceFingerprint, expectedVersion: preview.nextVersion }); setPreview(null); toast.show('Round results published'); onChanged(); })}>{busy ? 'Publishing…' : `Publish version ${preview.nextVersion}`}</button>
      </section>}
      {round.publishedVersion ? <PublicationHistory base={base} latest={round.publishedVersion} /> : !canManage && <p className="rf-note sv-flush">{t('site.seasons.noResults')}</p>}
    </div>}
  </li>;
}

function PublicationResults({ publication }: { publication: Pick<PublicationView, 'results'> }) {
  const t = useT();
  return <div className="rf-table-wrap"><table className="rf-table sv-table"><thead><tr><th className="sv-pos" scope="col">{t('site.seasons.pos')}</th><th scope="col">{t('site.seasons.teamOrRider')}</th><th scope="col" className="sv-mid">{t('site.seasons.eventPts')}</th><th scope="col">{t('site.seasons.seasonPts')}</th></tr></thead><tbody>{publication.results.map((row) => <tr key={row.teamProfileId}><td className="rf-num">{row.eventRank}</td><th scope="row" className="sv-rowhead">{row.teamName}</th><td className="sv-mid">{row.eventPoints}</td><td className="rf-num sv-end">{row.seasonPoints}</td></tr>)}</tbody></table>{!publication.results.length && <p className="rf-note" style={{ paddingInline: 16 }}>{t('site.seasons.noEligible')}</p>}</div>;
}

function PublicationHistory({ base, latest }: { base: string; latest: number }) {
  const t = useT();
  const { locale } = useLanguage();
  const [version, setVersion] = useState(latest);
  const [publication, setPublication] = useState<(PublicationView & { version: number; publishedAt: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <details className="sv-versions"><summary>{t('site.seasons.publishedVersions')}</summary><form className="sv-versions-form" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { const { data } = await api.get<PublicationView & { version: number; publishedAt: string }>(`${base}/publications/${version}`); setPublication(data); }
    catch (reason) { setError(seasonError(reason, t('site.seasons.versionFailed'))); }
    finally { setBusy(false); }
  }}>
    <div className="sv-versions-pick"><label className="rf-fld">{t('site.seasons.versionLabel')}<NumberField  min={1} max={latest} required value={version} onChange={(event) => setVersion(Number(event.target.value))} disabled={busy} /></label><button className="rf-btn" disabled={busy}>{busy ? t('common.loading') : t('site.seasons.viewVersion')}</button></div>
    {error && <Notice>{error}</Notice>}
    {publication && <><p className="rf-note sv-flush">{t('site.seasons.publishedAt', { n: publication.version, when: new Date(publication.publishedAt).toLocaleString(locale) })}</p><p className="rf-note sv-flush">{publication.rankingBasis}</p><PublicationResults publication={publication} /></>}
  </form></details>;
}
