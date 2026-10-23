import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Sponsor } from '../types';
import { parseSponsorControl, parseSponsors } from '../lib/sponsors';
import { flushSponsorExposure, flushSponsorExposureOnLeave } from '../lib/sponsorExposure';

const NO_SPONSORS: Sponsor[] = [];

/**
 * The competition's sponsors and the producer's "skip" signal, for `CompetitionPage` to put in the context.
 * The list is public and the same for everyone. A failed fetch keeps what was there, so a dropped signal never blanks the sponsors.
 */
export function useSponsorFeed(competitionId: number, ready: number) {
  const [result, setResult] = useState<{ competitionId: number; sponsors: Sponsor[] } | null>(null);
  const [reloads, setReloads] = useState(0);
  const [skip, setSkip] = useState({ count: 0, at: 0 });

  useEffect(() => {
    const controller = new AbortController();
    api.get<unknown>(`/competitions/${competitionId}/sponsors`, { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setResult({ competitionId, sponsors: parseSponsors(data) }); })
      .catch(() => { /* keep what we have; onReady fetches again */ });
    return () => controller.abort();
  }, [competitionId, ready, reloads]);

  // Counts of what was shown go out every half minute (see lib/sponsorExposure.ts), when the page is hidden, and when leaving.
  useEffect(() => {
    const stop = flushSponsorExposureOnLeave();
    return () => { stop(); void flushSponsorExposure(); };
  }, [competitionId]);

  const reloadSponsors = useCallback(() => setReloads((value) => value + 1), []);
  const onSponsorControl = useCallback((raw: unknown) => {
    if (parseSponsorControl(raw) === 'skip') setSkip((current) => ({ count: current.count + 1, at: Date.now() }));
  }, []);

  return {
    sponsors: result?.competitionId === competitionId ? result.sponsors : NO_SPONSORS,
    sponsorSkip: skip,
    reloadSponsors,
    onSponsorControl,
  };
}
