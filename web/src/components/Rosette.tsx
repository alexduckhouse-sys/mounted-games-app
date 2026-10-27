import type { ReactNode } from 'react';
import { useT } from '../i18n/LanguageContext';

/** A ring of pleats: points alternating between the outer and inner radius. */
function pleats(cx: number, cy: number, outer: number, inner: number, count: number): string {
  const points: string[] = [];
  for (let i = 0; i < count * 2; i++) {
    const angle = (Math.PI * i) / count - Math.PI / 2;
    const radius = i % 2 ? inner : outer;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`);
  }
  return points.join(' ');
}

/**
 * A show rosette in the app's navy and gold. With `tails`, its two ribbons carry those words (team and section);
 * without, the ribbons are short and the centre plain, for a small badge. `year`, when known, is the event's year
 * in the centre of a ribboned rosette.
 */
export function Rosette({ width, tails, year }: { width: number; tails?: [string, string]; year?: number }) {
  const long = tails !== undefined;
  return (
    <svg className="mg-rosette" width={width} viewBox={`0 0 190 ${long ? 220 : 186}`} aria-hidden="true">
      {long ? <>
        <polygon points="62,104 92,104 92,214 77,198 62,214" fill="#17385F" />
        <polygon points="98,104 128,104 128,214 113,198 98,214" fill="#17385F" />
        <text x="77" y="150" fill="#fff" fontFamily="var(--mg-font-display, sans-serif)" fontWeight="700" fontSize="13" textAnchor="middle" transform="rotate(90 77 150)">{tails[0]}</text>
        <text x="113" y="150" fill="#fff" fontFamily="var(--mg-font-display, sans-serif)" fontWeight="700" fontSize="13" textAnchor="middle" transform="rotate(90 113 150)">{tails[1]}</text>
      </> : <>
        <polygon points="62,104 92,104 92,180 77,166 62,180" fill="#17385F" />
        <polygon points="98,104 128,104 128,180 113,166 98,180" fill="#17385F" />
      </>}
      <polygon points={pleats(95, 80, 70, 58, 36)} fill="#17385F" />
      <polygon points={pleats(95, 80, 56, 46, 30)} fill="#F5B82E" />
      <polygon points={pleats(95, 80, 44, 37, 26)} fill="#fff" />
      <circle cx="95" cy="80" r="33" fill="#17385F" />
      {long && <text x="95" y="77" fill="#F5B82E" fontFamily="var(--mg-font-display, sans-serif)" fontWeight="700" fontSize="17" textAnchor="middle">MG</text>}
      {long && year !== undefined && <text x="95" y="96" fill="#fff" fontFamily="var(--mg-font, sans-serif)" fontWeight="600" fontSize="11" textAnchor="middle">{year}</text>}
    </svg>
  );
}

/**
 * The moment an entry is in: a rosette drops in and swings to rest with the team and section on its tails, over
 * "You're entered". The swing is CSS, so lite mode and reduced motion still it.
 */
export function EntryRosette({ team, section, year, children }: { team: string; section: string; year: number; children?: ReactNode }) {
  const t = useT();
  // Long names are cut so they fit on a ribbon.
  const fit = (text: string) => (text.length > 18 ? `${text.slice(0, 17)}…` : text);
  return (
    <div className="mg-entry-rosette" role="status">
      <span className="mg-entry-rosette-hang"><Rosette width={120} tails={[fit(team), fit(section)]} year={year} /></span>
      <strong>{t('entries.rosette.entered')}</strong>
      <span className="sr-only">{team}, {section}</span>
      {children && <span className="mg-entry-rosette-note">{children}</span>}
    </div>
  );
}
