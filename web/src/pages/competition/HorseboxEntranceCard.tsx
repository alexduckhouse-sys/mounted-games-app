import { ExternalLink } from 'lucide-react';
import { useT } from '../../i18n/LanguageContext';
import { horseboxEntrance } from '../operations/lorryEntrance';
import type { CompetitionDetail } from '../../types';

/** For lorries and horseboxes when they come in by a different gate from everyone else. Shows nothing if the organiser hasn't said. */
export function HorseboxEntranceCard({ competition }: { competition: Pick<CompetitionDetail, 'lorryWhat3Words' | 'lorryLatitude' | 'lorryLongitude' | 'lorryDirectionsNote'> }) {
  const t = useT();
  const entrance = horseboxEntrance(competition);
  if (!entrance) return null;
  const links = [
    { label: 'Google Maps', href: entrance.googleMapsUrl },
    { label: 'Apple Maps', href: entrance.appleMapsUrl },
    { label: 'Waze', href: entrance.wazeUrl },
    { label: entrance.what3WordsDisplay ? `what3words ${entrance.what3WordsDisplay}` : 'what3words', href: entrance.what3WordsUrl },
  ].filter((link): link is { label: string; href: string } => link.href !== null);

  return (
    <>
      <h2 className="sp-sec">{t('competition.horsebox.heading')}</h2>
      <div className="sp-card" role="group" aria-label={t('competition.horsebox.heading')}>
        {entrance.directionsNote && (
          <div className="sp-row"><span className="sp-grow"><span className="sp-t1 !font-medium whitespace-pre-wrap">{entrance.directionsNote}</span></span></div>
        )}
        {links.map((link) => (
          <a key={link.label} className="sp-row" href={link.href} target="_blank" rel="noopener noreferrer">
            <span className="sp-grow"><span className="sp-t1 !font-medium">{link.label}</span></span>
            <ExternalLink aria-hidden="true" className="sp-chev h-4 w-4" />
          </a>
        ))}
      </div>
    </>
  );
}
