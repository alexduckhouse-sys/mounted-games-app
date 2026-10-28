import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { BarChart3, ChevronLeft, Download, Mic, Monitor, Printer, QrCode as QrCodeIcon } from 'lucide-react';
import { api } from '../../api';
import type { PrintableDraw, PrintableResults, PrintableScoreSheets } from '../eventTools/eventToolsTypes';
import type { PrintableEntries, ResultsBook } from '../eventTools/resultsBookTypes';
import { EntriesView, ResultsBookView } from '../eventTools/ResultsBookView';
import { PosterPage } from '../eventTools/PosterPage';
import { VolunteerCard } from '../eventTools/VolunteerCard';
import { TackCheckForms, type PrintableTackCheck } from '../eventTools/TackCheckPrint';
import { statusLetter } from '../../lib/resultStatus';
import '../eventTools/printEvent.css';
import { formatPoints } from '../../lib/formatPoints';
import { downloadCsv, safeFilename, toCsv } from '../../lib/csv';
import { formatDurationHms, logoSrc } from '../../lib/sponsors';
import { activeScorerLinks, mintPosterLinks, type PosterLink } from './posterLinks';
import { activeLocale, tr } from '../../i18n/translate';
import type { MessageKey } from '../../i18n/en/index';
import { drawForSession, parseSessionId, scoreSheetsForSession } from './sessionPrint';
import { SPONSOR_CSV_HEADER, buildSponsorReportRows, placeFiguresText, placementText, sponsorCsvRows, tierText, type SponsorReportRow } from './sponsorReport';
import type { CompetitionDetail, ScorerLink } from '../../types';
import { PageProblem } from '../../components/PageProblem';
import { QrCode } from '../../components/QrCode';
import { useToast } from '../../components/Toast';
import { getStoredCards } from '../competition/ScoringParts';
import { competitionDateText } from '../../lib/competitionDates';

/** What each print view loads and is called. The book and entry list are not under /print because they have their own access rules. */
const VIEWS = {
  draw: { path: 'print/draw', title: 'ops2.print.view.draw' },
  'score-sheets': { path: 'print/score-sheets', title: 'ops2.print.view.scoreSheets' },
  results: { path: 'print/results', title: 'ops2.print.view.results' },
  'results-book': { path: 'results-book', title: 'ops2.print.view.book' },
  'results-book-organiser': { path: 'results-book/organiser', title: 'ops2.print.view.bookOrganiser' },
  entries: { path: 'print/entries', title: 'ops2.print.view.entries' },
  'tack-check': { path: 'print/tack-check', title: 'ops2.print.view.tack' },
  posters: { path: 'print/posters', title: 'ops2.print.view.posters' },
  'volunteer-card': { path: 'print/draw', title: 'ops2.print.view.volunteer' },
} as const satisfies Record<string, { path: string; title: MessageKey }>;
type View = keyof typeof VIEWS;

/** Sheets that carry a small QR code to the public live scores. */
const QR_VIEWS: readonly View[] = ['draw', 'score-sheets'];

