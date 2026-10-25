import { useEffect, useState } from 'react';
import { ImageDown } from 'lucide-react';
import { api } from '../../api';
import { useLiteMode } from '../../lite/LiteModeContext';
import type { SponsorAdmin } from '../../types';

/**
 * A sponsor's logo for the organiser's list. It is fetched with the organiser's sign-in, because a sponsor that is switched
 * off or out of dates is not served to the public. In lite mode it waits for a tap, like every picture.
 */
export function OrganiserLogo({ sponsor }: { sponsor: SponsorAdmin }) {
  const { lite } = useLiteMode();
  const [asked, setAsked] = useState(false);
  const [loaded, setLoaded] = useState<{ path: string; url: string } | null>(null);
  const path = sponsor.logoUrl;
  const wanted = path !== null && (!lite || asked);

  useEffect(() => {
    if (!wanted || path === null) return;
    let url: string | null = null;
    let cancelled = false;
    // The API's own address is already the client's base, so only the part after /api is passed.
    api.get<Blob>(path.replace(/^\/api/, ''), { responseType: 'blob' })
      .then(({ data }) => {
        if (cancelled) return;
        url = URL.createObjectURL(data);
        setLoaded({ path, url });
      })
      .catch(() => { /* the placeholder stays */ });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [wanted, path]);

  if (path === null) return <span aria-hidden="true" className="mg-sponsor-logo flex items-center justify-center text-xs text-[rgb(var(--mg-muted))]">No logo</span>;
  if (lite && !asked) {
    return <button type="button" className="mg-sponsor-logo mg-tap-image mg-tap-image--compact" aria-label={`Load image: ${sponsor.name} logo`} onClick={() => setAsked(true)}><ImageDown aria-hidden="true" /></button>;
  }
  return loaded?.path === path
    ? <img src={loaded.url} alt={`${sponsor.name} logo`} className="mg-sponsor-logo" />
    : <span aria-hidden="true" className="mg-sponsor-logo flex items-center justify-center text-xs text-[rgb(var(--mg-muted))]">…</span>;
}
