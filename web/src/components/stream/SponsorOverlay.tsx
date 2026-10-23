import { useEffect } from 'react';
import { useOverlay } from '../../hooks/useOverlay';
import { useSponsorRotation } from '../../hooks/useSponsorRotation';
import { useSponsors } from '../../hooks/useSponsors';
import { recordSponsorSeconds, recordSponsorView } from '../../lib/sponsorExposure';
import { BREAK_CARD_MS, onBreak, SPONSOR_TIERS, sponsorsFor, STREAM_LOGO_MS } from '../../lib/sponsors';
import { SponsorBadge } from '../SponsorBadge';

/**
 * Sponsors over the live video. During a break or briefing in this arena, cards (logo and name) rotate in the
 * lower third, headline tier first. At other times a small logo rotates in the corner. The producer's switch
 * (`overlay.sponsorMode`) turns this off, or forces the cards on, and "skip" moves to the next sponsor.
 * `track` is false for previews, which must not add to the counts.
 */
export function SponsorOverlay({ arenaName, track = true }: { arenaName: string; track?: boolean }) {
  const { overlay } = useOverlay();
  const { competitionId, sponsors, sessions, skip } = useSponsors();
  const cards = sponsorsFor(sponsors, 'BreakStream');
  const logos = sponsorsFor(sponsors, 'Stream');
  const mode = overlay.sponsorMode;
  const cardsOn = mode !== 2 && cards.length > 0 && (mode === 1 || onBreak(sessions, arenaName));
  const logosOn = mode !== 2 && !cardsOn && logos.length > 0;
  const list = cardsOn ? cards : logosOn ? logos : [];
  const placement = cardsOn ? 'BreakStream' : 'Stream';
  const index = useSponsorRotation(list.length, cardsOn ? BREAK_CARD_MS : STREAM_LOGO_MS, skip);
  const sponsor = list[index] ?? null;
  const shownId = sponsor?.id ?? null;

  // Count each appearance, and the seconds it stays while this tab is in view.
  useEffect(() => {
    if (!track || competitionId === null || shownId === null) return;
    recordSponsorView(competitionId, shownId, placement);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') recordSponsorSeconds(competitionId, shownId, placement, 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [track, competitionId, shownId, placement]);

  if (!sponsor) return null;
  if (cardsOn) {
    const tier = SPONSOR_TIERS.find((t) => t.tier === sponsor.tier)!.label;
    return (
      <div className="absolute inset-x-3 bottom-14 flex justify-center">
        <aside key={sponsor.id} className="mg-ov-sponsor-card mg-stream-fade pointer-events-auto" aria-label={`${tier} sponsor`}>
          <span className="mg-ov-sponsor-tier">{tier === 'Supporter' ? tier : `${tier} sponsor`}</span>
          <SponsorBadge sponsor={sponsor} large />
        </aside>
      </div>
    );
  }
  return (
    <aside key={sponsor.id} className="mg-ov-sponsor-bug mg-stream-fade pointer-events-auto absolute bottom-14 right-3" aria-label="Sponsor">
      <SponsorBadge sponsor={sponsor} />
    </aside>
  );
}
