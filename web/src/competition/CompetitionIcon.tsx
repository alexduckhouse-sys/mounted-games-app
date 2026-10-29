import { Globe, Trophy } from 'lucide-react';
import { competitionIcon } from './icons';

const RING = 'rounded-[2px] shadow-[0_0_0_1px_rgb(0_0_0/0.12)] dark:shadow-[0_0_0_1px_rgb(255_255_255/0.22)]';

/** The chequered flag drawn as a 6 × 4 board, the size of a 3:2 flag. Black and white whatever the theme, as a flag image would be. */
function Chequered() {
  return (
    <svg viewBox="0 0 6 4" data-icon="flag" aria-hidden="true" className={`block aspect-[3/2] w-full ${RING}`}>
      <rect width="6" height="4" fill="#fff" />
      <path fill="#1a1a1a" d="M0 0h1v1H0zm2 0h1v1H2zm2 0h1v1H4zM1 1h1v1H1zm2 0h1v1H3zm2 0h1v1H5zM0 2h1v1H0zm2 0h1v1H2zm2 0h1v1H4zM1 3h1v1H1zm2 0h1v1H3zm2 0h1v1H5z" />
    </svg>
  );
}

/** The world and trophy symbols: a navy tile the shape and size of a 3:2 flag, with a line icon in it. The trophy is a
    narrow shape, so it is drawn larger than the round globe to look the same size. A navy surface (the live card) sets
    --ci-tile and --ci-ink to turn the tile white. */
function SymbolTile({ id }: { id: 'world' | 'trophy' }) {
  const Icon = id === 'world' ? Globe : Trophy;
  return (
    <span data-icon={id} className="grid aspect-[3/2] w-full place-items-center rounded-[2px] bg-[rgb(var(--ci-tile,var(--mg-button)))] text-[rgb(var(--ci-ink,var(--mg-button-ink)))]">
      <Icon aria-hidden="true" className={id === 'world' ? 'h-[0.72em] w-[0.72em]' : 'h-[0.84em] w-[0.84em]'} strokeWidth={2.1} />
    </span>
  );
}

/**
 * A competition's icon: a bundled flag image or a drawn symbol, centred in a fixed flag-sized frame (1.625em × 1.125em,
 * 26 × 18px at 16px) so every icon in a list lines up. Flags keep their real proportions inside the frame: wide ones fill
 * the width, and square or 4:3 ones are held to the height, so a square flag doesn't look bigger than a long one.
 * Pass `labelled` where the icon carries meaning that the surrounding text does not already give.
 */
export function CompetitionIcon({ id, labelled = false, className = '' }: { id?: string | null; labelled?: boolean; className?: string }) {
  const icon = competitionIcon(id);
  const a11y = labelled ? { role: 'img', 'aria-label': icon.label, title: icon.label } : { 'aria-hidden': true };
  return (
    <span {...a11y} className={`inline-flex h-[1.125em] w-[1.625em] shrink-0 items-center justify-center leading-none ${className}`}>
      {icon.src
        ? <img src={icon.src} alt="" draggable={false} className={`block h-auto max-h-full w-auto max-w-full object-contain ${RING}`} />
        : icon.id === 'world' || icon.id === 'trophy' ? <SymbolTile id={icon.id} /> : <Chequered />}
    </span>
  );
}
