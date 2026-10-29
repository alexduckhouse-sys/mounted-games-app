import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { useT } from '../../i18n/LanguageContext';
import { CardDropdownRow } from '../CardDropdownRow';
import { Notice } from '../Notice';
import { apiErrorMessage } from '../../lib/apiError';
import { buildLorryPassFromBooking, downloadOfflineWalletPass } from '../../lib/stablingPass';
import { qrSvgMarkup } from '../../pages/operations/entryLogic';
import { downloadApplePass, parseArrivalBooking, parseArrivalBookings, parseArrivalEntitlements, parseArrivalEvents, type ArrivalBooking, type ArrivalEntitlement } from './walletTypes';

export function ArrivalBookingCard({ booking, staff = false, onChanged }: { booking: ArrivalBooking; staff?: boolean; onChanged?: () => void }) {
  const t = useT(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [vehicle, setVehicle] = useState(booking.vehicleRegistration);
  async function saveVehicle() {
    if (vehicle === booking.vehicleRegistration) return;
    setError('');
    try { await api.put(`/competitions/${booking.competitionId}/arrival-bookings/${booking.id}`, { expectedRevision: booking.revision, vehicleRegistration: vehicle, sources: booking.benefits.map(b => ({ orderLineId: b.orderLineId, quantity: b.quantity })) }); onChanged?.(); }
    catch (e) { setError(apiErrorMessage(e, t('apple.arrival.error'))); }
  }
  return <section className="mg-card flex flex-col gap-3 p-4">
    <h3 className="font-semibold">{t('apple.arrival.title')}</h3>
    <label className="rf-fld">{t('apple.arrival.vehicle')}<input value={vehicle} maxLength={40} onChange={e => setVehicle(e.target.value.toUpperCase())} onBlur={() => void saveVehicle()} /></label>
    <p>{t('apple.arrival.admission')}: {t(`apple.arrival.${booking.admission}`)}</p>
    {booking.benefits.map(b => <div key={b.sourceId} className="text-sm">
      <p>{t(`apple.arrival.kind${b.kind}`)} · {b.quantity} · {t(`apple.arrival.${b.status}`)}</p>
      {b.fromDate && <p>{b.fromDate} – {b.untilDate}</p>}
      {!staff && b.allocations.map(a => <p key={`${a.resource}:${a.night}`}>{a.resource} · {a.night}</p>)}
      <button type="button" className="kit-pill" disabled={busy} onClick={() => {
        setBusy(true); setError('');
        void api.put(`/competitions/${booking.competitionId}/arrival-bookings/${booking.id}`, { expectedRevision: booking.revision, vehicleRegistration: vehicle, sources: booking.benefits.filter(x => x.sourceId !== b.sourceId || x.quantity > 1).map(x => ({ orderLineId: x.orderLineId, quantity: x.quantity - (x.sourceId === b.sourceId ? 1 : 0) })) }).then(() => onChanged?.()).catch(e => setError(apiErrorMessage(e, t('apple.arrival.error')))).finally(() => setBusy(false));
      }}>{t('apple.arrival.releaseOne')}</button>
      {staff && b.status === 'paid' && (b.kind === 3 || b.kind === 4) && <AllocationEditor booking={booking} sourceId={b.sourceId} onChanged={onChanged} />}
    </div>)}
    <p className="mg-meta">{t('apple.arrival.online')}</p>
    {booking.needsReview && <Notice>{t('apple.arrival.review')}</Notice>}
    {staff && booking.needsReview && <button type="button" className="kit-pill" onClick={() => { void api.post(`/competitions/${booking.competitionId}/arrival-bookings/${booking.id}/reconcile-legacy?expectedRevision=${booking.revision}`).then(() => onChanged?.()).catch(e => setError(apiErrorMessage(e, t('apple.arrival.error')))); }}>{t('apple.arrival.reconcile')}</button>}
    {error && <Notice>{error}</Notice>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="kit-pill" onClick={() => { const pass = buildLorryPassFromBooking(booking); downloadOfflineWalletPass(pass, qrSvgMarkup(pass.verificationUrl)); }}>{t('apple.arrival.download')}</button>
      {booking.walletAvailable && !booking.voided && !booking.needsReview && <button type="button" className="kit-pill" disabled={busy} onClick={() => { setBusy(true); setError(''); void downloadApplePass(booking).catch(() => setError(t('apple.arrival.walletError'))).finally(() => setBusy(false)); }}>{t('apple.arrival.wallet')}</button>}
    </div>
  </section>;
}
function AllocationEditor({ booking, sourceId, onChanged }: { booking: ArrivalBooking; sourceId: number; onChanged?: () => void }) {
  const t = useT(); const benefit = booking.benefits.find(b => b.sourceId === sourceId)!;
  const [busy, setBusy] = useState(false); const [resource, setResource] = useState(''); const [night, setNight] = useState(benefit.fromDate ?? ''); const [error, setError] = useState('');
  async function allocate(remove?: { resource: string; night: string }) {
    setBusy(true);
    try {
      const existing = booking.benefits.flatMap(b => b.allocations.filter(a => !(remove && b.sourceId === sourceId && a.resource === remove.resource && a.night === remove.night)).map(a => ({ sourceId: b.sourceId, ...a })));
      await api.put(`/competitions/${booking.competitionId}/arrival-bookings/${booking.id}/allocations`, { expectedRevision: booking.revision, allocations: remove ? existing : [...existing, { sourceId, resource, night }] });
      setResource(''); setError(''); onChanged?.();
    } catch (e) { setError(apiErrorMessage(e, t('apple.arrival.error'))); } finally { setBusy(false); }
  }
  return <div className="mt-2 flex flex-col gap-2">{benefit.allocations.map(a => <div key={`${a.resource}:${a.night}`} className="flex items-center justify-between gap-3"><span>{a.resource} · {a.night}</span><button type="button" className="kit-redtext" disabled={busy} aria-label={`${t('apple.arrival.removeAllocation')} ${a.resource} ${a.night}`} onClick={() => void allocate(a)}>{t('apple.arrival.removeAllocation')}</button></div>)}<label className="rf-fld">{t('apple.arrival.resource')}<input value={resource} maxLength={80} onChange={e => setResource(e.target.value)} /></label>
    <label className="rf-fld">{t('apple.arrival.night')}<input type="date" value={night} onChange={e => setNight(e.target.value)} /></label>
    <button className="kit-pill" type="button" disabled={busy || !resource.trim() || !night} onClick={() => void allocate()}>{t('apple.arrival.allocate')}</button>{error && <Notice>{error}</Notice>}</div>;
}
export function ArrivalBookings({ competitionId, signupId, staff = false }: { competitionId: number; signupId?: number; staff?: boolean }) {
  return <ArrivalBookingsContent key={`${competitionId}:${signupId ?? 'all'}:${staff}`} competitionId={competitionId} signupId={signupId} staff={staff} />;
}
function ArrivalBookingsContent({ competitionId, signupId, staff }: { competitionId: number; signupId?: number; staff: boolean }) {
  const t = useT(); const [rows, setRows] = useState<ArrivalBooking[]>([]); const [lines, setLines] = useState<ArrivalEntitlement[]>([]); const [error, setError] = useState('');
  const [selected, setSelected] = useState<Record<number, number>>({});
  const request = useRef(0); const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    const current = ++request.current;
    try {
      const params = signupId ? { signupId } : {};
      const [bookings, entitlements] = await Promise.all([api.get<unknown>(`/competitions/${competitionId}/arrival-bookings`, { params }), api.get<unknown>(`/competitions/${competitionId}/arrival-bookings/entitlements`, { params })]);
      const nextRows = parseArrivalBookings(bookings.data); const nextLines = parseArrivalEntitlements(entitlements.data);
      if (current !== request.current) return;
      setRows(nextRows); setLines(nextLines); setError(''); setLoaded(true);
    } catch {
      if (current !== request.current) return;
      setRows([]); setLines([]); setLoaded(false); setError(t('apple.arrival.error'));
    }
  }, [competitionId, signupId, t]);
  const invalidate = useCallback(() => { request.current++; }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); return invalidate; }, [reload, invalidate]);
  async function create() {
    setError(''); try {
      await api.post(`/competitions/${competitionId}/arrival-bookings`, { expectedRevision: 0, signupId: rows.some(row => row.signupId === signupId) ? null : signupId, vehicleRegistration: '', sources: Object.entries(selected).filter(([, n]) => n > 0).map(([id, quantity]) => ({ orderLineId: Number(id), quantity })) }, { params: { forSignupId: signupId } });
      setSelected({}); await reload();
    } catch (e) { setError(apiErrorMessage(e, t('apple.arrival.error'))); }
  }
  const available = lines.filter(x => (x.status === 'paid' || x.status === 'pending') && x.kind >= 2 && x.quantity > x.assigned);
  return <div className="flex flex-col gap-3">
    {!loaded && !error && <p className="mg-meta" role="status">{t('common.loading')}</p>}
    {loaded && !signupId && rows.length === 0 && lines.length === 0 && <p className="mg-meta">{t('apple.arrival.empty')}</p>}
    {rows.map(row => <ArrivalBookingCard key={`${row.id}:${row.revision}`} booking={row} staff={staff} onChanged={() => { void reload(); }} />)}
    {staff && lines.filter(x => x.kind === 0).map(line => <FulfilmentEditor key={line.orderLineId} competitionId={competitionId} line={line} onChanged={() => { void reload(); }} />)}
    {available.map(line => <label key={line.orderLineId} className="rf-fld">{line.title} · {t(`apple.arrival.${line.status}`)}
      <span className="flex items-center gap-4"><button type="button" className="kit-pill" aria-label={t('apple.arrival.fewer')} disabled={!selected[line.orderLineId]} onClick={() => setSelected({ ...selected, [line.orderLineId]: (selected[line.orderLineId] ?? 0) - 1 })}>−</button><span>{selected[line.orderLineId] ?? 0}</span><button type="button" className="kit-pill" aria-label={t('apple.arrival.more')} disabled={(selected[line.orderLineId] ?? 0) >= line.quantity - line.assigned} onClick={() => setSelected({ ...selected, [line.orderLineId]: (selected[line.orderLineId] ?? 0) + 1 })}>+</button></span></label>)}
    {loaded && (available.length > 0 || (signupId && rows.length === 0)) && <button type="button" className="kit-pill" onClick={() => void create()}>{t('apple.arrival.add')}</button>}
    {lines.some(x => x.kind === 0) && <p className="mg-meta">{t('apple.arrival.review')}</p>}{error && <Notice actionLabel={t('common.tryAgain')} onAction={() => { void reload(); }}>{error}</Notice>}
  </div>;
}
export function ArrivalGateLookup({ competitionId }: { competitionId: number }) {
  const t = useT(); const [booking, setBooking] = useState<ArrivalBooking | null>(null); const [error, setError] = useState('');
  const reference = new URLSearchParams(window.location.search).get('arrival');
  useEffect(() => {
    // A new scan must never retain the preceding vehicle's result while verification runs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBooking(null); setError('');
    if (!reference) return; let live = true;
    void api.get<ArrivalBooking>(`/competitions/${competitionId}/arrival-bookings/gate/${encodeURIComponent(reference)}`).then(r => { const verified = parseArrivalBooking(r.data); if (live) setBooking(verified); })
      .catch(() => { if (live) setError(t('apple.arrival.gateError')); }); return () => { live = false; };
  }, [competitionId, reference, t]);
  if (!reference) return null;
  return <section className="mg-card p-4"><h2>{t('apple.arrival.gate')}</h2>{error && <Notice>{error}</Notice>}{booking && <><p className="font-semibold">{booking.vehicleRegistration}</p>
    <p>{t('apple.arrival.admission')}: {t(`apple.arrival.${booking.admission}`)}</p>{booking.benefits.map(b => <p key={b.sourceId}>{t(`apple.arrival.kind${b.kind}`)} · {b.quantity} · {t(`apple.arrival.${b.status}`)} {b.allocations.map(a => `${a.resource} (${a.night})`).join(', ')}</p>)}
    {(booking.voided || booking.needsReview) && <Notice>{t('apple.arrival.review')}</Notice>}</>}</section>;
}

