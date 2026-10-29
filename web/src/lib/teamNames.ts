import { clubLabel } from './clubName';

const words = (text: string) => ` ${text.trim().toLowerCase().replace(/\s+/g, ' ')} `;

/**
 * The club to show beside a team, or '' when it tells you nothing new: there is no real club, the team is named after
 * its club ("Atherstone" for Atherstone) or its name already carries the club ("Atherstone Juniors"). Compared without
 * case and as whole words, so the club "Dee" is still shown beside a team called "Deeside Novices".
 */
export function clubToShow(teamName: string, clubName: string | null | undefined): string {
  const club = clubLabel(clubName);
  if (!club) return '';
  return words(teamName).includes(words(club)) ? '' : club;
}
