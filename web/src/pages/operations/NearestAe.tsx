import { useEffect, useState } from 'react';
import { api } from '../../api';
import { tr } from '../../i18n/translate';
import type { NearestEmergency } from '../../types';

/**
 * The "Nearest A&E" block in the poster's emergency box. It asks our own API, which asks OpenStreetMap, and it is only a
 * suggestion for the organiser to check. The poster must always print, so nothing is shown while it loads, and when there
 * is no answer the box gets a reminder line for the screen only (it is hidden on paper).
 */
export function NearestAe({ competitionId }: { competitionId: number | string }) {
  const [answer, setAnswer] = useState<NearestEmergency | 'none' | null>(null);

  useEffect(() => {
    let live = true;
    api.get<NearestEmergency>(`/competitions/${competitionId}/nearest-emergency`)
      .then((response) => { if (live) setAnswer(response.data?.available && response.data.hospital ? response.data : 'none'); })
      .catch(() => { if (live) setAnswer('none'); });
    return () => { live = false; };
  }, [competitionId]);

  if (answer === null) return null;
  if (answer === 'none' || !answer.hospital) {
    return <p className="text-xs sm:col-span-2 print:hidden" role="status">{tr('ops2.print.p.nearestAeCheck')}</p>;
  }
  const { name, postcode, phone, distanceMiles } = answer.hospital;
  return (
    <div className="sm:col-span-2">
      <span className="font-semibold">{tr('ops2.print.p.nearestAe')}</span>
      <p className="text-sm font-medium">{name}</p>
      <p className="flex flex-wrap gap-x-3 text-sm">
        {postcode && <span className="font-mono font-bold">{postcode}</span>}
        {phone && <span>{tr('ops2.print.p.nearestAeTel', { phone })}</span>}
        <span>{tr('ops2.print.p.nearestAeMiles', { count: distanceMiles })}</span>
      </p>
      {/* The credit is the licence's wording (ODbL), so it stays in English whatever the page language. */}
      <p className="mt-1 text-xs">{tr('ops2.print.p.nearestAeSource')} © OpenStreetMap contributors</p>
    </div>
  );
}
