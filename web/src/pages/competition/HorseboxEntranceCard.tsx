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

  // At the end of Show full details on Details: the gate's own heading, the organiser's directions as a sentence, then every map link.
  return (
    <section className="dt-gate" aria-labelledby="dt-gate-title">
      <h3 id="dt-gate-title" className="dt-sub-heading">{t('competition.horsebox.heading')}</h3>
      {entrance.directionsNote && <p className="dt-note whitespace-pre-wrap">{entrance.directionsNote}</p>}
      {links.length > 0 && (
        <ul className="fl-list m-0 list-none p-0">
          {links.map((link) => (
            <li key={link.label}>
              <a className="fl-row" href={link.href} target="_blank" rel="noopener noreferrer">
                <span className="fl-grow"><span className="fl-title dt-fact-link">{link.label}</span></span>
                <ExternalLink aria-hidden="true" className="fl-chev h-4 w-4" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
