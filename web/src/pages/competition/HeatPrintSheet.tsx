import { hatbandFor, bibName, inLaneOrder } from '../../lib/laneOrder';
import { hatbandName } from '../../lib/hatbands';
import { heatTotals } from '../../lib/raceSummary';
import { statusLetter } from '../../lib/resultStatus';
import { ordinal } from '../../lib/toplist';
import type { Heat, HeatEntry, Race, TieBreakRule } from '../../types';
import { displayLaneFor, type LaneRules } from './laneRules';
import './scoring.css';
import { formatPoints } from '../../lib/formatPoints';
import { QrCode } from '../../components/QrCode';

/**
 * A clean one-page copy of the heat for printing: lanes in each race, teams with their bib and hatband colours,
 * every race's place and points, totals and position. It is hidden on screen and is all that prints.
 */
export function HeatPrintSheet({ heat, races, rules, hcTeamIds, tieRule, hatbands, competitionId }: {
  heat: Heat;
  races: Race[];
  rules: LaneRules;
  hcTeamIds: ReadonlySet<number>;
  tieRule: TieBreakRule;
  hatbands?: string[] | null;
  /** When given, a small QR code on the sheet opens the public standings. It never carries a scorer link. */
  competitionId?: number | null;
}) {
  const done = races.reduce((last, r, i) => (r.isComplete ? i : last), -1);
  const totals = new Map(heatTotals(heat, races, Math.max(done, 0), hcTeamIds, tieRule).map((t) => [t.teamId, t]));
  const teams = inLaneOrder(heat, 0, rules);
  const cell = (race: Race, i: number, e: HeatEntry) => {
    const r = race.isComplete ? race.results.find((x) => x.teamId === e.teamId && !x.isSitOut) : undefined;
    const result = !r ? '' : r.eliminated ? statusLetter(true, r.status) ?? 'E' : `${ordinal(r.placing ?? 0)} (${formatPoints(r.points)})`;
    return `Lane ${displayLaneFor(heat, e, i, rules)}${result ? `: ${result}` : ''}`;
  };
  return (
    <section className="sc-print" aria-label="Printable heat table">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12pt', marginBottom: '8pt' }}>
        <h2 style={{ margin: 0 }}>{heat.label ?? 'Heat'}</h2>
        {competitionId != null && (
          <div style={{ flex: 'none', width: '22mm', textAlign: 'center', fontSize: '8pt', lineHeight: 1.2 }}>
            <QrCode value={`${window.location.origin}/competitions/${competitionId}/toplists`} label="QR code for the live scores" />
            <span>Live scores</span>
          </div>
        )}
      </div>
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
                  return <td key={r.id}>{cell(r, i, e)}{hat ? ` · ${hatbandName(hat)} hatband` : ''}</td>;
                })}
                <td>{formatPoints(t?.points ?? 0)}</td>
                <td>{t?.hc ? 'HC' : t?.position ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
