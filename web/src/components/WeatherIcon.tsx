import { weatherKind } from '../lib/weatherKind';

const SUN = '#F6C344';
const CLOUD = '#D5DEE9';
const GREY_CLOUD = '#C3CEDC';
const RAIN = '#5B8DEF';

/** A soft, filled weather picture in a few flat colours. Drawn on a 64 by 64 grid and decorative: the weather is always written next to it. */
export function WeatherIcon({ code, isDay = true, className = 'h-9 w-9' }: { code?: number; isDay?: boolean; className?: string }) {
  const kind = weatherKind(code, isDay);
  return (
    <svg className={`shrink-0 ${className}`} viewBox="0 0 64 64" aria-hidden="true" data-kind={kind}>
      {kind === 'sun' && <>
        <circle cx="32" cy="32" r="13" fill={SUN} />
        <path d="M32 8v7M32 49v7M8 32h7M49 32h7M15 15l5 5M44 44l5 5M49 15l-5 5M20 44l-5 5" stroke={SUN} strokeWidth="4" strokeLinecap="round" />
      </>}
      {kind === 'moon' && <path d="M40 10a22 22 0 1 0 14 38A18 18 0 0 1 40 10z" fill={SUN} />}
      {kind === 'part' && <>
        <circle cx="24" cy="24" r="11" fill={SUN} />
        <path d="M20 52h26a10 10 0 0 0 0-20 13 13 0 0 0-25 4 8 8 0 0 0-1 16z" fill={CLOUD} />
      </>}
      {kind === 'cloud' && <path d="M16 48h32a11 11 0 0 0 0-22 14 14 0 0 0-27 4 9 9 0 0 0-5 18z" fill={CLOUD} />}
      {kind === 'fog' && <>
        <path d="M16 36h30a10 10 0 0 0 0-20 13 13 0 0 0-25 4 8 8 0 0 0-5 16z" fill={CLOUD} />
        <path d="M14 46h36M20 54h28" stroke={GREY_CLOUD} strokeWidth="4" strokeLinecap="round" />
      </>}
      {kind === 'rain' && <>
        <path d="M16 42h30a11 11 0 0 0 0-22 14 14 0 0 0-27 4 9 9 0 0 0-3 18z" fill={GREY_CLOUD} />
        <path d="M24 48l-3 7M34 48l-3 7M44 48l-3 7" stroke={RAIN} strokeWidth="4" strokeLinecap="round" />
      </>}
      {kind === 'snow' && <>
        <path d="M16 42h30a11 11 0 0 0 0-22 14 14 0 0 0-27 4 9 9 0 0 0-3 18z" fill={GREY_CLOUD} />
        <circle cx="22" cy="52" r="3" fill="#fff" stroke={GREY_CLOUD} />
        <circle cx="33" cy="54" r="3" fill="#fff" stroke={GREY_CLOUD} />
        <circle cx="44" cy="52" r="3" fill="#fff" stroke={GREY_CLOUD} />
      </>}
      {kind === 'storm' && <>
        <path d="M16 40h30a11 11 0 0 0 0-22 14 14 0 0 0-27 4 9 9 0 0 0-3 18z" fill="#9AA7BA" />
        <path d="M34 38l-8 12h7l-3 10 11-15h-7z" fill={SUN} />
      </>}
    </svg>
  );
}
