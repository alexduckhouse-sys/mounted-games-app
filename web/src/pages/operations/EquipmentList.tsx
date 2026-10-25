import { Fragment } from 'react';
import { TickerNumber } from '../../components/TickerNumber';
import { RefineList, RefineNote, RefineSection } from '../refine/Refine';
import type { EquipmentChecklistItem } from './types';

/** Equipment checks grouped by bucket (arena, shared and so on). Each row is one 56 px label, so the whole row is the tap target. */
export function EquipmentList({ items, checked, canWrite, onToggle }: {
  items: EquipmentChecklistItem[];
  checked: Set<string>;
  canWrite: boolean;
  onToggle: (key: string, value: boolean) => void;
}) {
  if (items.length === 0) return <RefineNote>No equipment items were found for the current race list.</RefineNote>;
  const buckets = new Map<string, EquipmentChecklistItem[]>();
  for (const item of items) buckets.set(item.bucket, [...(buckets.get(item.bucket) ?? []), item]);
  return (
    <>
      {[...buckets.entries()].map(([bucket, rows]) => (
        <Fragment key={bucket}>
          <RefineSection title={bucket} meta={<><TickerNumber value={rows.filter((row) => checked.has(row.key)).length} format={String} /> of {rows.length} checked</>} />
          <RefineList as="div">
            {rows.map((item) => (
              <label key={item.key} className="rf-row ops-check">
                <input
                  type="checkbox"
                  checked={checked.has(item.key)}
                  disabled={!canWrite}
                  onChange={(event) => onToggle(item.key, event.target.checked)}
                />
                <span className="rf-grow"><span className="rf-t1">{item.count} × {item.kind}</span></span>
              </label>
            ))}
          </RefineList>
        </Fragment>
      ))}
    </>
  );
}
