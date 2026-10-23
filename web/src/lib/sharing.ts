/** Addresses for the sharing features: calendar files, calendar feeds, and the links that QR codes carry. */

/** The event's `.ics` file. The page passes its own address so the event's link points back at this site. */
export function competitionCalendarUrl(competitionId: number | string, origin: string): string {
  return `/api/competitions/${competitionId}/calendar.ics?site=${encodeURIComponent(origin)}`;
}

/** The public page of an event: what a venue poster's QR code opens. */
export function competitionLink(competitionId: number | string, origin: string): string {
  return `${origin}/competitions/${competitionId}`;
}

/** The My Teams page with a join key ready in the box: what a team's QR code opens. */
export function joinTeamLink(joinKey: string, origin: string): string {
  return `${origin}/teams?join=${encodeURIComponent(joinKey)}`;
}

/** The join key carried by `?join=`, tidied the way the join box expects (upper case, no stray characters). */
export function joinKeyFromSearch(search: string): string {
  const raw = new URLSearchParams(search).get('join') ?? '';
  return raw.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
}

export interface FeedLinks {
  /** `webcal://` address: opens the phone's calendar app and subscribes. */
  webcal: string;
  /** `https://` address: for apps that want a plain link, such as Google Calendar's "from URL". */
  https: string;
}

/** Turns the API's feed path (such as `/api/calendar/teams/5/token.ics`) into the two addresses people use. */
export function feedLinks(path: string, origin: string): FeedLinks {
  const https = new URL(path, origin).toString();
  return { https, webcal: https.replace(/^https?:/, 'webcal:') };
}
