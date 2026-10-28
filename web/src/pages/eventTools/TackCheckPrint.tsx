import { tr } from '../../i18n/translate';
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
  return mode === 0 ? tr('ops3.tackPrint.pf') : tr('ops3.tackPrint.points', { max: maxPoints });
}

/** Blank tack check forms: one per age group, one row per rider and pony, a column per sector. */
export function TackCheckForms({ data }: { data: PrintableTackCheck }) {
  if (data.sections.length === 0) return <p className="event-print-empty">{tr('ops3.tackPrint.noGroups')}</p>;
  return <>{data.sections.map((section) => <section key={section.sectionId} className="event-print-section event-print-break">
    <h2>{section.sectionName}</h2>
    <p className="event-print-note">{instruction(section.mode, section.maxPoints)} {tr('ops3.tackPrint.steward')}</p>
    {section.teams.length === 0 ? <p className="event-print-empty">{tr('ops3.tackPrint.noTeams')}</p> : <div className="event-print-table-wrap"><table>
      <thead><tr><th>{tr('ops2.print.team')}</th><th>{tr('ops3.rider')}</th><th>{tr('ops3.pony')}</th>{section.sectors.map((name) => <th key={name} className="event-print-cell">{name}</th>)}<th>{tr('ops3.notes')}</th></tr></thead>
      {/* One body per team, so a team's riders are never split across two printed pages. */}
      {section.teams.map((team) => {
        const label = `${team.teamName}${team.isHorsConcours ? ' (HC)' : ''}${team.withdrawn ? ` (${tr('ops3.withdrawn')})` : ''}`;
        const blanks = section.sectors.map((name) => <td key={name} />);
        return <tbody key={team.teamId} className="event-print-team">
          {team.riders.length === 0
            ? <tr><td>{label}</td><td colSpan={2}>{tr('ops3.tackPrint.noDec')}</td>{blanks}<td /></tr>
            : team.riders.map((rider, index) => <tr key={index}>
              {index === 0 && <td rowSpan={team.riders.length}>{label}</td>}
              <td>{rider.name}{rider.isReserve ? ` (${tr('ops2.sos.reserve')})` : ''}</td><td>{rider.pony ?? ''}</td>{blanks}<td />
            </tr>)}
        </tbody>;
      })}
    </table></div>}
  </section>)}</>;
}
