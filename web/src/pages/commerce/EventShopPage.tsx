import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Minus, Plus, ShoppingBag } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCompetition } from '../competition/context';
import { LoadError, PageHeader, StatusPill } from './commerceUi';
import { CATEGORY_LABEL, errorMessage, newIdempotencyKey, pounds } from './commerceFormat';
import { DemoPaymentFlow } from './DemoPaymentFlow';
import type { CommerceItemCategory, DemoOrderPaymentResult, EventCommerceSettings, EventOrder, FakePaymentOutcome, PublicCompetitionListing, TestPayment } from './types';

type Filter = 'all' | CommerceItemCategory;

export function EventShopPage() {
  const { competition } = useCompetition();
  const { user } = useAuth();
  return <EventShopContent key={`${competition.id}:${user?.id ?? 'signed-out'}`} />;
}

function EventShopContent() {
  const { competition } = useCompetition();
  const { user } = useAuth();
  const [listings, setListings] = useState<PublicCompetitionListing[] | null>(null);
  const [settings, setSettings] = useState<EventCommerceSettings | null>(null);
  const [basket, setBasket] = useState<Record<number, number>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<EventOrder | null>(null);
  const orderAttempt = useRef<{ basketSignature: string; idempotencyKey: string } | null>(null);

  const load = useCallback(() =>
    Promise.all([
        api.get<PublicCompetitionListing[]>(`/commerce/competitions/${competition.id}/listings`),
        api.get<EventCommerceSettings>(`/commerce/competitions/${competition.id}/settings`),
      ])
      .then(([listingResponse, settingsResponse]) => {
      setError(null);
      setListings(listingResponse.data);
      setSettings(settingsResponse.data);
      })
      .catch((requestError: unknown) => {
      setError(errorMessage(requestError, 'Couldn’t load the event shop.'));
      }), [competition.id]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => listings?.filter((listing) => filter === 'all' || listing.category === filter) ?? [], [filter, listings]);
  const basketLines = useMemo(() => (listings ?? [])
    .filter((listing) => (basket[listing.id] ?? 0) > 0)
    .map((listing) => ({ listing, quantity: basket[listing.id] })), [basket, listings]);
  const estimatedTotal = basketLines.reduce((total, line) => total + line.listing.priceMinor * line.quantity, 0);

  function changeQuantity(listing: PublicCompetitionListing, delta: number) {
    orderAttempt.current = null;
    setBasket((current) => {
      const next = Math.max(0, Math.min(listing.stockQuantity ?? 99, (current[listing.id] ?? 0) + delta));
      return { ...current, [listing.id]: next };
    });
  }

  async function checkout() {
    if (!user || basketLines.length === 0) return;
    const basketSignature = `${competition.id}|${basketLines
      .map(({ listing, quantity }) => `${listing.id}:${quantity}`)
      .sort()
      .join('|')}`;
    if (orderAttempt.current?.basketSignature !== basketSignature) {
      orderAttempt.current = {
        basketSignature,
        idempotencyKey: newIdempotencyKey('event-order'),
      };
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<EventOrder>(`/commerce/competitions/${competition.id}/orders`, {
        idempotencyKey: orderAttempt.current.idempotencyKey,
        items: basketLines.map(({ listing, quantity }) => ({ listingId: listing.id, quantity })),
      });
      orderAttempt.current = null;
      setOrder(data);
      setBasket({});
      void load();
    } catch (requestError) {
      setError(errorMessage(requestError, 'Couldn’t place your order. Check the basket and try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="skin mx-auto flex w-full max-w-3xl flex-col gap-5 pb-6">
      <PageHeader title={`${competition.name} shop`}>
        Order event tickets, camping and merchandise here. Everything is collected at the event.
      </PageHeader>

      <nav aria-label="Shop categories" className="mg-chips flex-wrap overflow-visible">
        <button type="button" className="mg-chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
        {([1, 2, 0, 3] as CommerceItemCategory[]).map((category) => (
          <button key={category} type="button" className="mg-chip" aria-pressed={filter === category} onClick={() => setFilter(category)}>
            {CATEGORY_LABEL[category]}
          </button>
        ))}
      </nav>

      {error && <LoadError message={error} onRetry={() => void load()} />}
      {listings == null && !error && <p role="status" className="mg-card p-4 text-[rgb(var(--mg-muted))]">Loading the shop…</p>}
      {listings && listings.length === 0 && <p className="mg-card p-5">There’s nothing in the event shop yet.</p>}
      {listings && listings.length > 0 && visible.length === 0 && <p className="mg-card p-5">There’s nothing in this category yet.</p>}

      {visible.length > 0 && (
        <section className="mg-card mg-list" aria-label="Products">
          {visible.map((listing) => {
            const quantity = basket[listing.id] ?? 0;
            const soldOut = listing.stockQuantity === 0;
            return (
              <article key={listing.id} className="flex min-h-28 flex-col gap-3 p-4 sm:flex-row sm:items-center">
                {listing.imageUrl && <img src={listing.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="mg-h2">{listing.title}</h2>
                    <StatusPill tone="good">Approved by organiser</StatusPill>
                  </div>
                  <p className="mt-1 text-sm text-[rgb(var(--mg-body))]">{listing.description}</p>
                  <p className="mt-1 text-xs font-semibold text-[rgb(var(--mg-muted))]">{CATEGORY_LABEL[listing.category]} · Collect at the event</p>
                </div>
                <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end">
                  <span className="text-lg font-bold text-[rgb(var(--mg-heading))]">{pounds(listing.priceMinor)}</span>
                  {soldOut ? <StatusPill tone="warn">Sold out</StatusPill> : (
                    <div className="flex items-center gap-1" aria-label={`Quantity for ${listing.title}`}>
                      <button type="button" className="mg-icon-btn" aria-label={`Remove one ${listing.title}`} disabled={quantity === 0} onClick={() => changeQuantity(listing, -1)}><Minus className="h-4 w-4" /></button>
                      <output className="w-8 text-center font-bold" aria-live="polite">{quantity}</output>
                      <button type="button" className="mg-icon-btn" aria-label={`Add one ${listing.title}`} disabled={quantity >= (listing.stockQuantity ?? 99)} onClick={() => changeQuantity(listing, 1)}><Plus className="h-4 w-4" /></button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {basketLines.length > 0 && (
        <section className="mg-card flex flex-col gap-3 border-2 !border-[rgb(var(--mg-heading))] p-4" aria-label="Basket">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-[rgb(var(--mg-heading))]" />
            <h2 className="mg-h2 flex-1">Your basket</h2>
            <strong>{pounds(estimatedTotal)}</strong>
          </div>
          <p className="mg-meta">Your total is confirmed when you place the order. Collect everything at the event.</p>
          {user ? (
            <button type="button" className="mg-btn mg-btn-primary w-full" disabled={busy} onClick={() => void checkout()}>
              {busy ? 'Placing order…' : settings?.isDemo ? 'Create demo order' : 'Place order'}
            </button>
          ) : (
            <Link className="mg-btn mg-btn-primary w-full" to="/login">Sign in to order</Link>
          )}
        </section>
      )}

      {order && (
        <section className="mg-card flex flex-col gap-3 p-4" aria-live="polite">
          <h2 className="mg-h2">Order #{order.id}</h2>
          <p>The confirmed total is <strong>{pounds(order.totalMinor)}</strong>.</p>
          {order.isTestOrder ? (
            <DemoOrderCheckout order={order} onChanged={setOrder} />
          ) : (
            <p className="mg-notice">Pay the organiser using their usual payment details. They’ll mark the order paid when the money arrives.</p>
          )}
        </section>
      )}
    </div>
  );
}

export function DemoOrderCheckout({ order, onChanged }: { order: EventOrder; onChanged: (order: EventOrder) => void }) {
  const [receipt, setReceipt] = useState<TestPayment | null>(() => order.testPayments.at(-1) ?? null);

  async function run(outcome: FakePaymentOutcome, idempotencyKey: string) {
    const { data } = await api.post<DemoOrderPaymentResult>(`/commerce/orders/${order.id}/demo-checkout`, {
      idempotencyKey,
      outcome,
    });
    onChanged(data.order);
    setReceipt(data.payment);
    return data.payment;
  }

  return (
    <DemoPaymentFlow
      targetKey={`order-${order.id}`}
      title={`Order #${order.id}`}
      amountMinor={order.totalMinor}
      initialPayment={receipt}
      canPay={order.status === 1 || order.status === 3}
      onPay={run}
      onPayment={setReceipt}
    />
  );
}
