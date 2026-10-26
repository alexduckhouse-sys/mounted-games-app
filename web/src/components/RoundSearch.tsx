import { Search } from 'lucide-react';
import './sitePages.css';

/**
 * A round search bar with a magnifying glass and no label above it. `band` is for the navy band under the app
 * header (white, no border); without it the bar sits on the page with a grey border. `label` is read aloud only.
 */
export function RoundSearch({ label, placeholder, value, onChange, band = false, maxLength, className = '' }: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  band?: boolean;
  maxLength?: number;
  className?: string;
}) {
  return (
    <label className={`sp-search ${band ? 'sp-search-band' : ''} ${className}`.trim()}>
      <Search className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input type="search" placeholder={placeholder} value={value} maxLength={maxLength} autoComplete="off" enterKeyHint="search" onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
