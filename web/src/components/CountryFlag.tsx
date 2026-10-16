import { COUNTRIES } from '../lib/countries';

/**
 * Small flag image for a competition's country. Rendered as an image rather
 * than an emoji because flag emoji show as plain letters on Windows.
 * Renders nothing when there is no code.
 */
export function CountryFlag({ code, className = '' }: { code?: string | null; className?: string }) {
  if (!code) return null;
  const name = COUNTRIES.find((c) => c.code === code)?.name ?? code.toUpperCase();
  return (
    <img
      src={`https://flagcdn.com/w40/${code}.png`}
      srcSet={`https://flagcdn.com/w80/${code}.png 2x`}
      alt={name}
      title={name}
      loading="lazy"
      width={20}
      height={15}
      className={`inline-block h-[15px] w-5 shrink-0 rounded-[2px] object-cover shadow-sm ${className}`}
      onError={(e) => { e.currentTarget.style.display = 'none'; }}
    />
  );
}
