import { useContext, useEffect } from 'react';
import type { Session, Sponsor } from '../types';
import { CompetitionContext } from '../pages/competition/context';
import { recordSponsorView } from '../lib/sponsorExposure';
import { sponsorsFor, type SponsorPlacementKey } from '../lib/sponsors';

const NONE: Sponsor[] = [];
const NO_SESSIONS: Session[] = [];
const NO_SKIP = { count: 0, at: 0 };

/** The competition's sponsors; empty outside a competition page or before they load. */
export function useSponsors() {
  const context = useContext(CompetitionContext);
  return {
    competitionId: context?.competition.id ?? null,
    sponsors: context?.sponsors ?? NONE,
    sessions: context?.competition.sessions ?? NO_SESSIONS,
    skip: context?.sponsorSkip ?? NO_SKIP,
  };
}

/** The sponsors that show in one place, in order. */
export function useSponsorsFor(key: SponsorPlacementKey): Sponsor[] {
  const { sponsors } = useSponsors();
  return sponsorsFor(sponsors, key);
}

/** Counts one view for each of these sponsors every time the set on screen changes (and once on arrival). */
export function useRecordSponsorViews(key: SponsorPlacementKey, sponsors: readonly Sponsor[]) {
  const { competitionId } = useSponsors();
  const ids = sponsors.map((sponsor) => sponsor.id).join(',');
  useEffect(() => {
    if (competitionId === null || !ids) return;
    for (const id of ids.split(',')) recordSponsorView(competitionId, Number(id), key);
  }, [competitionId, ids, key]);
}