function date(value: string) {
  return new Date(value).toLocaleDateString(activeLocale(), { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
}

function time(value: string | null) {
  return value ? new Date(value).toLocaleTimeString(activeLocale(), { hour: '2-digit', minute: '2-digit' }) : tr('ops2.print.timeTbc');
}

function message(error: unknown) {
  const candidate = error as { response?: { data?: { detail?: string; title?: string } } };
  return candidate.response?.data?.detail ?? candidate.response?.data?.title ?? tr('ops2.print.checkSignal');
}

export default function PrintEventPage() {
  const { competitionId = '', view: rawView = 'draw' } = useParams();
  if (rawView === 'poster') return <PosterPage key={competitionId} competitionId={competitionId} />;
  const initialSponsorMode = rawView === 'sponsors' || rawView === 'sponsor-report';
  const view = (Object.keys(VIEWS).includes(rawView) ? rawView : 'draw') as View;
  return <PrintView key={`${competitionId}:${view}:${initialSponsorMode ? 'sponsors' : 'prog'}`} competitionId={competitionId} view={view} initialSponsorMode={initialSponsorMode} />;
}

function PrintView({ competitionId, view, initialSponsorMode = false }: { competitionId: string; view: View; initialSponsorMode?: boolean }) {
  const [data, setData] = useState<PrintableDraw | PrintableScoreSheets | PrintableResults | ResultsBook | PrintableEntries | PrintableTackCheck | { competition: CompetitionDetail } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sponsorMode, setSponsorMode] = useState(initialSponsorMode);
  const [sponsorRows, setSponsorRows] = useState<SponsorReportRow[]>([]);
  const [compDetail, setCompDetail] = useState<CompetitionDetail | null>(null);
  const [sponsorLoadedId, setSponsorLoadedId] = useState<string | null>(null);
  const loadingSponsors = sponsorMode && sponsorLoadedId !== String(competitionId ?? '');
  const [scorerLinks, setScorerLinks] = useState<ScorerLink[]>([]);
  const [posterLinks, setPosterLinks] = useState<PosterLink[] | null>(null);
  const [printing, setPrinting] = useState(false);
  const [linksLoadedId, setLinksLoadedId] = useState<string | null>(null);
  const loadingLinks = view === 'posters' && linksLoadedId !== String(competitionId ?? '');
  const [exportingResults, setExportingResults] = useState(false);
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const sessionId = view === 'draw' || view === 'score-sheets' || view === 'results' ? parseSessionId(searchParams.get('sessionId')) : null;

  useEffect(() => {
    let cancelled = false;
    if (view === 'posters') {
      api.get<CompetitionDetail>(`/competitions/${competitionId}`)
        .then((response) => {
          if (!cancelled) {
            setData({ competition: response.data });
            setCompDetail(response.data);
          }
        })
        .catch((caught) => { if (!cancelled) setError(message(caught)); });
      return () => { cancelled = true; };
    }

    const base = `/event-tools/competitions/${competitionId}`;
    if (sessionId && view === 'score-sheets') {
      api.get<PrintableScoreSheets>(`${base}/${VIEWS[view].path}`)
        .then((sheets) => { if (!cancelled) setData(scoreSheetsForSession(sheets.data, sessionId)); })
        .catch((caught) => { if (!cancelled) setError(message(caught)); });
      return () => { cancelled = true; };
    }
    const request = sessionId && view === 'results'
      ? api.get(`${base}/${VIEWS[view].path}`, { params: { sessionId } })
      : api.get(`${base}/${VIEWS[view].path}`);
    request
      .then((response) => { if (!cancelled) setData(sessionId && view === 'draw' ? drawForSession(response.data as PrintableDraw, sessionId) : response.data); })
      .catch((caught) => { if (!cancelled) setError(message(caught)); });
    return () => { cancelled = true; };
  }, [competitionId, view, attempt, sessionId]);

  useEffect(() => {
    if (view !== 'posters' || !competitionId) return;
    let cancelled = false;
    api.get<{ links?: ScorerLink[] } | ScorerLink[]>(`/competitions/${competitionId}/scorer-links`)
      .then((res) => {
        if (cancelled) return;
        const body = res.data;
        const list = Array.isArray(body) ? body : Array.isArray(body?.links) ? body.links : [];
        setScorerLinks(list);
      })
      .catch(() => {
        if (!cancelled) setScorerLinks([]);
      })
      .finally(() => {
        if (!cancelled) setLinksLoadedId(String(competitionId));
      });
    return () => { cancelled = true; };
  }, [competitionId, view]);

  useEffect(() => {
    if (!sponsorMode || !competitionId) return;
    let cancelled = false;

    const fetchStats = api.get(`/competitions/${competitionId}/sponsor-stats`).then((r) => r.data).catch(() => null);
    const fetchManage = api.get(`/competitions/${competitionId}/sponsors/manage`)
      .then((r) => r.data)
      .catch(() => api.get(`/competitions/${competitionId}/sponsors`).then((r) => r.data).catch(() => []));
    const fetchComp = api.get<CompetitionDetail>(`/competitions/${competitionId}`).then((r) => r.data).catch(() => null);

    Promise.all([fetchStats, fetchManage, fetchComp])
      .then(([rawStats, rawSponsors, comp]) => {
        if (cancelled) return;
        setCompDetail(comp);
        setSponsorRows(buildSponsorReportRows(rawStats, rawSponsors));
      })
      .finally(() => {
        if (!cancelled) setSponsorLoadedId(String(competitionId));
      });

    return () => { cancelled = true; };
  }, [competitionId, sponsorMode]);

  if (error) return <PageProblem title={tr('ops2.print.loadProblem')} primaryLabel={tr('common.tryAgain')} onPrimary={() => { setError(null); setAttempt(attempt + 1); }}>{error}</PageProblem>;
  if (!data) return <p className="mg-card p-4" role="status">{tr('ops2.print.preparing')}</p>;
  const competition = data.competition;
  const reference = competition.competitionNumber?.trim() || null;
  const showQr = !sponsorMode && QR_VIEWS.includes(view);

  const totalSections = compDetail?.sections?.length
    ?? ('sections' in data && Array.isArray(data.sections) ? data.sections.length : 0);
  const totalTeams = compDetail?.teams?.length
    ?? ('sections' in data && Array.isArray(data.sections)
      ? data.sections.reduce((sum, s) => sum + ('results' in s && Array.isArray(s.results) ? s.results.length : 0), 0)
      : 0);

  function exportSponsorCsv() {
    downloadCsv(`${safeFilename(competition.name || 'competition')}-sponsor-report.csv`, toCsv(SPONSOR_CSV_HEADER, sponsorCsvRows(sponsorRows)));
  }

  /** Tokens aren't stored, so the staff sheet gets fresh links, made only when someone prints it (old links keep working). */
  async function printPage() {
    if (view === 'posters' && posterLinks === null && activeScorerLinks(scorerLinks, Date.now()).length > 0) {
      setPrinting(true);
      try {
        setPosterLinks(await mintPosterLinks(competitionId, scorerLinks, window.location.origin));
        // Let the QR codes render before the print dialog opens.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      } catch (caught) {
        toast.show(message(caught));
        return;
      } finally {
        setPrinting(false);
      }
    }
    window.print();
  }

  async function exportOfficialResultsCsv() {
    if (!competitionId) return;
    setExportingResults(true);
    try {
      // Referee cards live on the teams: fetch the competition if the page hasn't already (only posters and the sponsor report do).
      const detail = compDetail ?? (await api.get<CompetitionDetail>(`/competitions/${competitionId}`)).data;
      const [resultsRes, sheetsRes] = await Promise.all([
        api.get<PrintableResults>(`/event-tools/competitions/${competitionId}/print/results`).catch(() => null),
        api.get<PrintableScoreSheets>(`/event-tools/competitions/${competitionId}/print/score-sheets`).catch(() => null),
      ]);

      const storedCards: Record<number, 'yellow' | 'red' | null> = { ...getStoredCards(Number(competitionId)) };
      const teamMap = new Map<number, string>();
      if (detail.teams) {
        for (const t of detail.teams) {
          teamMap.set(t.id, t.displayName);
          if (t.refereeCard === 'yellow' || t.refereeCard === 'red') {
            storedCards[t.id] = t.refereeCard;
          }
        }
      }
      const header = [
        'Section',
        'Session',
        'Heat',
        'Race',
        'Type',
        'Rank',
        'Team',
        'Club / Bib',
        'Points',
        'Card',
        'Notes',
      ];
      const rows: (string | number)[][] = [];

      if (resultsRes?.data?.sections) {
        for (const section of resultsRes.data.sections) {
          for (const res of section.results ?? []) {
            teamMap.set(res.teamId, res.teamName);
            const card = storedCards[res.teamId];
            const cardLabel = card ? (card === 'yellow' ? 'Yellow card' : 'Red card') : '';
            rows.push([
              section.sectionName,
              'Finals / Overall',
              '',
              '',
              'Standings',
              res.rank,
              res.teamName,
              res.clubName,
              res.totalPoints,
              cardLabel,
              res.bonusPoints ? `Bonus: ${res.bonusPoints}` : '',
            ]);
          }
        }
      }

      if (sheetsRes?.data?.heats) {
        for (const heat of sheetsRes.data.heats) {
          for (const race of heat.races ?? []) {
            for (const team of race.teams ?? []) {
              teamMap.set(team.teamId, team.teamName);
              const card = storedCards[team.teamId];
              const cardLabel = card ? (card === 'yellow' ? 'Yellow card' : 'Red card') : '';
              rows.push([
                heat.sectionName || '',
                heat.sessionName || '',
                heat.label || '',
                race.name || '',
                'Heat Race',
                team.placing ?? '',
                team.teamName,
                team.bib ?? '',
                scoreText(team),
                cardLabel,
                team.status ? (statusLetter(team.eliminated, team.status) ?? '') : '',
              ]);
            }
          }
        }
      }

      const cardEntries = Object.entries(storedCards).filter(([, c]) => !!c);
      if (cardEntries.length > 0) {
        for (const [teamIdStr, card] of cardEntries) {
          const tId = Number(teamIdStr);
          rows.push([
            '',
            '',
            '',
            '',
            'Referee Card Incident',
            '',
            teamMap.get(tId) ?? `Team #${tId}`,
            '',
            '',
            card === 'yellow' ? 'Yellow card' : 'Red card',
            'Card recorded in scoring sheet',
          ]);
        }
      }

      const compName = competition?.name || 'competition';
      downloadCsv(`${safeFilename(compName)}-official-results-pack.csv`, toCsv(header, rows));
    } catch (caught) {
      toast.show(message(caught));
    } finally {
      setExportingResults(false);
    }
  }

  return (
    <article className="event-print-page">
      {toast.node}
      <div className="event-print-controls mb-5 flex flex-wrap items-center gap-2">
        <Link className="mg-btn mg-btn-secondary" to={`/competitions/${competitionId}/details`}><ChevronLeft className="h-4 w-4" />{tr('ops2.print.eventDetails')}</Link>
        <Link className="mg-btn mg-btn-secondary" to={`/competitions/${competitionId}/tv`}><Monitor className="h-4 w-4" />{tr('ops2.print.tvKiosk')}</Link>
        <Link className="mg-btn mg-btn-secondary" to={`/competitions/${competitionId}/commentary`}><Mic className="h-4 w-4" />{tr('ops2.print.paDesk')}</Link>
        <Link className={`mg-btn ${view === 'posters' && !sponsorMode ? 'mg-btn-primary' : 'mg-btn-secondary'}`} to={`/event-tools/${competitionId}/print/posters`}>
          <QrCodeIcon className="h-4 w-4" />{tr('ops2.print.view.posters')}
        </Link>
        <button
          type="button"
          onClick={() => void exportOfficialResultsCsv()}
          disabled={exportingResults}
          className="mg-btn mg-btn-secondary"
        >
          <Download className="h-4 w-4" />{exportingResults ? tr('ops2.print.exporting') : tr('ops2.print.officialPack')}
        </button>
        <button
          type="button"
          aria-pressed={sponsorMode}
          onClick={() => setSponsorMode((v) => !v)}
          className="mg-btn mg-btn-secondary"
        >
          <BarChart3 className="h-4 w-4" />{tr('ops2.print.sponsorReport')}
        </button>
        <button className="mg-btn mg-btn-primary" disabled={printing} onClick={() => void printPage()}><Printer className="h-4 w-4" />{tr('ops2.print.print')}</button>
        {sessionId && !sponsorMode && (
          <span className="flex items-center gap-2 text-sm text-[rgb(var(--mg-muted))]">
            {tr('ops2.print.oneSession')}
            <Link className="mg-btn mg-btn-secondary" to={`/event-tools/${competitionId}/print/${view}`} replace>{tr('ops2.print.showEvery')}</Link>
          </span>
        )}
      </div>
      <header className="event-print-header">
        <div className="event-print-header-text">
          <p className="event-print-kicker">{tr('common.mountedGames')}</p>
          <h1>{competition.name}</h1>
          <p>{date(competition.startDate)}{competition.location ? ` · ${competition.location}` : ''}</p>
          {reference && <p className="event-print-ref">{tr('ops2.print.reference', { ref: reference })}</p>}
          <p className="event-print-kind">{sponsorMode ? tr('ops2.print.sponsorReport') : tr(VIEWS[view].title)}</p>
        </div>
        {showQr && <div className="event-print-qr-box">
          <QrCode value={`${window.location.origin}/competitions/${competition.id}/toplists`} label={tr('ops2.print.qrLabel')} className="event-print-qr-small" />
          <span>{tr('ops2.print.liveScores')}</span>
        </div>}
      </header>

      {sponsorMode ? (
        <SponsorProofOfValueSection
          competitionName={competition.name}
          startDate={date(competition.startDate)}
          venue={competition.location ?? tr('ops2.print.venueTbc')}
          totalTeams={totalTeams}
          totalSections={totalSections}
          rows={sponsorRows}
          loading={loadingSponsors}
          onPrint={() => window.print()}
          onExportCsv={exportSponsorCsv}
        />
      ) : (
        <>
          {view === 'draw' && <Draw data={data as PrintableDraw} />}
          {view === 'score-sheets' && <ScoreSheets data={data as PrintableScoreSheets} />}
          {view === 'results' && <Results data={data as PrintableResults} />}
          {(view === 'results-book' || view === 'results-book-organiser') && <ResultsBookView data={data as ResultsBook} />}
          {view === 'entries' && <EntriesView data={data as PrintableEntries} />}
          {view === 'volunteer-card' && <VolunteerCard data={data as PrintableDraw} />}
          {view === 'tack-check' && <TackCheckForms data={data as PrintableTackCheck} />}
          {view === 'posters' && (
            <QrPostersSection
              competition={compDetail ?? (data.competition as CompetitionDetail)}
              scorerLinks={scorerLinks}
              posterLinks={posterLinks}
              loadingLinks={loadingLinks}
            />
          )}
        </>
      )}
    </article>
  );
}

function SponsorProofOfValueSection({
  competitionName,
  startDate,
  venue,
  totalTeams,
  totalSections,
  rows,
  loading,
  onPrint,
  onExportCsv,
}: {
  competitionName: string;
  startDate: string;
  venue: string;
  totalTeams: number;
  totalSections: number;
  rows: SponsorReportRow[];
  loading: boolean;
  onPrint: () => void;
  onExportCsv: () => void;
}) {
  const totalViews = useMemo(() => rows.reduce((sum, r) => sum + r.totalViews, 0), [rows]);
  const totalSeconds = useMemo(() => rows.reduce((sum, r) => sum + r.totalSeconds, 0), [rows]);

  return (
    <section aria-label={tr('ops2.print.sponsorReport')} className="event-print-section">
      <div className="event-print-controls mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-ground))] p-3">
        <div>
          <strong className="block text-sm font-bold text-[rgb(var(--mg-heading))]">
            {tr('ops2.print.sponsorReport')}
          </strong>
          <span className="text-xs text-[rgb(var(--mg-muted))]">
            {tr('ops2.print.sr.sub')}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="mg-btn mg-btn-secondary" onClick={onExportCsv}>
            <Download className="h-4 w-4" aria-hidden="true" /> {tr('ops2.print.sr.csv')}
          </button>
          <button type="button" className="mg-btn mg-btn-primary" onClick={onPrint}>
            <Printer className="h-4 w-4" aria-hidden="true" /> {tr('ops2.print.sr.pdf')}
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-[rgb(var(--mg-rule-soft))] p-3">
          <span className="block text-xs font-bold text-[rgb(var(--mg-muted))]">{tr('ops2.print.sr.eventDate')}</span>
          <strong className="mt-0.5 block text-sm font-bold text-[rgb(var(--mg-ink))]">{competitionName}</strong>
          <span className="block text-xs text-[rgb(var(--mg-body))]">{startDate}</span>
        </div>
        <div className="rounded-lg border border-[rgb(var(--mg-rule-soft))] p-3">
          <span className="block text-xs font-bold text-[rgb(var(--mg-muted))]">{tr('ops2.print.sr.venue')}</span>
          <strong className="mt-0.5 block text-sm font-bold text-[rgb(var(--mg-ink))]">{venue}</strong>
        </div>
        <div className="rounded-lg border border-[rgb(var(--mg-rule-soft))] p-3">
          <span className="block text-xs font-bold text-[rgb(var(--mg-muted))]">{tr('ops2.print.sr.teamsSections')}</span>
          <strong className="mt-0.5 block text-sm font-bold text-[rgb(var(--mg-ink))]">
            {tr('ops2.print.sr.teamsCount', { teams: totalTeams, sections: totalSections })}
          </strong>
        </div>
        <div className="rounded-lg border border-[rgb(var(--mg-rule-soft))] p-3">
          <span className="block text-xs font-bold text-[rgb(var(--mg-muted))]">{tr('ops2.print.sr.totalViews')}</span>
          <strong className="mt-0.5 block text-lg font-bold tabular-nums text-[rgb(var(--mg-heading))]">
            {totalViews.toLocaleString(activeLocale())}
          </strong>
          <span className="block text-xs text-[rgb(var(--mg-muted))]">{tr('ops2.print.sr.onVideo', { time: formatDurationHms(totalSeconds) })}</span>
        </div>
      </div>

      {loading ? (
        <p role="status" className="event-print-note">{tr('ops2.print.sr.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="event-print-empty">{tr('ops2.print.sr.empty')}</p>
      ) : (
        <div className="event-print-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('ops2.print.sr.colSponsor')}</th>
                <th>{tr('ops2.print.sr.colLevel')}</th>
                <th className="event-print-cell">{tr('ops2.print.sr.colViews')}</th>
                <th className="event-print-cell">{tr('ops2.print.sr.colOnVideo')}</th>
                <th>{tr('ops2.print.sr.colSwitched')}</th>
                <th>{tr('ops2.print.sr.colByPlace')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      {row.logoUrl && (
                        <img
                          src={logoSrc(row.logoUrl, import.meta.env.VITE_API_BASE)}
                          alt={tr('ops2.print.sr.logoAlt', { name: row.name })}
                          className="h-7 w-7 shrink-0 rounded object-contain"
                        />
                      )}
                      <div>
                        <strong className="block font-semibold">{row.name}</strong>
                        {row.linkUrl && <span className="block text-xs text-[rgb(var(--mg-muted))]">{row.linkUrl}</span>}
                      </div>
                    </div>
                  </td>
                  <td>{tierText(row.tierLabel)}</td>
                  <td className="event-print-cell"><strong>{row.totalViews.toLocaleString(activeLocale())}</strong></td>
                  <td className="event-print-cell">{row.totalSeconds > 0 ? formatDurationHms(row.totalSeconds) : tr('ops2.print.sr.none')}</td>
                  <td>{row.switchedOn.map(placementText).join(', ') || tr('ops2.print.sr.notRecorded')}</td>
                  <td>{placeFiguresText(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Draw({ data }: { data: PrintableDraw }) {
  if (data.sessions.length === 0) return <p className="event-print-empty">{tr('ops2.print.noDraw')}</p>;
  return <>{data.sessions.map((session) => <section key={session.sessionId} className="event-print-section">
    <h2>{session.sectionName || tr('ops2.print.openSection')} · {session.sessionName}</h2>
    {session.arenaName && <p className="event-print-note">{tr('ops2.print.arena', { name: session.arenaName })}</p>}
    {session.heats.map((heat) => {
      const teams = heat.teams.slice().sort((a, b) => (a.lane ?? 0) - (b.lane ?? 0));
      return <div key={heat.heatId} className="event-print-block">
        <h3>{heat.label} <span>{time(heat.scheduledStart)}</span></h3>
        <div className="event-print-table-wrap"><table>
          <thead><tr><th>{tr('ops2.print.lane')}</th><th>{tr('ops2.print.team')}</th>{heat.races.map((race, index) => <th key={race.raceId} className="event-print-cell">{index + 1}. {race.name}</th>)}<th className="event-print-cell">{tr('ops2.print.total')}</th></tr></thead>
          <tbody>{teams.map((team) => <tr key={team.teamId}><td>{team.lane}</td><td>{team.teamName}</td>{heat.races.map((race) => <td key={race.raceId} className="event-print-cell" />)}<td className="event-print-cell" /></tr>)}</tbody>
        </table></div>
      </div>;
    })}
  </section>)}</>;
}

/** A recorded result as it is written on the sheet: points, E, DNS, DNF or R for a team that did not finish, "S" for a sit-out, nothing if the race isn't scored. */
function scoreText(cell: { points: number | null; eliminated: boolean; isSitOut?: boolean; status?: number } | undefined): string {
  if (!cell) return '';
  if (cell.isSitOut) return 'S';
  if (cell.eliminated) return statusLetter(true, cell.status) ?? 'E';
  return cell.points === null || cell.points === undefined ? '' : formatPoints(cell.points);
}

function ScoreSheets({ data }: { data: PrintableScoreSheets }) {
  if (data.heats.length === 0) return <p className="event-print-empty">{tr('ops2.print.noSheets')}</p>;
  return <>{data.heats.map((heat) => {
    // One row per team in lane order, one column per race; anything already scored is filled in.
    const teams = (heat.races[0]?.teams ?? []).slice().sort((a, b) => (a.lane ?? 0) - (b.lane ?? 0));
    return <section key={heat.heatId} className="event-print-section event-print-break">
      <h2>{heat.sectionName || tr('ops2.print.openSection')} · {heat.sessionName} · {heat.label}</h2>
      <p className="event-print-note">{time(heat.scheduledStart)}</p>
      {heat.races.length === 0 ? <p className="event-print-empty">{tr('ops2.print.noRaces')}</p> : <div className="event-print-table-wrap"><table>
        <thead><tr><th>{tr('ops2.print.lane')}</th><th>{tr('ops2.print.team')}</th><th>{tr('ops2.print.bib')}</th>{heat.races.map((race, index) => <th key={race.raceId} className="event-print-cell">{index + 1}. {race.name}</th>)}<th className="event-print-cell">{tr('ops2.print.total')}</th></tr></thead>
        <tbody>{teams.map((team) => {
          const cells = heat.races.map((race) => race.teams.find((x) => x.teamId === team.teamId));
          const scored = cells.filter((cell) => cell && cell.points !== null && cell.points !== undefined);
          return <tr key={team.teamId}>
            <td>{team.lane || ''}</td><td>{team.teamName}</td><td>{team.bib ?? ''}</td>
            {cells.map((cell, index) => <td key={heat.races[index].raceId}>{scoreText(cell)}</td>)}
            <td>{scored.length > 0 ? formatPoints(scored.reduce((sum, cell) => sum + (cell!.points ?? 0), 0)) : ''}</td>
          </tr>;
        })}</tbody>
      </table></div>}
    </section>;
  })}</>;
}

function Results({ data }: { data: PrintableResults }) {
  return <>{data.isProvisional && <p className="event-print-provisional">{tr('ops2.print.provisional')}</p>}{data.sections.length === 0 ? <p className="event-print-empty">{tr('ops2.print.noSections')}</p> : data.sections.map((section) => {
    // Tack check bonus points are part of the total; the column shows them only when a section has any.
    const hasBonus = section.results.some((row) => (row.bonusPoints ?? 0) > 0);
    return <section key={section.competitionSectionId} className="event-print-section"><h2>{section.sectionName}</h2>{section.results.length === 0 ? <p className="event-print-empty">{tr('ops2.print.noResults')}</p> : <div className="event-print-table-wrap"><table><thead><tr><th>{tr('ops2.print.colPos')}</th><th>{tr('ops2.print.team')}</th><th>{tr('ops2.print.colPoints')}</th>{hasBonus && <th>{tr('ops2.print.colTack')}</th>}<th>{tr('ops2.print.colRaces')}</th><th>{tr('ops2.print.colWins')}</th><th>{tr('ops2.print.colElim')}</th></tr></thead><tbody>{section.results.map((row) => <tr key={row.teamId}><td>{row.rank}</td><td>{row.teamName}</td><td><strong>{row.totalPoints}</strong></td>{hasBonus && <td>{row.bonusPoints ?? 0}</td>}<td>{row.racesRun}</td><td>{row.wins}</td><td>{row.eliminations}</td></tr>)}</tbody></table></div>}</section>;
  })}</>;
}

function QrPostersSection({
  competition,
  scorerLinks,
  posterLinks,
  loadingLinks,
}: {
  competition: CompetitionDetail | { id: number; name: string; location?: string | null; startDate: string; endDate?: string | null; what3Words?: string | null; latitude?: number | null; longitude?: number | null };
  scorerLinks: ScorerLink[];
  /** Fresh links with their QR addresses; null until the sheet has been printed. */
  posterLinks: PosterLink[] | null;
  loadingLinks: boolean;
}) {
  const origin = window.location.origin;
  const gateUrl = `${origin}/competitions/${competition.id}`;
  const [now] = useState(() => Date.now());
  const activeLinks: Array<{ link: ScorerLink; url: string | null }> = posterLinks ?? activeScorerLinks(scorerLinks, now).map((link) => ({ link, url: null }));

  return (
    <>
      {/* PAGE 1: Spectator Gate & Ring Fence Poster */}
      <section className="event-print-section event-poster event-print-break" aria-label={tr('ops2.print.p.gateAria')}>
        <p className="event-print-kicker">{tr('common.mountedGames')}</p>
        <h2 className="event-poster-title !bg-transparent !p-0 !text-[#17385f]">{competition.name}</h2>
        <p className="event-poster-when">{competitionDateText(competition.startDate, competition.endDate, true)}</p>
        {competition.location && <p className="event-poster-where">{competition.location}</p>}

        <div className="my-6 flex justify-center">
          <QrCode value={gateUrl} label={tr('ops2.print.p.qrLabel', { name: competition.name })} className="event-poster-qr" />
        </div>

        <p className="event-poster-scan">{tr('ops2.print.p.scan')}</p>
        <p className="event-poster-link">{gateUrl.replace(/^https?:\/\//, '')}</p>

        {/* Emergency Venue Details Box */}
        <div className="mt-8 rounded-lg border-2 border-red-800 bg-red-50 p-4 text-left text-red-950">
          <h3 className="mb-2 text-base font-bold uppercase tracking-wide text-red-900">
            {tr('ops2.print.p.emergency')}
          </h3>
          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <span className="font-semibold">{tr('ops2.print.p.venueLoc')}</span>
              <p className="text-sm font-medium">{competition.location || tr('ops2.print.p.locDetails')}</p>
            </div>
            {competition.what3Words && (
              <div>
                <span className="font-semibold">{tr('ops2.print.p.w3w')}</span>
                <p className="font-mono text-sm font-bold">
                  {competition.what3Words.startsWith('///') ? competition.what3Words : `///${competition.what3Words}`}
                </p>
              </div>
            )}
            {competition.latitude != null && competition.longitude != null && (
              <div>
                <span className="font-semibold">{tr('ops2.print.p.gps')}</span>
                <p className="font-mono text-sm">
                  {competition.latitude.toFixed(5)}, {competition.longitude.toFixed(5)}
                </p>
              </div>
            )}
            <div>
              <span className="font-semibold">{tr('ops2.print.p.accessNote')}</span>
              <p className="text-xs">{tr('ops2.print.p.quote')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* PAGE 2: Staff & Ring Crew QR Sheet */}
      <section className="event-print-section event-print-break" style={{ breakBefore: 'page' }} aria-label={tr('ops2.print.p.staffAria')}>
        <div className="mb-4 border-b-2 border-[#17385f] pb-3">
          <p className="event-print-kicker">{tr('ops2.print.p.staffOnly')}</p>
          <h2 className="!bg-transparent !p-0 !text-2xl !font-bold !text-[#17385f]">
            {tr('ops2.print.p.accessSheet')}
          </h2>
          <p className="text-sm text-[rgb(var(--mg-muted))]">
            {tr('ops2.print.p.authorised', { name: competition.name })}
          </p>
        </div>

        {loadingLinks ? (
          <p className="event-print-note" role="status">{tr('ops2.print.p.loadingLinks')}</p>
        ) : activeLinks.length === 0 ? (
          <div className="rounded-lg border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-ground))] p-6 text-center">
            <h3 className="mb-2 text-lg font-bold text-[rgb(var(--mg-heading))]">{tr('ops2.print.p.noLinks')}</h3>
            <p className="mx-auto max-w-lg text-sm text-[rgb(var(--mg-body))]">
              {tr('ops2.print.p.toCreate')}
            </p>
            <ol className="mx-auto mt-3 max-w-md list-decimal pl-5 text-left text-sm text-[rgb(var(--mg-body))]">
              <li>{tr('ops2.print.p.step1a')}<strong>{tr('ops2.print.p.step1b')}</strong> &gt; <strong>{tr('ops2.print.p.step1c')}</strong>{tr('ops2.print.p.end')}</li>
              <li>{tr('ops2.print.p.step2a')}<strong>{tr('ops2.print.p.arenaScorer')}</strong>, <strong>{tr('ops2.print.p.tripod')}</strong>{tr('ops2.print.p.step2b')}<strong>{tr('ops2.print.p.scorerStream')}</strong>{tr('ops2.print.p.end')}</li>
              <li>{tr('ops2.print.p.step3a')}<strong>{tr('ops2.print.p.createLink')}</strong>{tr('ops2.print.p.step3b')}</li>
            </ol>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {activeLinks.map(({ link, url: targetUrl }) => {
              const scopeLabel = link.scope === 1
                ? tr('ops2.print.p.tripod')
                : link.scope === 2
                  ? tr('ops2.print.p.scorerStream')
                  : tr('ops2.print.p.arenaScorer');

              return (
                <div key={link.id} className="flex flex-col items-center justify-between rounded-lg border-2 border-gray-300 bg-white p-4 text-center break-inside-avoid">
                  <div className="mb-2 w-full">
                    <span className="inline-block rounded bg-[#17385f] px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white">
                      {scopeLabel}
                    </span>
                    <h4 className="mt-2 text-base font-bold text-[#17385f]">{link.label}</h4>
                    <p className="text-xs font-semibold text-gray-600">{tr('ops2.print.arena', { name: link.arenaName })}</p>
                  </div>
                  <div className="my-2 flex justify-center">
                    {targetUrl
                      ? <QrCode value={targetUrl} label={tr('ops2.print.p.linkQr', { label: link.label, scope: scopeLabel })} className="h-36 w-36" />
                      : <p className="flex h-36 w-36 items-center justify-center text-xs text-gray-500">{tr('competition.posters.qrOnPrint')}</p>}
                  </div>
                  <div className="mt-2 w-full text-xs text-gray-500">
                    <p className="font-medium text-gray-700">{tr('ops2.print.p.scanOpen')}</p>
                    {targetUrl && <p className="mt-0.5 truncate font-mono text-[10px]">{targetUrl.replace(/^https?:\/\//, '')}</p>}
                    <p className="mt-1 text-[10px]">{tr('ops2.print.p.expires', { date: new Date(link.expiresAt).toLocaleDateString(activeLocale()) })}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
