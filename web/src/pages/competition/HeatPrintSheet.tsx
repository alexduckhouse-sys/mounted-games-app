import { hatbandFor, bibName, inLaneOrder } from '../../lib/laneOrder';
import { heatTotals } from '../../lib/raceSummary';
import { statusLetter } from '../../lib/resultStatus';
import { ordinal } from '../../lib/toplist';
import type { Heat, HeatEntry, Race, TieBreakRule } from '../../types';
import { displayLaneFor, type LaneRules } from './laneRules';
import './scoring.css';

/**
 * A clean one-page copy of the heat for printing: lanes in each race, teams with their bib and hatband colours,
 * every race's place and points, totals and position. It is hidden on screen and is all that prints.
 */
export function HeatPrintSheet({ heat, races, rules, hcTeamIds, tieRule, hatbands }: {
  heat: Heat;
  races: Race[];
  rules: LaneRules;
  hcTeamIds: ReadonlySet<number>;
  tieRule: TieBreakRule;
  hatbands?: string[] | null;
}) {
  const done = races.reduce((last, r, i) => (r.isComplete ? i : last), -1);
  const totals = new Map(heatTotals(heat, races, Math.max(done, 0), hcTeamIds, tieRule).map((t) => [t.teamId, t]));
  const teams = inLaneOrder(heat, 0, rules);
  const cell = (race: Race, i: number, e: HeatEntry) => {
    const r = race.isComplete ? race.results.find((x) => x.teamId === e.teamId && !x.isSitOut) : undefined;
    const result = !r ? '' : r.eliminated ? statusLetter(true, r.status) ?? 'E' : `${ordinal(r.placing ?? 0)} (${r.points})`;
    return `Lane ${displayLaneFor(heat, e, i, rules)}${result ? `: ${result}` : ''}`;
  };
  return (
    <section className="sc-print" aria-label="Printable heat table">
      <h2>{heat.label ?? 'Heat'}</h2>
      <table>
        <thead>
          <tr>
            <th>Team</th><th>Bib</th>
            {races.map((r) => <th key={r.id}>{r.name}</th>)}
            <th>Total</th><th>Position</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((e) => {
            const t = totals.get(e.teamId);
            return (
              <tr key={e.id}>
                <th scope="row">{e.teamName}{hcTeamIds.has(e.teamId) ? ' (HC)' : ''}</th>
                <td>{bibName(e.bibColour)}</td>
                {races.map((r, i) => {
                  const hat = hatbandFor(hatbands, displayLaneFor(heat, e, i, rules));
                  return <td key={r.id}>{cell(r, i, e)}{hat ? ` · ${hat} hatband` : ''}</td>;
                })}
                <td>{t?.points ?? 0}</td>
                <td>{t?.hc ? 'HC' : t?.position ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
