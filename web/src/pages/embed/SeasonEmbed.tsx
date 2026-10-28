import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useEmbedResource } from '../../hooks/useEmbedResource';
import { embedHomePath, embedPollMs, isSeasonStandings, isSeasonSummary, parseEmbedOptions } from '../../lib/embed';
import { positionLabels } from '../seasons/seasonModel';
import type { StandingView } from '../seasons/seasonViewTypes';
import { EmbedFrame, EmbedMessage, StaleNotice } from './EmbedFrame';
import { clubLabel } from '../../lib/clubName';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A season's points table: team, rounds counted and points. Same public data as the season page. */
export function SeasonEmbed() {
  const { seasonId } = useParams();
  const [search] = useSearchParams();
  const options = useMemo(() => parseEmbedOptions(search), [search]);
  const valid = !!seasonId && GUID.test(seasonId);
  const interval = (_data: unknown, failures: number) => embedPollMs(false, failures);
  const season = useEmbedResource(valid ? `/seasons/${seasonId}` : null, isSeasonSummary, interval);
  const table = useEmbedResource(valid ? `/seasons/${seasonId}/standings` : null, isSeasonStandings, interval);
  const standings = table.data?.standings;
  const rows: StandingView[] = useMemo(() => standings ?? [], [standings]);
  const labels = useMemo(() => positionLabels(rows), [rows]);

  const frame = {
    options,
    homeHref: embedHomePath({ kind: 'season', id: seasonId ?? '' }, 'standings'),
    title: season.data?.title ?? 'Mounted Games',
    subtitle: season.data ? [`Season ${season.data.year}`, season.data.ageGroup].filter(Boolean).join(' · ') : undefined,
    updatedAt: table.updatedAt,
  };
  if (!valid || season.error === 'notfound' || table.error === 'notfound') return <EmbedFrame {...frame}><EmbedMessage>This season isn’t available.</EmbedMessage></EmbedFrame>;
  if (!season.data || !table.data) {
    const failed = season.error || table.error;
    return <EmbedFrame {...frame}>
      {failed ? <EmbedMessage onRetry={() => { season.reload(); table.reload(); }}>Couldn’t load the season. Check the connection and try again.</EmbedMessage> : <EmbedMessage>Loading…</EmbedMessage>}
    </EmbedFrame>;
  }
  const included = season.data.rounds.filter((round) => round.isIncluded).length;
  const best = season.data.bestResultsToCount;
  const note = best ? `Best ${best} of ${included} ${included === 1 ? 'round' : 'rounds'} count.` : `All ${included} ${included === 1 ? 'round counts' : 'rounds count'}.`;
  return <EmbedFrame {...frame}>
    {(season.error || table.error) && <StaleNotice />}
    {rows.length === 0 ? <EmbedMessage>No standings yet. Results appear after the first round is published.</EmbedMessage> : <>
      <div className="emb-table-wrap">
        <table className="emb-table">
          <caption className="sr-only">Season standings</caption>
          <thead><tr><th scope="col">Pos</th><th scope="col">Team</th><th scope="col" className="emb-num">Rds</th><th scope="col" className="emb-num">Pts</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.teamProfileId}>
                <td>{labels.get(row.teamProfileId)}</td>
                <td>{row.teamName}{clubLabel(row.clubName) && !row.teamName.toLowerCase().includes(row.clubName.toLowerCase()) && <small>{row.clubName}</small>}</td>
                <td className="emb-num">{row.rounds.length}</td>
                <td className="emb-num">{row.totalPoints}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="emb-note">{note} Worked out from published results.</p>
    </>}
  </EmbedFrame>;
}
