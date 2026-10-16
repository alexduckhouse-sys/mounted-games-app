import { competitionIcon } from './icons';

/**
 * A competition's icon: an emoji, or a bundled flag image sized to sit inline with text.
 * Pass `labelled` where the icon carries meaning that the surrounding text does not already give.
 */
export function CompetitionIcon({ id, labelled = false, className = '' }: { id?: string | null; labelled?: boolean; className?: string }) {
  const icon = competitionIcon(id);
  const a11y = labelled ? { role: 'img', 'aria-label': icon.label, title: icon.label } : { 'aria-hidden': true };
  return (
    <span {...a11y} className={`inline-flex shrink-0 items-center leading-none ${className}`}>
      {icon.src
        ? <img src={icon.src} alt="" draggable={false} className="h-[1.25em] w-auto rounded-[2px] border border-black/15 object-contain dark:border-white/25" />
        : icon.symbol}
    </span>
  );
}
