/** The tick a copy button shows once its link is copied: it pops in and draws itself (CSS, so lite mode stills it). */
export function CopiedTick({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={`mg-copied-tick ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <path pathLength={1} d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
