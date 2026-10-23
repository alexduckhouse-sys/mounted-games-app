import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { useCompetition } from './context';
import { ImageDown } from 'lucide-react';
import { useLiteMode } from '../../lite/LiteModeContext';
import { RefineList, RefineNote, RefineSection } from '../refine/Refine';
import { apiMessage } from '../operations/types';
import { LogoError, prepareLogo } from './sponsorLogo';
import type { SponsorAdmin, SponsorTier } from '../../types';
import {
  SPONSOR_PLACEMENTS, SPONSOR_TIERS, dateToEnd, dateToStart, datesText, endToDate, hasPlacement, isHttpsLink,
  parseSponsorAdmin, parseSponsorAdmins, shownText, startToDate, withPlacement,
} from '../../lib/sponsors';

/** What the form edits. Dates are `yyyy-mm-dd` boxes; `logo` is a chosen file waiting to be sent. */
interface Draft {
  id: number | null;
  name: string;
  linkUrl: string;
  tier: SponsorTier;
  showOn: number;
  isEnabled: boolean;
  startDate: string;
  endDate: string;
  logo: File | null;
  hadLogo: boolean;
}

// New sponsors show in the places that need no live video.
const DEFAULT_PLACES = SPONSOR_PLACEMENTS.filter((p) => ['Timetable', 'Results', 'Details', 'SponsorPage'].includes(p.key)).reduce((all, p) => all | p.placement, 0);
const blank = (): Draft => ({ id: null, name: '', linkUrl: '', tier: 1, showOn: DEFAULT_PLACES, isEnabled: true, startDate: '', endDate: '', logo: null, hadLogo: false });
const draftOf = (s: SponsorAdmin): Draft => ({
  id: s.id, name: s.name, linkUrl: s.linkUrl ?? '', tier: s.tier, showOn: s.showOn, isEnabled: s.isEnabled,
  startDate: startToDate(s.startsAt), endDate: endToDate(s.endsAt), logo: null, hadLogo: s.logoUrl !== null,
});

/**
 * A sponsor's logo for the organiser's list. It is fetched with the organiser's sign-in, because a sponsor that is switched
 * off or out of dates is not served to the public. In lite mode it waits for a tap, like every picture.
 */
