import { useCallback, useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { usePageWidth } from '../../components/pageWidthState';
import { useCompetition } from '../competition/context';
import { LoadError, StatusPill } from './commerceUi';
import { CATEGORY_LABEL, LISTING_LABEL, ORDER_LABEL, errorMessage, pounds } from './commerceFormat';
import type { CompetitionListing, EventCommerceSettings, EventOrder } from './types';
import './commerce.css';

type ManagementView = 'listings' | 'orders' | 'settings';

export function CommerceManagementPage() {
  usePageWidth('wide');
  const { competition } = useCompetition();
  const { user } = useAuth();
  return <CommerceManagementContent key={`${competition.id}:${user?.id ?? 'signed-out'}`} />;
}

function CommerceManagementContent() {
  const { competition } = useCompetition();
  const { canOrganise } = useAuth();
  const [listings, setListings] = useState<CompetitionListing[] | null>(null);
  const [orders, setOrders] = useState<EventOrder[] | null>(null);
  const [settings, setSettings] = useState<EventCommerceSettings | null>(null);
  const [view, setView] = useState<ManagementView>('listings');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!canOrganise(competition)) return Promise.resolve();
    return Promise.all([
        api.get<CompetitionListing[]>(`/commerce/competitions/${competition.id}/listings/manage`),
        api.get<EventOrder[]>(`/commerce/competitions/${competition.id}/orders`),
        api.get<EventCommerceSettings>(`/commerce/competitions/${competition.id}/settings`),
      ])
      .then(([listingResponse, orderResponse, settingsResponse]) => {
      setError(null);
      setListings(listingResponse.data);
      setOrders(orderResponse.data);
      setSettings(settingsResponse.data);
      })
      .catch((requestError: unknown) => {
      setError(errorMessage(requestError, 'Couldn’t load the shop controls. Check your signal and try again.'));
      });
  }, [canOrganise, competition]);

  useEffect(() => { void load(); }, [load]);

  async function review(id: number, status: 1 | 2) {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/commerce/listings/${id}/approval`, { status, reviewNote: null });
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError, 'Couldn’t update the listing. Check your signal and try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function setDemo(isDemo: boolean) {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.put<EventCommerceSettings>(`/commerce/competitions/${competition.id}/settings`, { isDemo });
      setSettings(data);
    } catch (requestError) {
      setError(errorMessage(requestError, 'Couldn’t change the payment mode. Check your signal and try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function manualAction(order: EventOrder, action: 'manual-payment' | 'manual-refund') {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/commerce/orders/${order.id}/${action}`, { confirmedExternally: true });
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError, action === 'manual-payment' ? 'Couldn’t mark the order paid. Check your signal and try again.' : 'Couldn’t mark the refund. Check your signal and try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (!canOrganise(competition)) return <div className="skin mg-card p-5">Only this competition’s organiser can manage its shop.</div>;

  const pending = listings?.filter((listing) => listing.status === 0) ?? [];
  const reviewed = listings?.filter((listing) => listing.status !== 0) ?? [];

  return (
    <div className="skin commerce-page mx-auto w-full max-w-4xl pb-6">
      <header className="commerce-title-block"><p className="mg-eyebrow">{competition.name}</p><h1 className="mg-h1">Manage shop</h1><p className="mg-lede">Listings, orders and payment mode.</p></header>
      <div className="mg-seg w-full" aria-label="Shop management view">
        <button type="button" aria-pressed={view === 'listings'} onClick={() => setView('listings')}>Listings{pending.length > 0 ? ` (${pending.length})` : ''}</button>
        <button type="button" aria-pressed={view === 'orders'} onClick={() => setView('orders')}>Orders{orders?.length ? ` (${orders.length})` : ''}</button>
        <button type="button" aria-pressed={view === 'settings'} onClick={() => setView('settings')}>Settings</button>
      </div>
      {error && <LoadError message={error} onRetry={() => void load()} />}

      {view === 'settings' && <section className="flex flex-col gap-4" aria-labelledby="payment-mode-title">
        <div>
          <h2 id="payment-mode-title" className="mg-h2">Payment mode</h2>
          <p className="mg-meta mt-1">Manual logs external payments. Demo is for testing.</p>
        </div>
        {settings == null ? <p role="status">Loading payment mode…</p> : (
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill tone={settings.isDemo ? 'test' : 'neutral'}>{settings.isDemo ? 'DEMO · no money is taken' : 'Manual payments'}</StatusPill>
            <div className="mg-toggle">
              <button type="button" aria-pressed={!settings.isDemo} disabled={busy || settings.isLocked} onClick={() => void setDemo(false)}>Manual</button>
              <button type="button" aria-pressed={settings.isDemo} disabled={busy || settings.isLocked} onClick={() => void setDemo(true)}>Demo</button>
            </div>
            {settings.isLocked && <p className="mg-meta">Locked because an order or test payment exists.</p>}
          </div>
        )}
      </section>}

      {view === 'listings' && <section className="flex flex-col gap-3" aria-labelledby="approval-title">
        <div className="mg-section-head"><h2 id="approval-title">Approval queue</h2><span>{pending.length}</span></div>
        {listings == null && <p role="status" className="mg-card p-4">Loading listings…</p>}
        {listings && pending.length === 0 && <p className="mg-card p-5">There are no seller items waiting for approval.</p>}
        {pending.length > 0 && <div className="commerce-rows">{pending.map((listing) => (
          <article key={listing.id} className="commerce-order-row">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="mg-h2">{listing.item.title}</h3>
                <p className="mt-1 text-sm text-[rgb(var(--mg-body))]">{listing.item.description}</p>
                <p className="mt-1 text-sm font-bold">{pounds(listing.item.priceMinor)} · {CATEGORY_LABEL[listing.item.category]} · {listing.item.stockQuantity == null ? 'Unlimited stock' : `${listing.item.stockQuantity} available`}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="mg-btn mg-btn-primary" disabled={busy} onClick={() => void review(listing.id, 1)}><Check className="h-4 w-4" /> Approve</button>
                <button type="button" className="mg-btn mg-btn-secondary" disabled={busy} onClick={() => void review(listing.id, 2)}><X className="h-4 w-4" /> Reject</button>
              </div>
            </div>
          </article>
        ))}</div>}
        {reviewed.length > 0 && <details className="commerce-rows px-4"><summary className="cursor-pointer py-3 font-bold text-[rgb(var(--mg-heading))]">Reviewed listings ({reviewed.length})</summary><ul className="flex flex-col gap-2 pb-3">{reviewed.map((listing) => <li key={listing.id} className="flex flex-wrap items-center gap-2 border-t border-[rgb(var(--mg-rule-soft))] pt-2"><span className="flex-1">{listing.item.title}</span><StatusPill tone={listing.status === 1 ? 'good' : 'neutral'}>{LISTING_LABEL[listing.status]}</StatusPill></li>)}</ul></details>}
      </section>}

      {view === 'orders' && <section className="flex flex-col gap-3" aria-labelledby="orders-title">
        <div className="mg-section-head"><h2 id="orders-title">Event orders</h2><span>{orders?.length ?? 0}</span></div>
        {orders == null && <p role="status" className="mg-card p-4">Loading orders…</p>}
        {orders?.length === 0 && <p className="mg-card p-5">No one has ordered from this event shop yet.</p>}
        {orders && orders.length > 0 && <div className="commerce-rows">{orders.map((order) => (
          <article key={order.id} className="commerce-order-row">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="mg-h2">Order #{order.id}</h3>
              <StatusPill tone={order.isTestOrder ? 'test' : order.status === 2 ? 'good' : 'neutral'}>{order.isTestOrder ? `Demo · ${ORDER_LABEL[order.status]}` : ORDER_LABEL[order.status]}</StatusPill>
              <strong className="ml-auto">{pounds(order.totalMinor)}</strong>
            </div>
            <p className="text-sm text-[rgb(var(--mg-body))]">{order.lines.map((line) => `${line.title} × ${line.quantity}`).join(', ')}</p>
            {!order.isTestOrder && order.status === 0 && <button type="button" className="mg-btn mg-btn-primary self-start" disabled={busy} onClick={() => void manualAction(order, 'manual-payment')}>Mark external payment received</button>}
            {!order.isTestOrder && order.status === 2 && <button type="button" className="mg-btn mg-btn-secondary self-start" disabled={busy} onClick={() => void manualAction(order, 'manual-refund')}>Mark external refund sent</button>}
          </article>
        ))}</div>}
      </section>}
    </div>
  );
}
