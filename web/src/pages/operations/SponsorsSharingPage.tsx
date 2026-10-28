import { tr } from '../../i18n/translate';
import { useT } from '../../i18n/LanguageContext';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Plus } from 'lucide-react';
import { api } from '../../api';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { useToast } from '../../components/Toast';
import { useDockAction } from '../../components/TickerContext';
import { competitionCalendarUrl, competitionLink } from '../../lib/sharing';
import {
  SPONSOR_PLACEMENTS, dateToEnd, dateToStart, endToDate, hasPlacement, isHttpsLink, parseSponsorAdmin, parseSponsorAdmins, sponsorStatus, startToDate, withPlacement,
  type SponsorPlacementKey,
} from '../../lib/sponsors';
import type { MessageKey } from '../../i18n/en/index';
import type { SponsorAdmin } from '../../types';
import { EmbedCard } from '../competition/EmbedCard';
import { OrganiserLogo } from '../competition/OrganiserLogo';
import { useCompetition } from '../competition/context';
import { LogoError, prepareLogo } from '../competition/sponsorLogo';
import { RefineHeader, RefineList, RefinePage, RefineSwitchRow } from '../refine/Refine';
import { apiMessage } from './types';
import './operations.css';

/** The only places an organiser can put a sponsor. Sponsors never show in the timetable or the results. */
const PLACES: Array<{ key: SponsorPlacementKey; label: MessageKey }> = [
  { key: 'Details', label: 'ops2.sponsors.place.details' },
  { key: 'Stream', label: 'ops2.sponsors.place.stream' },
  { key: 'BreakStream', label: 'ops2.sponsors.place.break' },
  { key: 'SponsorPage', label: 'ops2.sponsors.place.page' },
];
const SHOWN_BITS = SPONSOR_PLACEMENTS.filter((p) => PLACES.some((place) => place.key === p.key)).reduce((all, p) => all | p.placement, 0);
const DEFAULT_PLACES = SPONSOR_PLACEMENTS.filter((p) => p.key === 'Details' || p.key === 'SponsorPage').reduce((all, p) => all | p.placement, 0);
const MAX_SPONSORS = 30;

type View = { kind: 'list' } | { kind: 'add' } | { kind: 'edit'; id: number } | { kind: 'embed' };

const placesText = (sponsor: SponsorAdmin) => {
  if (!sponsor.isEnabled) return tr('ops2.sponsors.hidden');
  const shown = PLACES.filter((place) => hasPlacement(sponsor.showOn, place.key)).length;
  return shown === PLACES.length ? tr('ops2.sponsors.everywhere') : shown === 0 ? tr('ops2.sponsors.nowhere') : tr('ops2.sponsors.places', { count: shown });
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
  Disabled: 'ops2.sponsors.note.disabled',
  Scheduled: 'ops2.sponsors.note.scheduled',
  Active: 'ops2.sponsors.note.active',
  Expired: 'ops2.sponsors.note.expired',
} as const satisfies Record<string, MessageKey>;
const STATUS_WORD = {
  Disabled: 'ops2.sponsors.status.disabled',
  Scheduled: 'ops2.sponsors.status.scheduled',
  Active: 'ops2.sponsors.status.active',
  Expired: 'ops2.sponsors.status.expired',
} as const satisfies Record<string, MessageKey>;

