import type { StatsGame } from '../../types';
import { formatPoints } from '../../lib/formatPoints';
import { formatPercent } from '../../lib/stats';
import { useT } from '../../i18n/LanguageContext';
import type { Translate } from '../../i18n/translate';

interface Props {
  games: StatsGame[];
  best: string[];
  worst: string[];
  /** Shown when there are no games, e.g. a rider who has only ridden in team competitions. */
  emptyText?: string;
}

function formatGameAvg(game: StatsGame, t: Translate): string {
  const avgPts = game.averagePoints ?? (game.races > 0 ? Math.round((game.points / game.races) * 10) / 10 : null);
  if (avgPts == null) return '—';
  const ptsText = t('site.stats.pts', { points: formatPoints(avgPts) });
  return game.averagePlace != null ? `${ptsText} (${game.averagePlace})` : ptsText;
}

/** Per-game figures: best and weakest games, then every game with its average and point quota. */
export function StatsGamesView({ games, best, worst, emptyText }: Props) {
  const t = useT();
  if (games.length === 0) return <p className="rf-note">{emptyText ?? t('site.stats.noRaces')}</p>;
  return (
    <div className="flex flex-col gap-2">
      {(best.length > 0 || worst.length > 0) && (
        <dl className="m-0 grid gap-1 text-sm">
          {best.length > 0 && <div className="flex gap-2"><dt className="font-semibold text-[rgb(var(--mg-ok))]">{t('site.stats.best')}</dt><dd className="m-0">{best.join(', ')}</dd></div>}
          {worst.length > 0 && <div className="flex gap-2"><dt className="font-semibold text-[rgb(var(--mg-elim))]">{t('site.stats.weakest')}</dt><dd className="m-0">{worst.join(', ')}</dd></div>}
        </dl>
      )}
      <div className="rf-table-wrap overflow-x-auto">
        <table className="rf-table">
          <caption className="sr-only">{t('site.stats.gamesCaption')}</caption>
          <thead>
            <tr><th scope="col">{t('site.stats.game')}</th><th scope="col">{t('site.stats.races')}</th><th scope="col">{t('site.stats.won')}</th><th scope="col">{t('site.stats.avg')}</th><th scope="col">{t('site.stats.notFinished')}</th><th scope="col">{t('site.stats.quota')}</th></tr>
          </thead>
          <tbody>
            {games.map((game) => (
              <tr key={game.name}>
                <td className="font-semibold">{game.name}</td>
                <td className="tabular-nums">{game.races}</td>
                <td className="tabular-nums">{game.wins} <span className="text-[13px] text-[rgb(var(--mg-muted))]">({formatPercent(game.winPercent)})</span></td>
                <td className="tabular-nums">{formatGameAvg(game, t)}</td>
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
