import { bibAccent } from '../lib/bib';
import { bibName } from '../lib/laneOrder';

/**
 * A colour dot with the bib colour's name beside it. The name is always shown so the colour never stands alone,
 * and the dot has a ring in the text colour so a white or black bib still shows on any theme.
 */
export function BibSwatch({ colour, className = '' }: { colour: string | null | undefined; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium leading-tight text-[rgb(var(--mg-body))] ${className}`}>
      <span
        aria-hidden="true"
        className="inline-block h-3 w-3 shrink-0 rounded-full"
        style={{ background: bibAccent(colour), boxShadow: '0 0 0 1.5px rgb(var(--mg-surface)), 0 0 0 2.5px rgb(var(--mg-muted))' }}
      />
      <span className="truncate">{bibName(colour)}</span>
    </span>
  );
}
