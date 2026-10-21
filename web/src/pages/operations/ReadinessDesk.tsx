import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefineNote } from '../refine/Refine';
import { EquipmentList } from './EquipmentList';
import type { IssueGroup, IssueGroupId } from './readiness';
import type { CompetitionReadiness } from './types';

type Filter = 'all' | IssueGroupId;

interface DeskProps {
  readiness: CompetitionReadiness;
  groups: IssueGroup[];
  checkedEquipment: Set<string>;
  canWrite: boolean;
  saving: boolean;
  saved: boolean;
  onToggle: (key: string, value: boolean) => void;
  onSave: () => void;
}

const TILE_HINT: Record<IssueGroupId, string> = {
  clashes: 'Overlapping sessions in an arena',
  declarations: 'Teams without a declaration',
  payments: 'Entries waiting for payment',
  teams: 'Below the minimum riders',
  equipment: 'Races missing equipment details',
};
const FILTER_LABEL: Record<IssueGroupId, string> = { clashes: 'Clashes', declarations: 'Declarations', payments: 'Payments', teams: 'Teams', equipment: 'Equipment' };
const TILE_ORDER: IssueGroupId[] = ['declarations', 'payments', 'teams', 'clashes'];

/** The wide-screen organiser desk: summary tiles, one issues table grouped under header rows, and the equipment card. */
export function ReadinessDesk({ readiness, groups, checkedEquipment, canWrite, saving, saved, onToggle, onSave }: DeskProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const open = groups.filter((group) => group.items.length > 0);
  const total = open.reduce((sum, group) => sum + group.items.length, 0);
  const equipmentTotal = readiness.equipmentChecklist.length;
  const equipmentDone = readiness.equipmentChecklist.filter((item) => checkedEquipment.has(item.key)).length;
  const byId = (id: IssueGroupId) => groups.find((group) => group.id === id)!;
  const filters: Array<{ id: Filter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: total },
    ...open.map((group) => ({ id: group.id as Filter, label: FILTER_LABEL[group.id], count: group.items.length })),
  ];
  // A filter whose group has just emptied (after a recheck) falls back to showing everything.
  const activeFilter: Filter = filter === 'all' || open.some((group) => group.id === filter) ? filter : 'all';
  const visible = activeFilter === 'all' ? open : open.filter((group) => group.id === activeFilter);

  return (
    <div className="ops-desk">
      <section className="ops-tiles" aria-label="Summary">
        {TILE_ORDER.map((id) => {
          const group = byId(id);
          const count = group.items.length;
          const blocking = group.blocks && count > 0;
          return (
            <button key={id} type="button" className={`ops-tile ${blocking ? 'ops-tile-block' : ''}`} onClick={() => setFilter(id)}>
              <span className="ops-tile-top"><span className={`ops-tile-num ${blocking ? 'ops-num-bad' : ''}`}>{count}</span>{blocking && <span className="ops-tag">Blocks publish</span>}</span>
              <span className="ops-tile-title">{group.title}</span>
              <span className="rf-t2">{TILE_HINT[id]}</span>
            </button>
          );
        })}
        <a className="ops-tile" href="#ops-equipment">
          <span className="ops-tile-top"><span className="ops-tile-num">{equipmentDone}<span className="ops-tile-of">/{equipmentTotal}</span></span></span>
          <span className="ops-tile-title">Equipment checklist</span>
          <span className="ops-bar" role="progressbar" aria-label="Equipment checked" aria-valuemin={0} aria-valuemax={equipmentTotal} aria-valuenow={equipmentDone}><span style={{ width: `${equipmentTotal ? Math.round((equipmentDone / equipmentTotal) * 100) : 0}%` }} /></span>
        </a>
      </section>

      <div className="ops-desk-cols">
        <section className="ops-card ops-resolve" aria-labelledby="ops-resolve-title">
          <div className="ops-card-head">
            <h2 id="ops-resolve-title">To resolve</h2>
            <div role="tablist" aria-label="Filter issues" className="ops-filters">
              {filters.map((item) => (
                <button key={item.id} type="button" role="tab" aria-selected={activeFilter === item.id} className="ops-filter" onClick={() => setFilter(item.id)}>{item.label} {item.count}</button>
              ))}
            </div>
          </div>
          {visible.length === 0
            ? <div className="ops-card-pad"><RefineNote>Nothing to resolve. Every check is clear.</RefineNote></div>
            : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead><tr><th scope="col">Item</th><th scope="col">Section</th><th scope="col">Detail</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
                  <tbody>
                    {visible.map((group) => (
                      <Fragment key={group.id}>
                        <tr className={`ops-group ${group.blocks ? 'ops-group-block' : ''}`}><th scope="colgroup" colSpan={4}>{group.title} · {group.items.length}{group.blocks ? ' · block publishing' : ''}</th></tr>
                        {group.items.map((item) => (
                          <tr key={item.key}>
                            <th scope="row" className="ops-item">{item.subject}</th>
                            <td>{item.section}</td>
                            <td>{item.note}</td>
                            <td className="ops-act"><Link className="rf-btn" to={item.to} aria-label={`${item.action} for ${item.subject}`}>{item.action}</Link></td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </section>

        <section id="ops-equipment" className="ops-card ops-equip" aria-labelledby="ops-equipment-title">
          <div className="ops-card-head"><h2 id="ops-equipment-title">Equipment</h2><span className="rf-t2">{equipmentDone} of {equipmentTotal} ready</span></div>
          <EquipmentList items={readiness.equipmentChecklist} checked={checkedEquipment} canWrite={canWrite} onToggle={onToggle} />
          <div className="ops-card-pad ops-card-foot">
            <button type="button" className="rf-btn rf-btn-primary" onClick={onSave} disabled={saving || !canWrite}>{saving ? 'Saving…' : 'Save checklist'}</button>
            {saved && <span role="status" className="rf-t2">Checklist saved.</span>}
          </div>
        </section>
      </div>
    </div>
  );
}
