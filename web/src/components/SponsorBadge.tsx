import type { Sponsor } from '../types';
import { LazyImage } from './LazyImage';
import { isHttpsLink, logoSrc } from '../lib/sponsors';
import { useT } from '../i18n/LanguageContext';

/** Where every sponsor link goes: a new tab, marked as paid and cut off from this page. */
export const SPONSOR_LINK_REL = 'sponsored noopener noreferrer';

/**
 * A sponsor's logo and name, as a link when it has an https address. The logo is served by our own API and
 * waits for a tap in lite mode, like every picture (`LazyImage`).
 */
export function SponsorBadge({ sponsor, large = false }: { sponsor: Sponsor; large?: boolean }) {
  const t = useT();
  const src = sponsor.logoUrl ? logoSrc(sponsor.logoUrl, import.meta.env.VITE_API_BASE) : null;
  const content = (
    <>
      {src && <LazyImage src={src} alt={t('competition.sponsors.logo', { name: sponsor.name })} compact className="mg-sponsor-logo" />}
      <span className="mg-sponsor-name">{sponsor.name}</span>
    </>
  );
  const className = `mg-sponsor ${large ? 'mg-sponsor-large' : ''}`;
  return isHttpsLink(sponsor.linkUrl)
    ? <a className={className} href={sponsor.linkUrl} target="_blank" rel={SPONSOR_LINK_REL}>{content}</a>
    : <div className={className}>{content}</div>;
}
