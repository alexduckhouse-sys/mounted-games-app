import type { StatsGame } from '../../types';
import { formatPoints } from '../../lib/formatPoints';
import { formatPercent } from '../../lib/stats';

interface Props {
  games: StatsGame[];
  best: string[];
  worst: string[];
  /** Shown when there are no games, e.g. a rider who has only ridden in team competitions. */
  emptyText?: string;
}

function formatGameAvg(game: StatsGame): string {
  const avgPts = game.averagePoints ?? (game.races > 0 ? Math.round((game.points / game.races) * 10) / 10 : null);
  if (avgPts == null) return '—';
  const ptsText = `${formatPoints(avgPts)} pts`;
  return game.averagePlace != null ? `${ptsText} (${game.averagePlace})` : ptsText;
}

/** Per-game figures: best and weakest games, then every game with its average and point quota. */
export function StatsGamesView({ games, best, worst, emptyText = 'No races to show yet.' }: Props) {
  if (games.length === 0) return <p className="rf-note">{emptyText}</p>;
  return (
    <div className="flex flex-col gap-2">
      {(best.length > 0 || worst.length > 0) && (
        <dl className="m-0 grid gap-1 text-sm">
          {best.length > 0 && <div className="flex gap-2"><dt className="font-semibold text-[rgb(var(--mg-ok))]">Best</dt><dd className="m-0">{best.join(', ')}</dd></div>}
          {worst.length > 0 && <div className="flex gap-2"><dt className="font-semibold text-[rgb(var(--mg-elim))]">Weakest</dt><dd className="m-0">{worst.join(', ')}</dd></div>}
        </dl>
      )}
      <div className="rf-table-wrap overflow-x-auto">
        <table className="rf-table">
          <caption className="sr-only">Games, best point quota first. Point quota is points won out of the most the race could give.</caption>
          <thead>
            <tr><th scope="col">Game</th><th scope="col">Races</th><th scope="col">Won</th><th scope="col">Avg</th><th scope="col">Not finished</th><th scope="col">Quota</th></tr>
          </thead>
          <tbody>
            {games.map((game) => (
              <tr key={game.name}>
                <td className="font-semibold">{game.name}</td>
                <td className="tabular-nums">{game.races}</td>
                <td className="tabular-nums">{game.wins} <span className="text-[13px] text-[rgb(var(--mg-muted))]">({formatPercent(game.winPercent)})</span></td>
                <td className="tabular-nums">{formatGameAvg(game)}</td>
                <td className="tabular-nums">{game.nonFinishes}</td>
                <td className="tabular-nums font-semibold">{formatPercent(game.pointQuotaPercent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
