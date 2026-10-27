import { useEffect, useRef, useState } from 'react';
import { Share2 } from 'lucide-react';
import type { StandingRow } from '../types';
import type { ToplistRow } from '../lib/toplist';
import { buildStoryResultCardData, shareOrDownloadStoryResultCard } from '../lib/storyResultCard';

export interface StoryCardInput {
  competitionName: string;
  sectionName: string;
  standings: readonly StandingRow[];
  ranking?: readonly Pick<ToplistRow, 'teamId' | 'position'>[];
  featuredTeamId?: number | null;
  dateLabel?: string | null;
  locationLabel?: string | null;
  isProvisional?: boolean;
}

interface Props {
  input: StoryCardInput;
  label?: string;
  className?: string;
}

function wasCancelled(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError';
}

/** Secondary button that makes the 9:16 result card and shares it (phones) or downloads it (desktop). */
export function StoryCardButton({ input, label = 'Share story card', className = '' }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await shareOrDownloadStoryResultCard(buildStoryResultCardData(input));
      if (outcome === 'unsupported' && mounted.current) setError('This device can’t make the card. Try another browser.');
    } catch (err) {
      if (!wasCancelled(err) && mounted.current) setError('Couldn’t make the card. Try again.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <button
        type="button"
        className="mg-btn mg-btn-secondary !min-h-11 text-sm font-bold"
        onClick={run}
        disabled={busy}
        aria-busy={busy}
      >
        <Share2 className="h-4 w-4" aria-hidden="true" /> {busy ? 'Making card…' : label}
      </button>
      {error && <p role="alert" className="m-0 text-xs font-semibold text-[rgb(var(--mg-red))]">{error}</p>}
    </div>
  );
}
