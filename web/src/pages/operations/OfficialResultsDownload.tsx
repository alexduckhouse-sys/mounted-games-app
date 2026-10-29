import { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '../../api';
import { Notice } from '../../components/Notice';
import { problemMessage } from '../../lib/apiError';
import { downloadCsv, safeFilename, toCsv } from '../../lib/csv';
import { formatPoints } from '../../lib/formatPoints';
import { statusLetter } from '../../lib/resultStatus';
import { useT } from '../../i18n/LanguageContext';
import type { CompetitionDetail } from '../../types';
import type { PrintableResults, PrintableScoreSheets } from '../eventTools/eventToolsTypes';
import { getStoredCards } from '../competition/ScoringParts';

/** Reused on print sheets, final results and the print toolbar; an incomplete pack is never downloaded. */
export function OfficialResultsDownload({ competitionId, className = 'rf-row' }: { competitionId: number; className?: string }) {
  const t = useT();
  const pending = useRef(false);
  const [exportingResults, setExportingResults] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function exportOfficialResultsCsv() {

    if (pending.current) return;
    pending.current = true;
    setError(null);
    setExportingResults(true);
    try {
      // Referee cards live on the teams: fetch the competition if the page hasn't already (only posters and the sponsor report do).
      const detail = (await api.get<CompetitionDetail>(`/competitions/${competitionId}`)).data;
      const [resultsRes, sheetsRes] = await Promise.all([
        api.get<PrintableResults>(`/event-tools/competitions/${competitionId}/print/results`),
        api.get<PrintableScoreSheets>(`/event-tools/competitions/${competitionId}/print/score-sheets`),
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
            teamMap.get(tId) ?? 'Unnamed team',
            '',
            '',
            card === 'yellow' ? 'Yellow card' : 'Red card',
            'Card recorded in scoring sheet',
          ]);
        }
      }

      const compName = detail.name || 'competition';
      downloadCsv(`${safeFilename(compName)}-official-results-pack.csv`, toCsv(header, rows));
    } catch (caught) {
      setError(problemMessage(caught, t('ops2.print.checkSignal')));
    } finally {
      pending.current = false;
      setExportingResults(false);
    }
  }

  return <>
    <button type="button" className={className} onClick={() => void exportOfficialResultsCsv()} disabled={exportingResults}>
      <Download className="h-4 w-4" aria-hidden="true" />
      <span>{exportingResults ? t('ops2.print.exporting') : t('ops2.print.officialPack')}</span>
    </button>
    {error && <Notice>{error}</Notice>}
  </>;
}

function scoreText(cell: { points: number | null; eliminated: boolean; isSitOut?: boolean; status?: number }): string {
  if (cell.isSitOut) return 'S';
  if (cell.eliminated) return statusLetter(true, cell.status) ?? 'E';
  return cell.points == null ? '' : formatPoints(cell.points);
}
