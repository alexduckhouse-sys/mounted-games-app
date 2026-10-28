import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';

import { useT } from '../../i18n/LanguageContext';
import { arenaCrewPath } from './crewDutyHelpers';

/** A link to the phone prop sheet for the arena crew and line stewards. */
export function ArenaCrewLink({ competitionId, sessionId, heatId, className }: {
  competitionId: number;
  sessionId?: number | null;
  heatId?: number | null;
  className?: string;
}) {
  const t = useT();
  return (
    <Link
      to={arenaCrewPath(competitionId, sessionId, heatId)}
      className={className ?? 'inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))] px-3.5 text-base font-semibold text-[rgb(var(--mg-ink))] hover:bg-[rgb(var(--mg-subtle))]'}
    >
      <ClipboardList size={18} aria-hidden="true" />
      {t('competition.details.arenaCrew')}
    </Link>
  );
}
