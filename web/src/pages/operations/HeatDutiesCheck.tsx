import { useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useT } from '../../i18n/LanguageContext';
import {
  emptySlots, findClashes, gridCell, gridColumns, heatTitle, shortHeatTitle, teamDutyCounts, teamLoad,
  type DutySession, type GridColumn, type SlotState,
} from '../../lib/heatDuties';
import type { Team } from '../../types';
import { RefineSection } from '../refine/Refine';
import { roleWithLane } from './heatDutiesText';

const SHOWN_ISSUES = 4;

/** Step 3: what's still empty, any clashes, the whole grid and how many duties each team has. */
export function HeatDutiesCheck({ sessions, state, teams }: { sessions: readonly DutySession[]; state: SlotState; teams: readonly Team[] }) {
  const t = useT();
  const order = useMemo(() => sessions.flatMap((item) => item.heats.map((heat) => heat.id)), [sessions]);
  const heats = useMemo(() => new Map(sessions.flatMap((item) => item.heats.map((heat) => [heat.id, heat] as const))), [sessions]);
  const titles = useMemo(() => new Map(sessions.flatMap((item) => item.heats.map((heat, index) => [heat.id, heatTitle(heat, index)] as const))), [sessions]);
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const columns = useMemo(() => gridColumns(state.slots, order), [state.slots, order]);
  const clashes = useMemo(() => findClashes(state.slots, heats), [state.slots, heats]);
  const load = useMemo(() => teamLoad(teams, teamDutyCounts(state.slots)), [teams, state.slots]);
  const empties = order.flatMap((heatId) => emptySlots(state.slots[heatId] ?? []).map((slot) => ({ heatId, slot })));
  const name = (id: number | null) => (id == null ? null : teamsById.get(id)?.displayName ?? '?');
  const columnLabel = (column: GridColumn) => (column.kind === 'custom' ? column.name : t(`duties.col.${column.kind}`));

  return (
    <div className="hd-step">
      {empties.length > 0 ? (
        <div className="hd-issue" role="status">
          <b className="hd-issue-n">{empties.length}</b>
          <div>
            <p className="hd-issue-t">{t('duties.check.empty', { count: empties.length })}</p>
            <p className="hd-issue-l">
              {empties.slice(0, SHOWN_ISSUES).map(({ heatId, slot }) => `${titles.get(heatId)} ${roleWithLane(slot, t).toLowerCase()}`).join(' · ')}
              {empties.length > SHOWN_ISSUES && ` · ${t('duties.check.more', { count: empties.length - SHOWN_ISSUES })}`}
            </p>
          </div>
        </div>
      ) : (
        <div className="hd-issue is-ok" role="status"><CheckCircle2 className="h-6 w-6" aria-hidden="true" /><p className="hd-issue-t">{t('duties.check.allGood')}</p></div>
      )}

      {clashes.length > 0 && (
        <ul className="hd-clashes" aria-label={t('duties.check.clashes')}>
          {clashes.map((clash) => (
            <li key={`${clash.kind}-${clash.heatId}-${clash.teamId}`}>
              {clash.kind === 'double'
                ? t('duties.clash.double', { heat: titles.get(clash.heatId) ?? '', team: name(clash.teamId) ?? '', count: clash.roles.length })
                : t('duties.clash.riding', { heat: titles.get(clash.heatId) ?? '', team: name(clash.teamId) ?? '' })}
            </li>
          ))}
        </ul>
      )}

      {sessions.map(({ session, heats: sessionHeats }) => (
        <section key={session.id} aria-label={session.name}>
          <RefineSection title={session.name} />
          <div className="hd-grid-card">
            <div className="hd-grid-scroll" tabIndex={0} role="region" aria-label={t('duties.check.grid', { session: session.name })}>
              <table className="hd-grid">
                <thead>
                  <tr><th scope="col" className="hd-h"><span className="hd-sr">{t('duties.check.heat')}</span></th>{columns.map((column) => <th key={column.id} scope="col">{columnLabel(column)}</th>)}</tr>
                </thead>
                <tbody>
                  {sessionHeats.map((heat, index) => {
                    const slots = state.slots[heat.id] ?? [];
                    const gap = emptySlots(slots).length > 0;
                    return (
                      <tr key={heat.id} className={gap ? 'has-gap' : undefined}>
                        <th scope="row" className="hd-h" title={heatTitle(heat, index)}>{shortHeatTitle(heat, index)}</th>
                        {columns.map((column) => {
                          const cell = gridCell(slots, column);
                          if (cell.kind === 'none') return <td key={column.id} className="hd-none">–</td>;
                          if (cell.kind === 'many') return <td key={column.id} className={cell.filled < cell.total ? 'is-empty' : undefined}>{t('duties.cell.of', { filled: cell.filled, total: cell.total })}</td>;
                          const team = name(cell.teamId);
                          return team ? <td key={column.id} className="hd-cell" title={team}>{team}</td> : <td key={column.id} className="is-empty">{t('duties.cell.empty')}</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ))}

      <section aria-label={t('duties.perTeam')}>
        <RefineSection title={t('duties.perTeam')} meta={t('duties.perTeam.range', { fewest: load.fewest, most: load.most })} />
        <ul className="hd-bars">
          {load.rows.map(({ team, count }) => (
            <li key={team.id}>
              <span className="hd-bar-name">{team.displayName}</span>
              <span className="hd-bar-track" aria-hidden="true"><span className="hd-bar-fill" style={{ transform: `scaleX(${load.most > 0 ? count / load.most : 0})` }} /></span>
              <b className="hd-bar-n" aria-label={t('duties.pick.count', { count })}>{count}</b>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
