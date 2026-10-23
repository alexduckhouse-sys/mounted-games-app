import { readCompetitionCookie } from '../competition/preference';

/**
 * Where to land after signing out: the timetable of the competition being followed, otherwise the events page.
 * `/` shows the events list unless a competition is remembered; `/events` always does.
 */
export function signOutDestination(): string {
  try {
    let current = readCompetitionCookie(document.cookie);
    if (!current) {
      const visit = sessionStorage.getItem('mg.competitionVisit');
      current = visit ? readCompetitionCookie(`mg.competition=${encodeURIComponent(visit)}`) : null;
    }
    return current ? `/competitions/${current.id}` : '/';
  } catch {
    return '/';
  }
}
