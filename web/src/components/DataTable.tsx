import type { ReactNode } from 'react';
import { useIsDesktop } from '../hooks/useMediaQuery';

export interface DataColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** The row's title on phones (shown big, with no label). One column should be primary. */
  primary?: boolean;
  /** Right-align numbers on the table. */
  numeric?: boolean;
}

/** A table on laptops, card rows on phones. Renders only one of the two so text is never duplicated. */
export function DataTable<T>({ rows, columns, rowKey, caption, empty, onRowClick }: {
  rows: T[];
  columns: DataColumn<T>[];
  rowKey: (row: T) => string | number;
  caption: string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
}) {
  const desktop = useIsDesktop();
  if (rows.length === 0) return <>{empty ?? null}</>;
  if (desktop) {
    return (
      <div className="mg-card overflow-x-auto">
        <table className="w-full border-collapse text-left text-[15px]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b-2 border-[rgb(var(--mg-heading))]">
              {columns.map((c) => <th key={c.key} scope="col" className={`px-3 py-2.5 text-[12px] font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-muted))] ${c.numeric ? 'text-right' : ''}`}>{c.header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-[rgb(var(--mg-rule-soft))] last:border-b-0 ${onRowClick ? 'cursor-pointer hover:bg-[rgb(var(--mg-subtle))]' : ''}`}>
                {columns.map((c) => <td key={c.key} className={`px-3 py-2.5 align-middle ${c.numeric ? 'text-right tabular-nums' : ''}`}>{c.cell(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary);
  return (
    <ul aria-label={caption} className="mg-card mg-list m-0 list-none p-0">
      {rows.map((row) => (
        <li key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined} className="flex flex-col gap-1 px-3 py-2.5">
          <div className="text-[16px] font-bold text-[rgb(var(--mg-heading))]">{primary.cell(row)}</div>
          {rest.map((c) => (
            <div key={c.key} className="flex items-baseline justify-between gap-3 text-[14px]">
              <span className="text-[rgb(var(--mg-muted))]">{c.header}</span>
              <span className="min-w-0 text-right">{c.cell(row)}</span>
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}
