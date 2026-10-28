import { useT } from '../../i18n/LanguageContext';
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
  const t = useT();
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
    return <PageProblem title={t('ops3.poster.loadFail')} primaryLabel={t('common.tryAgain')} onPrimary={() => setAttempt(attempt + 1)}>{t('ops2.print.checkSignal')}</PageProblem>;
  }
  if (!poster) return <p className="mg-card p-4" role="status">{t('ops3.poster.preparing')}</p>;
  if (!canOrganise(poster)) {
    return <PageProblem title={t('ops3.poster.orgOnly')}>{t('ops3.poster.orgOnlyBody')}</PageProblem>;
  }

  const link = competitionLink(poster.id, window.location.origin);
  return (
    <article className="event-print-page event-poster">
      <div className="event-print-controls mb-5 flex flex-wrap gap-2">
        <Link className="mg-btn mg-btn-secondary" to={`/competitions/${poster.id}/details`}><ChevronLeft className="h-4 w-4" />{t('ops2.print.eventDetails')}</Link>
        <button className="mg-btn mg-btn-primary" onClick={() => window.print()}><Printer className="h-4 w-4" />{t('ops2.print.print')}</button>
      </div>
      <p className="event-print-kicker">{t('common.mountedGames')}</p>
      <h1 className="event-poster-title">{poster.name}</h1>
      <p className="event-poster-when">{competitionDateText(poster.startDate, poster.endDate, true)}</p>
      {poster.location && <p className="event-poster-where">{poster.location}</p>}
      <QrCode value={link} label={t('ops3.poster.qr', { name: poster.name })} className="event-poster-qr" />
      <p className="event-poster-scan">{t('ops3.poster.scan')}</p>
      <p className="event-poster-link">{link.replace(/^https?:\/\//, '')}</p>
    </article>
  );
}