function OrganiserLogo({ sponsor }: { sponsor: SponsorAdmin }) {
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

type ListState = { competitionId: number; items: SponsorAdmin[] } | 'error' | null;

/**
 * The organiser's sponsors: add, edit, delete and reorder, with a logo, tier, places to show and optional
 * dates, and how often each has been shown. The API decides who may change them; this only hides what won't work.
 */
export function SponsorsCard({ competitionId }: { competitionId: number }) {
  const { reloadSponsors } = useCompetition();
  const [state, setState] = useState<ListState>(null);
  const [retry, setRetry] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<unknown>(`/competitions/${competitionId}/sponsors/manage`)
      .then(({ data }) => { if (!cancelled) setState({ competitionId, items: parseSponsorAdmins(data) }); })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [competitionId, retry]);

  const items = state && state !== 'error' && state.competitionId === competitionId ? state.items : null;
  const changed = useCallback((next: SponsorAdmin[]) => {
    setState({ competitionId, items: next });
    reloadSponsors?.();
  }, [competitionId, reloadSponsors]);

  async function run(work: () => Promise<void>, failure: string) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await work();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof LogoError ? error.message : apiMessage(error, failure) });
    } finally {
      setBusy(false);
    }
  }

  const base = `/competitions/${competitionId}/sponsors`;

  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || !items) return;
    const link = draft.linkUrl.trim();
    if (link && !isHttpsLink(link)) {
      setNotice({ kind: 'error', text: 'The link must start with https://' });
      return;
    }
    void run(async () => {
      const body = {
        name: draft.name.trim(), linkUrl: link || null, tier: draft.tier, showOn: draft.showOn, isEnabled: draft.isEnabled,
        startsAt: draft.startDate ? dateToStart(draft.startDate) : null, endsAt: draft.endDate ? dateToEnd(draft.endDate) : null,
      };
      // Shrink the logo first, so a bad picture stops the save before anything is sent.
      const logo = draft.logo ? await prepareLogo(draft.logo) : null;
      const saved = parseSponsorAdmin(draft.id === null ? (await api.post<unknown>(base, body)).data : (await api.put<unknown>(`${base}/${draft.id}`, body)).data);
      if (!saved) throw new Error('Unexpected answer');
      let latest = saved;
      if (logo) {
        const withLogo = parseSponsorAdmin((await api.put<unknown>(`${base}/${saved.id}/logo`, logo, { headers: { 'Content-Type': logo.type } })).data);
        if (withLogo) latest = withLogo;
      }
      changed(draft.id === null ? [...items, latest] : items.map((item) => (item.id === latest.id ? latest : item)));
      setDraft(null);
      setNotice({ kind: 'ok', text: draft.id === null ? `Added ${latest.name}.` : `Saved ${latest.name}.` });
    }, 'Couldn’t save that sponsor. Check your connection and try again.');
  }

  function removeLogo(sponsor: Draft) {
    if (sponsor.id === null || !items) return;
    void run(async () => {
      const updated = parseSponsorAdmin((await api.delete<unknown>(`${base}/${sponsor.id}/logo`)).data);
      if (updated) changed(items.map((item) => (item.id === updated.id ? updated : item)));
      setDraft({ ...sponsor, hadLogo: false, logo: null });
    }, 'Couldn’t remove the logo. Try again.');
  }

  function remove(sponsor: SponsorAdmin) {
    if (!items) return;
    void run(async () => {
      await api.delete(`${base}/${sponsor.id}`);
      changed(items.filter((item) => item.id !== sponsor.id));
      setConfirmDelete(null);
      setNotice({ kind: 'ok', text: `Deleted ${sponsor.name}.` });
    }, `Couldn’t delete ${sponsor.name}. Try again.`);
  }

  function move(index: number, by: -1 | 1) {
    if (!items) return;
    const next = [...items];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    void run(async () => {
      await api.put(`${base}/order`, { ids: next.map((item) => item.id) });
      changed(next.map((item, i) => ({ ...item, sortOrder: i })));
    }, 'Couldn’t change the order. Try again.');
  }

  function toggleEnabled(sponsor: SponsorAdmin) {
    if (!items) return;
    void run(async () => {
      const body = {
        name: sponsor.name, linkUrl: sponsor.linkUrl, tier: sponsor.tier, showOn: sponsor.showOn, isEnabled: !sponsor.isEnabled,
        startsAt: sponsor.startsAt, endsAt: sponsor.endsAt,
      };
      const updated = parseSponsorAdmin((await api.put<unknown>(`${base}/${sponsor.id}`, body)).data);
      if (updated) changed(items.map((item) => (item.id === updated.id ? updated : item)));
    }, 'Couldn’t change that sponsor. Try again.');
  }

  return (
    <section aria-label="Sponsors">
      <RefineSection title="Sponsors" />
      {state === 'error' && (
        <div role="alert" className="rf-list flex flex-col items-start gap-2 p-3">
          <p>Couldn’t load the sponsors. Check your connection and try again.</p>
          <button type="button" className="mg-btn mg-btn-secondary !min-h-11" onClick={() => { setState(null); setRetry((n) => n + 1); }}>Try again</button>
        </div>
      )}
      {state === null && <p role="status" className="rf-note">Loading the sponsors…</p>}
      {items && (
        <>
          {items.length === 0 && !draft && <RefineNote>No sponsors yet. Add one to show a logo and link on the event’s pages and video.</RefineNote>}
          {items.length > 0 && (
            <RefineList label="Sponsors">
              {items.map((sponsor, index) => (
                <li key={sponsor.id} className="flex flex-col gap-2 p-3">
                  <div className="flex items-center gap-3">
                    <OrganiserLogo sponsor={sponsor} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{sponsor.name}</span>
                      <span className="mg-meta block">
                        {SPONSOR_TIERS.find((t) => t.tier === sponsor.tier)?.label}{!sponsor.isEnabled && ' · Hidden'}
                        {datesText(sponsor.startsAt, sponsor.endsAt) && ` · ${datesText(sponsor.startsAt, sponsor.endsAt)}`}
                      </span>
                      <span className="mg-meta block">{shownText(sponsor.views, sponsor.seconds)}</span>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="mg-btn mg-btn-secondary !min-h-11 !px-3" disabled={busy || index === 0} aria-label={`Move ${sponsor.name} up`} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                    <button type="button" className="mg-btn mg-btn-secondary !min-h-11 !px-3" disabled={busy || index === items.length - 1} aria-label={`Move ${sponsor.name} down`} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
                    <button type="button" className="mg-btn mg-btn-secondary !min-h-11 !px-3" disabled={busy} aria-pressed={sponsor.isEnabled} onClick={() => toggleEnabled(sponsor)}>{sponsor.isEnabled ? 'Showing' : 'Hidden'}</button>
                    <button type="button" className="mg-btn mg-btn-secondary !min-h-11 !px-3" disabled={busy} aria-label={`Edit ${sponsor.name}`} onClick={() => { setNotice(null); setDraft(draftOf(sponsor)); }}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</button>
                    {confirmDelete === sponsor.id ? (
                      <>
                        <button type="button" className="mg-btn mg-btn-primary !min-h-11 !px-3" disabled={busy} onClick={() => remove(sponsor)}>Delete {sponsor.name}</button>
                        <button type="button" className="mg-btn mg-btn-secondary !min-h-11 !px-3" onClick={() => setConfirmDelete(null)}>Keep</button>
                      </>
                    ) : (
                      <button type="button" className="mg-btn mg-btn-secondary !min-h-11 !px-3" disabled={busy} aria-label={`Delete ${sponsor.name}`} onClick={() => setConfirmDelete(sponsor.id)}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                    )}
                  </div>
                </li>
              ))}
            </RefineList>
          )}

          {draft ? (
            <form onSubmit={save} className="rf-list flex flex-col gap-3 p-3" aria-label={draft.id === null ? 'Add a sponsor' : `Edit ${draft.name}`}>
              <label className="rf-fld">Name
                <input required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </label>
              <label className="rf-fld">Link (https)
                <input type="url" inputMode="url" maxLength={300} placeholder="https://" value={draft.linkUrl} onChange={(event) => setDraft({ ...draft, linkUrl: event.target.value })} />
              </label>
              <label className="rf-fld">Tier
                <select value={draft.tier} onChange={(event) => setDraft({ ...draft, tier: Number(event.target.value) as SponsorTier })}>
                  {SPONSOR_TIERS.map((t) => <option key={t.tier} value={t.tier}>{t.label}</option>)}
                </select>
              </label>
              <fieldset className="flex flex-col gap-1">
                <legend className="rf-fld">Show on</legend>
                {SPONSOR_PLACEMENTS.map((place) => (
                  <label key={place.key} className="flex min-h-11 items-center gap-3">
                    <input type="checkbox" className="h-5 w-5 shrink-0" checked={hasPlacement(draft.showOn, place.key)} onChange={(event) => setDraft({ ...draft, showOn: withPlacement(draft.showOn, place.key, event.target.checked) })} />
                    <span><span className="block font-semibold">{place.label}</span><span className="mg-meta block">{place.description}</span></span>
                  </label>
                ))}
              </fieldset>
              <label className="flex min-h-11 items-center gap-3">
                <input type="checkbox" className="h-5 w-5 shrink-0" checked={draft.isEnabled} onChange={(event) => setDraft({ ...draft, isEnabled: event.target.checked })} />
                <span className="font-semibold">Showing</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="rf-fld">First day (optional)
                  <input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} />
                </label>
                <label className="rf-fld">Last day (optional)
                  <input type="date" value={draft.endDate} min={draft.startDate || undefined} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} />
                </label>
              </div>
              <div className="flex flex-col gap-2">
                <label className="rf-fld">{draft.hadLogo ? 'Replace logo' : 'Logo'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setDraft({ ...draft, logo: event.target.files?.[0] ?? null })} />
                </label>
                <RefineNote>PNG, JPEG or WebP. It’s shrunk to fit.</RefineNote>
                {draft.hadLogo && draft.id !== null && !draft.logo && (
                  <div><button type="button" className="mg-btn mg-btn-secondary !min-h-11" disabled={busy} onClick={() => removeLogo(draft)}>Remove logo</button></div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="mg-btn mg-btn-primary !min-h-11" disabled={busy || !draft.name.trim()}>{draft.id === null ? 'Add sponsor' : 'Save sponsor'}</button>
                <button type="button" className="mg-btn mg-btn-secondary !min-h-11" onClick={() => { setDraft(null); setNotice(null); }}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className="rf-list p-3">
              <button type="button" className="mg-btn mg-btn-secondary !min-h-11" disabled={busy || items.length >= 30} onClick={() => { setNotice(null); setDraft(blank()); }}>Add a sponsor</button>
            </div>
          )}
        </>
      )}
      {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} className="mg-notice">{notice.text}</p>}
    </section>
  );
}
