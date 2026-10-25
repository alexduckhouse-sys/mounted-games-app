import { useState, type ReactNode } from 'react';

/**
 * Points that light up once when they change while you watch (a result has just come in), not when the page first
 * draws them. The flash is CSS, so lite mode and reduced motion still it.
 */
export function ScoreFlash({ value, className = '', children }: { value: number; className?: string; children: ReactNode }) {
  const [seen, setSeen] = useState({ value, changes: 0 });
  if (seen.value !== value) setSeen({ value, changes: seen.changes + 1 });
  const changes = seen.value === value ? seen.changes : seen.changes + 1;
  // A new key starts the animation again for each change.
  return <span key={changes} className={`${className}${changes > 0 ? ' mg-score-flash' : ''}`.trim() || undefined}>{children}</span>;
}
