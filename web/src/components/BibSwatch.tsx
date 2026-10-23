import { bibAccent } from '../lib/bib';
import { bibName } from '../lib/laneOrder';

/** A colour dot with the bib colour's name beside it. The name is always shown so the colour never stands alone. */
export function BibSwatch({ colour, className = '' }: { colour: string | null | undefined; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium leading-tight ${className}`}>
      <span
        aria-hidden="true"
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-slate-500 ring-offset-1 ring-offset-white dark:ring-slate-300 dark:ring-offset-slate-800"
        style={{ background: bibAccent(colour) }}
      />
      <span className="truncate">{bibName(colour)}</span>
    </span>
  );
}
