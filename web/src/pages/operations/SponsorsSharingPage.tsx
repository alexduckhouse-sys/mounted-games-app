import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Plus } from 'lucide-react';
import { api } from '../../api';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { useToast } from '../../components/Toast';
import { competitionCalendarUrl, competitionLink } from '../../lib/sharing';
import {
  SPONSOR_PLACEMENTS, dateToEnd, dateToStart, endToDate, hasPlacement, isHttpsLink, parseSponsorAdmin, parseSponsorAdmins, sponsorStatus, startToDate, withPlacement,
  type SponsorPlacementKey,
} from '../../lib/sponsors';
import type { SponsorAdmin } from '../../types';
import { EmbedCard } from '../competition/EmbedCard';
import { OrganiserLogo } from '../competition/OrganiserLogo';
import { useCompetition } from '../competition/context';
import { LogoError, prepareLogo } from '../competition/sponsorLogo';
import { RefineHeader, RefineList, RefinePage, RefineSwitchRow } from '../refine/Refine';
import { apiMessage } from './types';
import './operations.css';

/** The only places an organiser can put a sponsor. Sponsors never show in the timetable or the results. */
const PLACES: Array<{ key: SponsorPlacementKey; label: string }> = [
  { key: 'Details', label: 'Event details' },
  { key: 'Stream', label: 'Live stream' },
  { key: 'BreakStream', label: 'Stream breaks' },
  { key: 'SponsorPage', label: 'Sponsors page' },
];
const SHOWN_BITS = SPONSOR_PLACEMENTS.filter((p) => PLACES.some((place) => place.key === p.key)).reduce((all, p) => all | p.placement, 0);
const DEFAULT_PLACES = SPONSOR_PLACEMENTS.filter((p) => p.key === 'Details' || p.key === 'SponsorPage').reduce((all, p) => all | p.placement, 0);
const MAX_SPONSORS = 30;

type View = { kind: 'list' } | { kind: 'add' } | { kind: 'edit'; id: number } | { kind: 'embed' };

const placesText = (sponsor: SponsorAdmin) => {
  if (!sponsor.isEnabled) return 'Hidden';
  const shown = PLACES.filter((place) => hasPlacement(sponsor.showOn, place.key)).length;
  return shown === PLACES.length ? 'Everywhere' : shown === 0 ? 'Nowhere' : `${shown} ${shown === 1 ? 'place' : 'places'}`;
};

const STATUS_REFRESH_MS = 60_000;

/** The current time, refreshed every minute and again when the page comes back into view. Cleans up after itself. */
function useNow(intervalMs = STATUS_REFRESH_MS): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', tick);
    };
  }, [intervalMs]);
  return now;
}

const STATUS_NOTE = {
  Disabled: 'Switched off, so it is not showing.',
  Scheduled: 'Not showing yet. It starts on the From date.',
  Active: 'Showing now.',
  Expired: 'Past its Until date, so it is not showing.',
} as const;

