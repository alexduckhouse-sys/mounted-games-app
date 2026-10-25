import { useState, type ReactNode } from 'react';

/**
 * A status that pops when it changes while you look (an organiser marks an entry Paid), not when the page first
 * draws it. `tick` adds a small tick that draws itself in, for good news. The pop is CSS, so lite mode and reduced
 * motion still it.
 */
export function ChangePop({ value, tick = false, children }: { value: string; tick?: boolean; children: ReactNode }) {
  const [seen, setSeen] = useState({ value, changes: 0 });
  if (seen.value !== value) setSeen({ value, changes: seen.changes + 1 });
  const changes = seen.value === value ? seen.changes : seen.changes + 1;
  if (changes === 0) return <>{children}</>;
  // A new key starts the pop again for each change.
  return (
    <span key={changes} className="mg-change-pop">
      {tick && <svg viewBox="0 0 24 24" aria-hidden="true"><path pathLength={1} d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      {children}
    </span>
  );
}
