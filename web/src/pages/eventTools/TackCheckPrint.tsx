import type { TackCheckMode } from '../../types';
import type { PrintableCompetition } from './eventToolsTypes';
import type { PrintableEntryTeam } from './resultsBookTypes';

export interface PrintableTackCheck {
  competition: PrintableCompetition;
  sections: {
    sectionId: number;
    sectionName: string;
    isEnabled: boolean;
    mode: TackCheckMode;
    maxPoints: number;
    sectors: string[];
    teams: PrintableEntryTeam[];
  }[];
}

/** What the stewards write in each sector cell. */
function instruction(mode: TackCheckMode, maxPoints: number) {
  return mode === 0 ? 'Write P (pass) or F (fail) in each sector.' : `Write the points, 0 to ${maxPoints}, in each sector.`;
}

/** Blank tack check forms: one per age group, one row per rider and pony, a column per sector. */
export function TackCheckForms({ data }: { data: PrintableTackCheck }) {
  if (data.sections.length === 0) return <p className="event-print-empty">No age groups have been set up yet.</p>;
  return <>{data.sections.map((section) => <section key={section.sectionId} className="event-print-section event-print-break">
    <h2>{section.sectionName}</h2>
    <p className="event-print-note">{instruction(section.mode, section.maxPoints)} Steward: ____________________</p>
    {section.teams.length === 0 ? <p className="event-print-empty">No teams entered yet.</p> : <div className="event-print-table-wrap"><table>
      <thead><tr><th>Team</th><th>Rider</th><th>Pony</th>{section.sectors.map((name) => <th key={name} className="event-print-cell">{name}</th>)}<th>Notes</th></tr></thead>
      <tbody>{section.teams.flatMap((team) => {
        const label = `${team.teamName}${team.isHorsConcours ? ' (HC)' : ''}${team.withdrawn ? ' (withdrawn)' : ''}`;
        const blanks = section.sectors.map((name) => <td key={name} />);
        if (team.riders.length === 0) return [<tr key={team.teamId}><td>{label}<br /><span className="event-print-note">{team.clubName}</span></td><td colSpan={2}>No declaration yet</td>{blanks}<td /></tr>];
        return team.riders.map((rider, index) => <tr key={`${team.teamId}:${index}`}>
          {index === 0 && <td rowSpan={team.riders.length}>{label}<br /><span className="event-print-note">{team.clubName}</span></td>}
          <td>{rider.name}{rider.isReserve ? ' (reserve)' : ''}</td><td>{rider.pony ?? ''}</td>{blanks}<td />
        </tr>);
      })}</tbody>
    </table></div>}
  </section>)}</>;
}