/** Sponsors and sharing: who sponsors the event and where they show, then the ways to share it. Every change saves as it is made. */
export function SponsorsSharingPage() {
  const { competition, reloadSponsors } = useCompetition();
  const [items, setItems] = useState<SponsorAdmin[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/competitions/${competition.id}/sponsors`;

  useEffect(() => {
    let cancelled = false;
    api.get<unknown>(`${base}/manage`)
      .then(({ data }) => { if (!cancelled) { setItems(parseSponsorAdmins(data)); setLoadError(false); } })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [base, retry]);

  const changed = (next: SponsorAdmin[]) => { setItems(next); reloadSponsors?.(); };
  const replace = (updated: SponsorAdmin) => items && changed(items.map((item) => (item.id === updated.id ? updated : item)));

  /** Runs one change, showing why it failed. Resolves true when it worked. */
  async function run(work: () => Promise<void>, failure: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try { await work(); return true; }
    catch (caught) { setError(caught instanceof LogoError ? caught.message : apiMessage(caught, failure)); return false; }
    finally { setBusy(false); }
  }

  const bodyOf = (sponsor: SponsorAdmin, patch: Partial<Record<'name' | 'linkUrl' | 'showOn' | 'isEnabled' | 'startsAt' | 'endsAt', unknown>>) => ({
    name: sponsor.name, linkUrl: sponsor.linkUrl, tier: sponsor.tier, showOn: sponsor.showOn & SHOWN_BITS, isEnabled: sponsor.isEnabled,
    startsAt: sponsor.startsAt, endsAt: sponsor.endsAt, ...patch,
  });

  const update = (sponsor: SponsorAdmin, patch: Parameters<typeof bodyOf>[1], failure: string) => run(async () => {
    const saved = parseSponsorAdmin((await api.put<unknown>(`${base}/${sponsor.id}`, bodyOf(sponsor, patch))).data);
    if (!saved) throw new Error('Unexpected answer');
    replace({ ...saved, logoUrl: saved.logoUrl ?? sponsor.logoUrl });
  }, failure);

  const create = (name: string, link: string) => run(async () => {
    if (!items) return;
    const saved = parseSponsorAdmin((await api.post<unknown>(base, {
      name, linkUrl: link || null, tier: 2, showOn: DEFAULT_PLACES, isEnabled: true, startsAt: null, endsAt: null,
    })).data);
    if (!saved) throw new Error('Unexpected answer');
    changed([...items, saved]);
    setView({ kind: 'edit', id: saved.id });
  }, 'Couldn’t add that sponsor. Check your signal and try again.');

  const setLogo = (sponsor: SponsorAdmin, file: File) => run(async () => {
    const logo = await prepareLogo(file);
    const saved = parseSponsorAdmin((await api.put<unknown>(`${base}/${sponsor.id}/logo`, logo, { headers: { 'Content-Type': logo.type } })).data);
    if (saved) replace(saved);
  }, 'Couldn’t save the logo. Check your signal and try again.');

  const removeLogo = (sponsor: SponsorAdmin) => run(async () => {
    const saved = parseSponsorAdmin((await api.delete<unknown>(`${base}/${sponsor.id}/logo`)).data);
    if (saved) replace({ ...saved, logoUrl: null });
  }, 'Couldn’t remove the logo. Check your signal and try again.');

  async function removeSponsor(sponsor: SponsorAdmin) {
    if (!items) return;
    if (!(await confirmDialog({ title: `Remove ${sponsor.name}?`, message: 'They come off this event’s sponsor list.', confirmLabel: 'Remove sponsor', destructive: true }))) return;
    const ok = await run(async () => {
      await api.delete(`${base}/${sponsor.id}`);
      changed(items.filter((item) => item.id !== sponsor.id));
    }, `Couldn’t remove ${sponsor.name}. Check your signal and try again.`);
    if (ok) setView({ kind: 'list' });
  }

  const sponsor = view.kind === 'edit' ? items?.find((item) => item.id === view.id) ?? null : null;
  const toList = () => { setError(null); setView({ kind: 'list' }); };
  const title = view.kind === 'add' ? 'Add a sponsor' : view.kind === 'edit' ? 'Edit sponsor' : view.kind === 'embed' ? 'Website embed' : 'Sponsors and sharing';

  return (
    <RefinePage>
      {view.kind === 'list'
        ? <RefineHeader back={`/competitions/${competition.id}/operations`} backLabel="Back to Before the day" context={competition.name} title={title} />
        : <RefineHeader onBack={toList} backLabel="Back to sponsors and sharing" context={competition.name} title={title} />}
      <div className="ops-cards ops-tt ops-spons" aria-busy={busy}>
        {error && <Notice>{error}</Notice>}
        {view.kind !== 'list' && <button type="button" className="ops-back" onClick={toList}><ChevronLeft className="h-4 w-4" aria-hidden="true" />Sponsors and sharing</button>}

        {view.kind === 'list' && (
          <>
            <h2 className="rf-sec ops-tt-head"><span>Sponsors</span></h2>
            {loadError && !items && (
              <Notice actionLabel="Try again" onAction={() => { setLoadError(false); setRetry((n) => n + 1); }}>Couldn’t load the sponsors. Check your signal and try again.</Notice>
            )}
            {!items && !loadError && <p role="status" className="rf-note">Loading…</p>}
            {items && (
              <>
                <RefineList as="div" label="Sponsors">
                  {items.map((item) => (
                    <div key={item.id} className="rf-row">
                      <OrganiserLogo sponsor={item} />
                      <span className="rf-grow"><span className="rf-t1">{item.name}</span><span className="rf-t2">{placesText(item)}</span></span>
                      <button type="button" className="rf-btn" aria-label={`Edit ${item.name}`} onClick={() => setView({ kind: 'edit', id: item.id })}>Edit</button>
                    </div>
                  ))}
                  {items.length === 0 && <div className="rf-row"><span className="rf-t2">No sponsors yet</span></div>}
                </RefineList>
                <button type="button" className="ops-addbar ops-addbar-gap" disabled={busy || items.length >= MAX_SPONSORS} onClick={() => { setError(null); setView({ kind: 'add' }); }}>
                  <Plus className="h-4 w-4" aria-hidden="true" />Add a sponsor
                </button>
              </>
            )}

            <h2 className="rf-sec ops-tt-head"><span>Share</span></h2>
            <RefineList as="div" label="Share">
              <ShareLinkRow id={competition.id} name={competition.name} />
              <div className="rf-row"><span className="rf-grow rf-t1">Calendar file</span><a className="rf-btn" href={competitionCalendarUrl(competition.id, window.location.origin)}>Get</a></div>
              <div className="rf-row"><span className="rf-grow rf-t1">Venue poster</span><Link className="rf-btn" to={`/event-tools/${competition.id}/print/poster`}>Print</Link></div>
              <div className="rf-row"><span className="rf-grow rf-t1">Website embed</span><button type="button" className="rf-btn" onClick={() => setView({ kind: 'embed' })}>Get code</button></div>
            </RefineList>

            <h2 className="rf-sec ops-tt-head"><span>Shop</span></h2>
            <RefineList as="div" label="Shop">
              <div className="rf-row"><span className="rf-grow rf-t1">Event shop</span><Link className="rf-btn" to={`/competitions/${competition.id}/shop/manage`}>Manage</Link></div>
            </RefineList>
          </>
        )}

        {view.kind === 'add' && <AddSponsor busy={busy} onCreate={create} onProblem={setError} />}

        {view.kind === 'edit' && !sponsor && <p role="status" className="rf-note">Loading…</p>}
        {view.kind === 'edit' && sponsor && (
          <EditSponsor
            key={sponsor.id} sponsor={sponsor} busy={busy} onProblem={setError}
            onPatch={(patch, failure) => void update(sponsor, patch, failure)}
            onLogo={(file) => void setLogo(sponsor, file)} onRemoveLogo={() => void removeLogo(sponsor)} onRemove={() => void removeSponsor(sponsor)}
          />
        )}

        {view.kind === 'embed' && (
          <EmbedCard kind="competition" competitionId={competition.id} name={competition.name} sections={competition.sections} />
        )}
      </div>
    </RefinePage>
  );
}

/** Copies the event's address, or opens the phone's share sheet. */
function ShareLinkRow({ id, name }: { id: number; name: string }) {
  const [state, setState] = useState<'idle' | 'failed'>('idle');
  const toast = useToast();
  const url = competitionLink(id, window.location.origin);
  async function share() {
    setState('idle');
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ title: name, url }); return; }
      catch (caught) { if (caught && typeof caught === 'object' && 'name' in caught && caught.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); toast.show('Link copied'); }
    catch { setState('failed'); }
  }
  return (
    <div className="rf-row">
      <span className="rf-grow rf-t1">Event link</span>
      {state === 'failed' && <a className="rf-t2" href={url}>Copy this link</a>}
      <button type="button" className="rf-btn" onClick={() => void share()}>Share</button>
      {toast.node}
    </div>
  );
}

/** The first step of a new sponsor: a name (and optionally a website). It is added as soon as the name is in. */
function AddSponsor({ busy, onCreate, onProblem }: { busy: boolean; onCreate: (name: string, link: string) => Promise<boolean>; onProblem: (message: string | null) => void }) {
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const sent = useRef(false);
  async function submit() {
    const text = name.trim();
    const address = link.trim();
    if (!text || busy || sent.current) return;
    if (address && !isHttpsLink(address)) { onProblem('The link must start with https://'); return; }
    sent.current = true;
    const ok = await onCreate(text, address);
    if (!ok) sent.current = false;
  }
  // The sponsor is added when focus leaves the form (not when moving from Name to Website), or on Enter.
  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) void submit(); }}>
      <h2 className="rf-sec ops-tt-head"><span>About</span></h2>
      <div className="ops-fields-row">
        <label className="rf-fld">Name<input autoFocus value={name} placeholder="The sponsor’s name" maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
        <label className="rf-fld">Website<input type="url" inputMode="url" value={link} placeholder="https://" maxLength={300} onChange={(event) => setLink(event.target.value)} /></label>
      </div>
      <button type="submit" hidden aria-hidden="true" tabIndex={-1}>Add</button>
    </form>
  );
}

function EditSponsor({ sponsor, busy, onProblem, onPatch, onLogo, onRemoveLogo, onRemove }: {
  sponsor: SponsorAdmin;
  busy: boolean;
  onProblem: (message: string | null) => void;
  onPatch: (patch: Record<string, unknown>, failure: string) => void;
  onLogo: (file: File) => void;
  onRemoveLogo: () => void;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(sponsor.name);
  const [link, setLink] = useState(sponsor.linkUrl ?? '');
  const [dated, setDated] = useState(Boolean(sponsor.startsAt || sponsor.endsAt));
  const hasLogo = sponsor.logoUrl !== null;
  const status = sponsorStatus(sponsor, useNow());

  function saveName() {
    const next = name.trim();
    if (!next) { setName(sponsor.name); onProblem('A sponsor needs a name.'); return; }
    if (next !== sponsor.name) onPatch({ name: next }, 'Couldn’t save the name. Check your signal and try again.');
  }
  function saveLink() {
    const next = link.trim();
    if (next === (sponsor.linkUrl ?? '')) return;
    if (next && !isHttpsLink(next)) { onProblem('The link must start with https://'); setLink(sponsor.linkUrl ?? ''); return; }
    onProblem(null);
    onPatch({ linkUrl: next || null }, 'Couldn’t save the website. Check your signal and try again.');
  }
  function setDate(which: 'startsAt' | 'endsAt', value: string) {
    const iso = value ? (which === 'startsAt' ? dateToStart(value) : dateToEnd(value)) : null;
    onPatch({ [which]: iso }, 'Couldn’t save the dates. Check your signal and try again.');
  }
  function setDatedOn(on: boolean) {
    setDated(on);
    if (!on && (sponsor.startsAt || sponsor.endsAt)) onPatch({ startsAt: null, endsAt: null }, 'Couldn’t clear the dates. Check your signal and try again.');
  }

  return (
    <>
      <h2 className="rf-sec ops-tt-head"><span>Logo</span></h2>
      <RefineList as="div" label="Logo">
        <div className="rf-row">
          <OrganiserLogo sponsor={sponsor} />
          <span className="rf-grow rf-t1">{hasLogo ? 'Logo' : 'No logo yet'}</span>
          <input ref={fileRef} type="file" hidden aria-label="Logo file" accept="image/png,image/jpeg,image/webp"
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onLogo(file); }} />
          <button type="button" className="rf-btn" disabled={busy} onClick={() => fileRef.current?.click()}>{hasLogo ? 'Change' : 'Upload'}</button>
          {hasLogo && <button type="button" className="ops-danger-link" disabled={busy} onClick={onRemoveLogo}>Remove logo</button>}
        </div>
      </RefineList>

      <h2 className="rf-sec ops-tt-head"><span>About</span></h2>
      <div className="ops-fields-row">
        <label className="rf-fld">Name<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} onBlur={saveName} /></label>
        <label className="rf-fld">Website<input type="url" inputMode="url" value={link} placeholder="https://" maxLength={300} onChange={(event) => setLink(event.target.value)} onBlur={saveLink} /></label>
      </div>

      <h2 className="rf-sec ops-tt-head"><span>Where it shows</span></h2>
      <RefineList as="div" label="Where it shows">
        {PLACES.map((place) => (
          <RefineSwitchRow key={place.key} label={place.label} on={hasPlacement(sponsor.showOn, place.key)} disabled={busy}
            onChange={(on) => onPatch({ showOn: withPlacement(sponsor.showOn & SHOWN_BITS, place.key, on) }, 'Couldn’t save where it shows. Check your signal and try again.')} />
        ))}
      </RefineList>

      <h2 className="rf-sec ops-tt-head"><span>When</span></h2>
      <RefineList as="div" label="When">
        <RefineSwitchRow label="Only between dates" on={dated} disabled={busy} onChange={setDatedOn} />
        {dated && (
          <div className="ops-fields-row ops-dates">
            <label className="rf-fld">From<input type="date" value={startToDate(sponsor.startsAt)} max={endToDate(sponsor.endsAt) || undefined} onChange={(event) => setDate('startsAt', event.target.value)} /></label>
            <label className="rf-fld">Until<input type="date" value={endToDate(sponsor.endsAt)} min={startToDate(sponsor.startsAt) || undefined} onChange={(event) => setDate('endsAt', event.target.value)} /></label>
          </div>
        )}
        <RefineSwitchRow label="Showing" on={sponsor.isEnabled} disabled={busy} onChange={(on) => onPatch({ isEnabled: on }, 'Couldn’t change that. Check your signal and try again.')} />
        <div className="rf-row" aria-label="Status">
          <span className="rf-grow"><span className="rf-t1">Status</span><span className="rf-t2">{STATUS_NOTE[status]}</span></span>
          <span className={`ops-status ops-status-${status.toLowerCase()}`}>{status}</span>
        </div>
      </RefineList>

      <div className="ops-end-left ops-remove"><button type="button" className="ops-danger-link" disabled={busy} onClick={onRemove}>Remove this sponsor</button></div>
    </>
  );
}
