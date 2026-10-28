import type { StatsGame, StatsRun, StatsSummary } from '../types';
import { formatPercent, plural } from './stats';
import { localOrdinal } from './ordinalText';

export interface HeadlineFact { value: string; label: string }

const oneDecimal = (value: number) => (Math.round(value * 10) / 10).toFixed(1);

/** The four big figures at the top of a team profile's stats page: races won, points per race, average place, podiums. */
export function headlineFacts(summary: StatsSummary): HeadlineFact[] {
  const podiums = summary.firsts + summary.seconds + summary.thirds;
  return [
    { value: formatPercent(summary.winPercent), label: `Races won (${summary.wins} of ${summary.races})` },
    { value: summary.races > 0 ? oneDecimal(summary.points / summary.races) : '—', label: 'Points per race' },
    { value: summary.averagePlace == null ? '—' : oneDecimal(summary.averagePlace), label: 'Average place' },
    { value: String(podiums), label: `Podiums in ${plural(summary.competitions, 'competition')}` },
  ];
}

/** "Mid-Wales", "Winter Pairs"... what is left of each competition's name once the words they all start with are taken off. */
export function distinctNames(names: readonly string[]): string[] {
  const words = names.map((name) => name.trim().split(/\s+/).filter(Boolean));
  const unique = new Set(names.map((name) => name.trim().toLowerCase()));
  let common = 0;
  if (unique.size > 1) {
    const shortest = Math.min(...words.map((list) => list.length));
    // Never strip a name to nothing: stop one word short of the shortest.
    while (common < shortest - 1 && words.every((list) => list[common].toLowerCase() === words[0][common].toLowerCase())) common += 1;
  }
  return words.map((list, index) => list.slice(common).join(' ') || names[index].trim());
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The two short lines under each bar: the competition (its first distinguishing word) and its month, with the year
 * too when the runs span more than one. The date is read as written (its first ten characters), so the viewer's time zone
 * can't move a run into another month.
 */
export function runLabels(runs: readonly StatsRun[]): string[][] {
  const names = distinctNames(runs.map((run) => run.competitionName));
  const dates = runs.map((run) => /^(\d{4})-(\d{2})/.exec(run.startDate));
  const years = new Set(dates.map((match) => match?.[1]));
  return runs.map((_, index) => {
    const match = dates[index];
    const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
    const when = month ? (years.size > 1 ? `${month} ${match![1].slice(2)}` : month) : '';
    return [names[index].split(/\s+/)[0], when].filter(Boolean);
  });
}

/** What goes over a bar: the place, E for a run that was put out, a dash for one with no place. */
export function runPlaceText(run: StatsRun): string {
  if (run.eliminated) return 'E';
  return run.place != null && run.place > 0 ? localOrdinal(run.place, 'en') : '–';
}

/** The whole run in words, for the bar's tip and screen readers: "National, Aug 2026: 2nd, 4 points". */
export function runDescription(run: StatsRun): string {
  const result = run.eliminated ? 'put out' : run.place != null && run.place > 0 ? localOrdinal(run.place, 'en') : 'not placed';
  return `${run.competitionName}, ${run.startDate.slice(0, 10)}: ${result}, ${plural(run.points, 'point')}`;
}

/** "Every Bending run · best 6, worst 3, won 4 of 7": the line above a game's graph. */
export function gameRunsLine(game: StatsGame, runs: readonly StatsRun[]): string {
  if (runs.length === 0) return `${game.name} · won ${game.wins} of ${game.races}`;
  const points = runs.map((run) => run.points);
  const spread = `best ${Math.max(...points)}, worst ${Math.min(...points)}, `;
  const shown = runs.length < game.races ? `Latest ${plural(runs.length, 'run')} of ${game.name}` : `Every ${game.name} run`;
  return `${shown} · ${spread}won ${game.wins} of ${game.races}`;
}

/** The average points a run for a game, as the API sent it or worked out from its totals. */
export function gameAveragePoints(game: StatsGame): number | null {
  if (game.averagePoints != null) return game.averagePoints;
  return game.races > 0 ? Math.round((game.points / game.races) * 10) / 10 : null;
}