/** Sponsors and sharing: who sponsors the event and where they show, then the ways to share it. Every change saves as it is made. */
export function SponsorsSharingPage() {
  const t = useT();
  const { competition, reloadSponsors } = useCompetition();
  const [items, setItems] = useState<SponsorAdmin[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/competitions/${competition.id}/sponsors`;
  const canAdd = view.kind === 'list' && items != null && !busy && items.length < MAX_SPONSORS;
  const docked = useDockAction(canAdd ? { label: t('ops2.sponsors.titleAdd'), icon: 'plus', onClick: () => { setError(null); setView({ kind: 'add' }); } } : null);

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
  }, t('ops2.sponsors.addError'));

  const setLogo = (sponsor: SponsorAdmin, file: File) => run(async () => {
    const logo = await prepareLogo(file);
    const saved = parseSponsorAdmin((await api.put<unknown>(`${base}/${sponsor.id}/logo`, logo, { headers: { 'Content-Type': logo.type } })).data);
    if (saved) replace(saved);
  }, t('ops2.sponsors.logoError'));

  const removeLogo = (sponsor: SponsorAdmin) => run(async () => {
    const saved = parseSponsorAdmin((await api.delete<unknown>(`${base}/${sponsor.id}/logo`)).data);
    if (saved) replace({ ...saved, logoUrl: null });
  }, t('ops2.sponsors.logoRemoveError'));

  async function removeSponsor(sponsor: SponsorAdmin) {
    if (!items) return;
    if (!(await confirmDialog({ title: t('ops2.sponsors.removeTitle', { name: sponsor.name }), message: t('ops2.sponsors.removeMessage'), confirmLabel: t('ops2.sponsors.removeConfirm'), destructive: true }))) return;
    const ok = await run(async () => {
      await api.delete(`${base}/${sponsor.id}`);
      changed(items.filter((item) => item.id !== sponsor.id));
    }, t('ops2.sponsors.removeFailed', { name: sponsor.name }));
    if (ok) setView({ kind: 'list' });
  }

  const sponsor = view.kind === 'edit' ? items?.find((item) => item.id === view.id) ?? null : null;
  const toList = () => { setError(null); setView({ kind: 'list' }); };
  const title = view.kind === 'add' ? t('ops2.sponsors.titleAdd') : view.kind === 'edit' ? t('ops2.sponsors.titleEdit') : view.kind === 'embed' ? t('ops2.sponsors.websiteEmbed') : t('ops2.sponsors.title');

  return (
    <RefinePage>
      {view.kind === 'list'
        ? <RefineHeader back={`/competitions/${competition.id}/operations`} backLabel={t('ops.hub.back')} context={competition.name} title={title} />
        : <RefineHeader onBack={toList} backLabel={t('ops2.sponsors.backTo')} context={competition.name} title={title} />}
      <div className="ops-cards ops-tt ops-spons" aria-busy={busy}>
        {error && <Notice>{error}</Notice>}
        {view.kind !== 'list' && <button type="button" className="ops-back" onClick={toList}><ChevronLeft className="h-4 w-4" aria-hidden="true" />{t('ops2.sponsors.title')}</button>}

        {view.kind === 'list' && (
          <>
            <h2 className="rf-sec ops-tt-head"><span>{t('ops2.sponsors.sponsors')}</span></h2>
            {loadError && !items && (
              <Notice actionLabel={t('common.tryAgain')} onAction={() => { setLoadError(false); setRetry((n) => n + 1); }}>{t('ops2.sponsors.loadError')}</Notice>
            )}
            {!items && !loadError && <p role="status" className="rf-note">{t('common.loading')}</p>}
            {items && (
              <>
                <RefineList as="div" label={t('ops2.sponsors.sponsors')}>
                  {items.map((item) => (
                    <div key={item.id} className="rf-row">
                      <OrganiserLogo sponsor={item} />
                      <span className="rf-grow"><span className="rf-t1">{item.name}</span><span className="rf-t2">{placesText(item)}</span></span>
                      <button type="button" className="rf-btn" aria-label={t('ops2.sponsors.editAria', { name: item.name })} onClick={() => setView({ kind: 'edit', id: item.id })}>{t('common.edit')}</button>
                    </div>
                  ))}
                  {items.length === 0 && <div className="rf-row"><span className="rf-t2">{t('ops2.sponsors.none')}</span></div>}
                </RefineList>
                {!docked && <button type="button" className="ops-addbar ops-addbar-gap" disabled={busy || items.length >= MAX_SPONSORS} onClick={() => { setError(null); setView({ kind: 'add' }); }}>
                  <Plus className="h-4 w-4" aria-hidden="true" />{t('ops2.sponsors.titleAdd')}
                </button>}
              </>
            )}

            <h2 className="rf-sec ops-tt-head"><span>{t('ops2.sponsors.share')}</span></h2>
            <RefineList as="div" label={t('ops2.sponsors.share')}>
              <ShareLinkRow id={competition.id} name={competition.name} />
              <div className="rf-row"><span className="rf-grow rf-t1">{t('ops2.sponsors.calendar')}</span><a className="rf-btn" href={competitionCalendarUrl(competition.id, window.location.origin)}>{t('ops2.sponsors.get')}</a></div>
              <div className="rf-row"><span className="rf-grow rf-t1">{t('ops2.sponsors.poster')}</span><Link className="rf-btn" to={`/event-tools/${competition.id}/print/poster`}>{t('ops2.sponsors.print')}</Link></div>
              <div className="rf-row"><span className="rf-grow rf-t1">{t('ops2.sponsors.websiteEmbed')}</span><button type="button" className="rf-btn" onClick={() => setView({ kind: 'embed' })}>{t('ops2.sponsors.getCode')}</button></div>
            </RefineList>

            <h2 className="rf-sec ops-tt-head"><span>{t('ops2.sponsors.shop')}</span></h2>
            <RefineList as="div" label={t('ops2.sponsors.shop')}>
              <div className="rf-row"><span className="rf-grow rf-t1">{t('ops2.sponsors.eventShop')}</span><Link className="rf-btn" to={`/competitions/${competition.id}/shop/manage`}>{t('ops2.sponsors.manage')}</Link></div>
            </RefineList>
          </>
        )}

        {view.kind === 'add' && <AddSponsor busy={busy} onCreate={create} onProblem={setError} />}

        {view.kind === 'edit' && !sponsor && <p role="status" className="rf-note">{t('common.loading')}</p>}
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
  const t = useT();
  const [state, setState] = useState<'idle' | 'failed'>('idle');
  const toast = useToast();
  const url = competitionLink(id, window.location.origin);
  async function share() {
    setState('idle');
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ title: name, url }); return; }
      catch (caught) { if (caught && typeof caught === 'object' && 'name' in caught && caught.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); toast.show(t('ops2.sponsors.linkCopied')); }
    catch { setState('failed'); }
  }
  return (
    <div className="rf-row">
      <span className="rf-grow rf-t1">{t('ops2.sponsors.eventLink')}</span>
      {state === 'failed' && <a className="rf-t2" href={url}>{t('ops2.sponsors.copyLink')}</a>}
      <button type="button" className="rf-btn" onClick={() => void share()}>{t('ops2.sponsors.share')}</button>
      {toast.node}
    </div>
  );
}

/** The first step of a new sponsor: a name (and optionally a website). It is added as soon as the name is in. */
function AddSponsor({ busy, onCreate, onProblem }: { busy: boolean; onCreate: (name: string, link: string) => Promise<boolean>; onProblem: (message: string | null) => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const sent = useRef(false);
  async function submit() {
    const text = name.trim();
    const address = link.trim();
    if (!text || busy || sent.current) return;
    if (address && !isHttpsLink(address)) { onProblem(t('ops2.sponsors.httpsLink')); return; }
    sent.current = true;
    const ok = await onCreate(text, address);
    if (!ok) sent.current = false;
  }
  // The sponsor is added when focus leaves the form (not when moving from Name to Website), or on Enter.
  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) void submit(); }}>
      <h2 className="rf-sec ops-tt-head"><span>{t('ops2.sponsors.about')}</span></h2>
      <div className="ops-fields-row">
        <label className="rf-fld">{t('ops2.sponsors.name')}<input autoFocus value={name} placeholder={t('ops2.sponsors.namePlaceholder')} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
        <label className="rf-fld">{t('ops2.sponsors.website')}<input type="url" inputMode="url" value={link} placeholder="https://" maxLength={300} onChange={(event) => setLink(event.target.value)} /></label>
      </div>
      <button type="submit" hidden aria-hidden="true" tabIndex={-1}>{t('ops2.sponsors.add')}</button>
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
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(sponsor.name);
  const [link, setLink] = useState(sponsor.linkUrl ?? '');
  const [dated, setDated] = useState(Boolean(sponsor.startsAt || sponsor.endsAt));
  const hasLogo = sponsor.logoUrl !== null;
  const status = sponsorStatus(sponsor, useNow());

  function saveName() {
    const next = name.trim();
    if (!next) { setName(sponsor.name); onProblem(t('ops2.sponsors.needName')); return; }
    if (next !== sponsor.name) onPatch({ name: next }, t('ops2.sponsors.nameError'));
  }
  function saveLink() {
    const next = link.trim();
    if (next === (sponsor.linkUrl ?? '')) return;
    if (next && !isHttpsLink(next)) { onProblem(t('ops2.sponsors.httpsLink')); setLink(sponsor.linkUrl ?? ''); return; }
    onProblem(null);
    onPatch({ linkUrl: next || null }, t('ops2.sponsors.websiteError'));
  }
  function setDate(which: 'startsAt' | 'endsAt', value: string) {
    const iso = value ? (which === 'startsAt' ? dateToStart(value) : dateToEnd(value)) : null;
    onPatch({ [which]: iso }, t('ops2.sponsors.datesError'));
  }
  function setDatedOn(on: boolean) {
    setDated(on);
    if (!on && (sponsor.startsAt || sponsor.endsAt)) onPatch({ startsAt: null, endsAt: null }, t('ops2.sponsors.datesClearError'));
  }

  return (
    <>
      <h2 className="rf-sec ops-tt-head"><span>{t('ops2.sponsors.logo')}</span></h2>
      <RefineList as="div" label={t('ops2.sponsors.logo')}>
        <div className="rf-row">
          <OrganiserLogo sponsor={sponsor} />
          <span className="rf-grow rf-t1">{hasLogo ? t('ops2.sponsors.logo') : t('ops2.sponsors.noLogo')}</span>
          <input ref={fileRef} type="file" hidden aria-label={t('ops2.sponsors.logoFile')} accept="image/png,image/jpeg,image/webp"
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onLogo(file); }} />
          <button type="button" className="rf-btn" disabled={busy} onClick={() => fileRef.current?.click()}>{hasLogo ? t('ops2.sponsors.change') : t('ops2.sponsors.upload')}</button>
          {hasLogo && <button type="button" className="ops-danger-link" disabled={busy} onClick={onRemoveLogo}>{t('ops2.sponsors.removeLogo')}</button>}
        </div>
      </RefineList>

      <h2 className="rf-sec ops-tt-head"><span>{t('ops2.sponsors.about')}</span></h2>
      <div className="ops-fields-row">
        <label className="rf-fld">{t('ops2.sponsors.name')}<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} onBlur={saveName} /></label>
        <label className="rf-fld">{t('ops2.sponsors.website')}<input type="url" inputMode="url" value={link} placeholder="https://" maxLength={300} onChange={(event) => setLink(event.target.value)} onBlur={saveLink} /></label>
      </div>

      <h2 className="rf-sec ops-tt-head"><span>{t('ops2.sponsors.whereShows')}</span></h2>
      <RefineList as="div" label={t('ops2.sponsors.whereShows')}>
        {PLACES.map((place) => (
          <RefineSwitchRow key={place.key} label={t(place.label)} on={hasPlacement(sponsor.showOn, place.key)} disabled={busy}
            onChange={(on) => onPatch({ showOn: withPlacement(sponsor.showOn & SHOWN_BITS, place.key, on) }, t('ops2.sponsors.whereError'))} />
        ))}
      </RefineList>

      <h2 className="rf-sec ops-tt-head"><span>{t('ops2.sponsors.when')}</span></h2>
      <RefineList as="div" label={t('ops2.sponsors.when')}>
        <RefineSwitchRow label={t('ops2.sponsors.between')} on={dated} disabled={busy} onChange={setDatedOn} />
        {dated && (
          <div className="ops-fields-row ops-dates">
            <label className="rf-fld">{t('ops2.sponsors.from')}<input type="date" value={startToDate(sponsor.startsAt)} max={endToDate(sponsor.endsAt) || undefined} onChange={(event) => setDate('startsAt', event.target.value)} /></label>
            <label className="rf-fld">{t('ops2.sponsors.until')}<input type="date" value={endToDate(sponsor.endsAt)} min={startToDate(sponsor.startsAt) || undefined} onChange={(event) => setDate('endsAt', event.target.value)} /></label>
          </div>
        )}
        <RefineSwitchRow label={t('ops2.sponsors.showing')} on={sponsor.isEnabled} disabled={busy} onChange={(on) => onPatch({ isEnabled: on }, t('ops2.sponsors.changeError'))} />
        <div className="rf-row" aria-label={t('ops2.sponsors.status')}>
          <span className="rf-grow"><span className="rf-t1">{t('ops2.sponsors.status')}</span><span className="rf-t2">{t(STATUS_NOTE[status])}</span></span>
          <span className={`ops-status ops-status-${status.toLowerCase()}`}>{t(STATUS_WORD[status])}</span>
        </div>
      </RefineList>

      <div className="ops-end-left ops-remove"><button type="button" className="ops-danger-link" disabled={busy} onClick={onRemove}>{t('ops2.sponsors.removeThis')}</button></div>
    </>
  );
}
