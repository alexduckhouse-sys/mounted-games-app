import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Printer } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { PageProblem } from '../../components/PageProblem';
import { QrCode } from '../../components/QrCode';
import { competitionDateText } from '../../lib/competitionDates';
import { competitionLink } from '../../lib/sharing';
import type { CompetitionDetail } from '../../types';
import './printEvent.css';

type Poster = Pick<CompetitionDetail, 'id' | 'name' | 'location' | 'startDate' | 'endDate' | 'createdByUserId'>;

/**
 * The venue poster: the event's name, date and place, and a big QR code to its page. It shows only what the
 * public event page already shows. The link to it is for the event's organisers and helpers.
 */
export function PosterPage({ competitionId }: { competitionId: string }) {
  const { canOrganise } = useAuth();
  const [poster, setPoster] = useState<Poster | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.get<Poster>(`/competitions/${competitionId}`)
      .then(({ data }) => { if (!cancelled) { setPoster(data); setFailed(false); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [competitionId, attempt]);

  if (failed) {
    return <PageProblem title="Couldn’t load this event" primaryLabel="Try again" onPrimary={() => setAttempt(attempt + 1)}>Check your signal and try again.</PageProblem>;
  }
  if (!poster) return <p className="mg-card p-4" role="status">Preparing the poster…</p>;
  if (!canOrganise(poster)) {
    return <PageProblem title="Organisers only">The venue poster is for this event’s organisers.</PageProblem>;
  }

  const link = competitionLink(poster.id, window.location.origin);
  return (
    <article className="event-print-page event-poster">
      <div className="event-print-controls mb-5 flex flex-wrap gap-2">
        <Link className="mg-btn mg-btn-secondary" to={`/competitions/${poster.id}/details`}><ChevronLeft className="h-4 w-4" />Event details</Link>
        <button className="mg-btn mg-btn-primary" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</button>
      </div>
      <p className="event-print-kicker">Mounted Games</p>
      <h1 className="event-poster-title">{poster.name}</h1>
      <p className="event-poster-when">{competitionDateText(poster.startDate, poster.endDate, true)}</p>
      {poster.location && <p className="event-poster-where">{poster.location}</p>}
      <QrCode value={link} label={`QR code that opens ${poster.name} on Mounted Games`} className="event-poster-qr" />
      <p className="event-poster-scan">Scan to see the timetable, live scores and results</p>
      <p className="event-poster-link">{link.replace(/^https?:\/\//, '')}</p>
    </article>
  );
}