function FulfilmentEditor({ competitionId, line, onChanged }: { competitionId: number; line: ArrivalEntitlement; onChanged: () => void }) {
  const t = useT(); const [kind, setKind] = useState(3); const [from, setFrom] = useState(''); const [until, setUntil] = useState(''); const [error, setError] = useState('');
  async function classify() { try { await api.put(`/competitions/${competitionId}/arrival-bookings/order-lines/${line.orderLineId}/fulfilment`, { kind, fromDate: from || null, untilDate: until || null, expectedVersion: line.revision }); onChanged(); } catch (e) { setError(apiErrorMessage(e, t('apple.arrival.error'))); } }
  return <section className="mg-card flex flex-col gap-2 p-3"><h4>{line.title}</h4><div className="sp-card"><CardDropdownRow label={t('apple.arrival.kind')} value={String(kind)} onChange={v => setKind(Number(v))} options={([1, 2, 3, 4] as const).map(k => ({ value: String(k), label: t(`apple.arrival.kind${k}`) }))} /></div>
    {kind >= 3 && <><label className="rf-fld">{t('apple.arrival.firstNight')}<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label className="rf-fld">{t('apple.arrival.departure')}<input type="date" value={until} onChange={e => setUntil(e.target.value)} /></label></>}
    {kind >= 3 && <p className="mg-meta">{t('apple.arrival.nightsHint')}</p>}<button type="button" className="kit-pill" disabled={kind >= 3 && (!from || !until || until <= from)} onClick={() => void classify()}>{t('apple.arrival.confirmKind')}</button>{error && <Notice>{error}</Notice>}</section>;
}
export function MyArrivalBookings() {
  const t = useT(); const [events, setEvents] = useState<{ id: number; name: string }[]>([]); const [open, setOpen] = useState<number | null>(null); const [failed, setFailed] = useState(false);
  useEffect(() => { let active = true; void api.get<{ id: number; name: string }[]>('/apple/arrival-events').then(r => { const events = parseArrivalEvents(r.data); if (active) setEvents(events); }).catch(() => { if (active) setFailed(true); }); return () => { active = false; }; }, []);
  if (failed) return <Notice>{t('apple.arrival.error')}</Notice>;
  if (!events.length) return null;
  return <section className="mb-4 flex flex-col gap-3"><h2 className="sp-sec">{t('apple.arrival.title')}</h2>{events.map(event => <div key={event.id}><button type="button" className="sp-row w-full" aria-expanded={open === event.id} onClick={() => setOpen(open === event.id ? null : event.id)}>{event.name}</button>{open === event.id && <ArrivalBookings competitionId={event.id} />}</div>)}</section>;
}
