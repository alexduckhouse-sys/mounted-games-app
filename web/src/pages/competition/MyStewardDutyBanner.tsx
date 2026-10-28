import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useFavourites } from '../../hooks/useFavourites';
import { isShiftCheckedInHere, isShiftMarkedMissing, myTeamAssignedDuties } from '../../lib/lorryAndVolunteers';
import type { VolunteerShift } from '../../types';
import { useT } from '../../i18n/LanguageContext';
import { ArenaCrewLink } from './ArenaCrewLink';
import { useCompetition } from './context';

function timeLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Tells a team member or follower (signed in or not) which steward or arena crew duties their team has, and lets them check in. Hidden when there are none. */
export function MyStewardDutyBanner() {
  const { competition } = useCompetition();
  const { user } = useAuth();
  const t = useT();
  const { favourites } = useFavourites();
  const [shifts, setShifts] = useState<VolunteerShift[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const userId = user?.id ?? null;
  const base = `/competitions/${competition.id}`;
  // Teams this device follows in this event. Following is enough to check a duty in, so no sign-in is needed.
  const followedKey = favourites.filter((f) => f.competitionId === competition.id).map((f) => f.teamId).sort((a, b) => a - b).join(',');
  const followedIds = followedKey ? followedKey.split(',').map(Number) : [];

  useEffect(() => {
    if (!userId && !followedKey) return;
    let live = true;
    (async () => {
      try {
        const { data } = await api.get<VolunteerShift[]>(`${base}/volunteer-shifts`);
        if (live && Array.isArray(data)) setShifts(data);
      } catch { /* the banner is a convenience; stay hidden if the list can't load */ }
    })();
    return () => { live = false; };
  }, [base, userId, followedKey]);

  // The server says which duties a signed-in person's teams can check in to; followed teams are matched here.
  const finished = new Set(competition.sessions.filter((s) => s.status === 2).map((s) => s.id));
  const mine = myTeamAssignedDuties(userId || followedKey ? shifts : [], followedIds, null)
    .filter((s) => s.sessionId != null && !finished.has(s.sessionId) && (s.dutyCategory ?? 'General') !== 'General');

  if (mine.length === 0) return null;

  async function checkIn(shift: VolunteerShift) {
    setBusy(shift.id);
    setError(null);
    try {
      const { data } = await api.post<VolunteerShift>(`${base}/volunteer-shifts/${shift.id}/check-in`, {});
      const next = data && typeof data === 'object' && 'id' in data ? data : { ...shift, attendanceStatus: 'Here', checkedInAt: new Date().toISOString() };
      setShifts((cur) => cur.map((s) => (s.id === shift.id ? { ...s, ...next } : s)));
    } catch {
      setError('Couldn’t check in. Try again, or tell the ring steward you’re here.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Your steward duties" className="mb-4 space-y-3">
      {mine.map((shift) => {
        const here = isShiftCheckedInHere(shift);
        const missing = isShiftMarkedMissing(shift);
        const label = `Steward duty: ${shift.sessionName ?? 'Session'} · ${shift.role}${shift.laneNumber != null && !shift.role.includes(`Lane ${shift.laneNumber}`) ? `, lane ${shift.laneNumber}` : ''}`;
        const frame = missing
          ? 'border-[rgb(var(--mg-elim))] bg-[rgb(var(--mg-elim)/0.08)]'
          : 'border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))]';
        return (
          <div key={shift.id} className={`rounded-[12px] border-2 p-4 ${frame}`}>
            {missing && !here && <p className="text-lg font-bold text-[rgb(var(--mg-elim))]">You’re needed now</p>}
            <p className="break-words text-base font-semibold text-[rgb(var(--mg-ink))]">{label}</p>
            {shift.assignedTeamName && <p className="mg-meta">{shift.assignedTeamName}{shift.startTimeLabel ? ` · ${shift.startTimeLabel}` : ''}</p>}
            {here
              ? <p className="mt-2 text-base font-semibold text-[rgb(var(--mg-ok))]" role="status">Checked in{timeLabel(shift.checkedInAt) ? ` at ${timeLabel(shift.checkedInAt)}` : ''}</p>
              : <button type="button" disabled={busy !== null} onClick={() => checkIn(shift)} className="mt-3 min-h-11 w-full rounded-[10px] bg-[rgb(var(--mg-button))] px-4 text-base font-semibold text-[rgb(var(--mg-button-ink))] disabled:opacity-60 sm:w-auto">We’re here</button>}
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <ArenaCrewLink competitionId={competition.id} sessionId={mine[0].sessionId} />
        <Link to={`${base}/volunteers`} className="sp-pill">{t('competition.steward.allShifts')}</Link>
      </div>
      {error && <p role="alert" className="rounded-[10px] bg-[rgb(var(--mg-problem-bg))] px-3 py-2 text-sm text-[rgb(var(--mg-problem-ink))]">{error}</p>}
    </section>
  );
}
