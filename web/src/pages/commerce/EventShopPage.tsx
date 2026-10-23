import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCompetition } from '../competition/context';
import { ShopClassifieds } from '../ShopPage';
import { RefineFoot, RefineHeader, RefineList, RefineNote, RefinePage, RefineQty, RefineStatus } from '../refine/Refine';
import { LoadError } from './commerceUi';
import { CATEGORY_LABEL, errorMessage, newIdempotencyKey, pounds } from './commerceFormat';
import { DemoPaymentFlow, OutcomeState } from './DemoPaymentFlow';
import type { CommerceItemCategory, DemoOrderPaymentResult, EventCommerceSettings, EventOrder, FakePaymentOutcome, PublicCompetitionListing, TestPayment } from './types';
import './commerce.css';

/** Camping and stabling first, then kit, tickets and the rest. */
const SHOP_ORDER: CommerceItemCategory[] = [2, 0, 1, 3];

const COLLECT_NOTE = 'Collect at the event.';

export function EventShopPage() {
  const { competition } = useCompetition();
  const { user } = useAuth();
  return <EventShopContent key={`${competition.id}:${user?.id ?? 'signed-out'}`} />;
}

type View = 'shop' | 'basket' | 'payment' | 'placed';

const itemsText = (count: number) => `${count} ${count === 1 ? 'item' : 'items'}`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function EventShopContent() {
  const { competition } = useCompetition();
  const { user } = useAuth();
  const [listings, setListings] = useState<PublicCompetitionListing[] | null>(null);
  const [settings, setSettings] = useState<EventCommerceSettings | null>(null);
  const [basket, setBasket] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<EventOrder | null>(null);
  const [view, setView] = useState<View>('shop');
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

  const basketLines = useMemo(() => (listings ?? [])
    .filter((listing) => (basket[listing.id] ?? 0) > 0)
    .map((listing) => ({ listing, quantity: basket[listing.id] })), [basket, listings]);
  const estimatedTotal = basketLines.reduce((total, line) => total + line.listing.priceMinor * line.quantity, 0);
  const basketCount = basketLines.reduce((total, line) => total + line.quantity, 0);
  const isDemo = settings?.isDemo ?? false;

  function changeQuantity(listing: PublicCompetitionListing, next: number) {
    if (busy) return;
    orderAttempt.current = null;
    const clamped = Math.max(0, Math.min(listing.stockQuantity ?? 99, next));
    const nextBasket = { ...basket, [listing.id]: clamped };
    setBasket(nextBasket);
    if (view === 'basket' && Object.values(nextBasket).every((quantity) => quantity === 0)) setView('shop');
  }

  /** Places the order. A repeat of the same basket reuses its key, so the server returns the same order. */
  async function checkout() {
    if (!user || basketLines.length === 0) return;
    const basketSignature = `${competition.id}|${basketLines
      .map(({ listing, quantity }) => `${listing.id}:${quantity}`)
      .sort()
      .join('|')}`;
    if (orderAttempt.current?.basketSignature !== basketSignature) {
      orderAttempt.current = { basketSignature, idempotencyKey: newIdempotencyKey('event-order') };
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<EventOrder>(`/commerce/competitions/${competition.id}/orders`, {
        idempotencyKey: orderAttempt.current.idempotencyKey,
        items: basketLines.map(({ listing, quantity }) => ({ listingId: listing.id, quantity })),
      });
      setOrder(data);
      if (data.isTestOrder) {
        setView('payment');
      } else {
        orderAttempt.current = null;
        setBasket({});
        setView('placed');
        void load();
      }
    } catch (requestError) {
      setError(errorMessage(requestError, 'Couldn’t place your order. Check the basket and try again.'));
    } finally {
      setBusy(false);
    }
  }

  function backToShop() {
    setView('shop');
    setOrder(null);
    setError(null);
  }

  if (view === 'placed' && order) {
    return (
      <RefinePage>
        <RefineHeader context={competition.name} title={`Order #${order.id}`} />
        <div className="rf-state"><div><div className="rf-t1">Order placed</div><div className="rf-t2">Your confirmed total is {pounds(order.totalMinor)}.</div></div></div>
        <OrderLines order={order} />
        <RefineNote>Pay the organiser using their usual payment details. They’ll mark the order paid when it arrives. {COLLECT_NOTE}</RefineNote>
        <RefineFoot><button type="button" className="rf-btn rf-btn-primary rf-wide" onClick={backToShop}>Back to shop</button></RefineFoot>
      </RefinePage>
    );
  }

  if (view === 'payment' && order) {
    return (
      <DemoOrderCheckout
        order={order}
        onChanged={(next) => {
          setOrder(next);
          // A cancelled order can't be paid or replayed, so the next attempt must start a fresh order.
          if (next.status === 4) orderAttempt.current = null;
          if (next.status === 2) { orderAttempt.current = null; setBasket({}); void load(); }
        }}
        variant="page"
        context={`${itemsText(order.lines.reduce((total, line) => total + line.quantity, 0) || basketCount)} · ${pounds(order.totalMinor)}`}
        onBack={() => setView('basket')}
        backLabel="Back to basket"
        approvedTitle="Order confirmed"
        resultContext={competition.name}
        renderResult={({ payment, retry }) => <ShopOutcome order={order} payment={payment} retry={retry} onShop={backToShop} />}
      />
    );
  }

  if (view === 'basket') {
    return (
      <RefinePage>
        <RefineHeader onBack={() => setView('shop')} backLabel="Back to shop" context={competition.name} title="Basket" demo={isDemo} />
        {error && <LoadError message={error} onRetry={() => void load()} />}
        <RefineList label="Basket items">
          {basketLines.map(({ listing, quantity }) => (
            <li key={listing.id} className="rf-row">
              <span className="rf-grow"><span className="rf-t1">{listing.title}</span><span className="rf-t2">{pounds(listing.priceMinor)} each</span></span>
              <RefineQty name={listing.title} value={quantity} max={listing.stockQuantity ?? 99} disabled={busy} onChange={(next) => changeQuantity(listing, next)} />
              <span className="rf-price w-16 text-right">{pounds(listing.priceMinor * quantity)}</span>
            </li>
          ))}
        </RefineList>
        <div className="rf-sum rf-sum-total -mx-4 mt-3"><span>Total</span><span>{pounds(estimatedTotal)}</span></div>
        <RefineNote>Your total is confirmed when you place the order. {COLLECT_NOTE}</RefineNote>
        <RefineFoot aboveTabs>
          {user ? (
            <button type="button" className="rf-btn rf-btn-primary rf-wide" disabled={busy || basketLines.length === 0} onClick={() => void checkout()}>
              {busy ? 'Placing order…' : isDemo ? 'Continue to payment' : 'Place order'}
            </button>
          ) : (
            <Link className="rf-btn rf-btn-primary rf-wide" to="/login">Sign in to order</Link>
          )}
        </RefineFoot>
      </RefinePage>
    );
  }

  const groups = SHOP_ORDER
    .map((category) => ({ category, items: (listings ?? []).filter((listing) => listing.category === category) }))
    .filter((group) => group.items.length > 0);
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 pb-2 pt-3">
      <ShopHeader />
      <p className="m-0 flex items-start gap-2 rounded-lg bg-[rgb(var(--mg-tint))] px-3 py-2.5 text-[13px] leading-snug text-[rgb(var(--mg-heading))]">
        <MapPin className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1">Listings approved by the organiser. {COLLECT_NOTE}</span>
        <Link className="mg-text-link !min-h-0 shrink-0 !text-[13px]" to="/me/orders" aria-label="Your orders">Your orders</Link>
      </p>
      {error && <LoadError message={error} onRetry={() => void load()} />}
      {listings == null && !error && <p role="status" className="mg-meta px-1">Loading the shop…</p>}
      {listings && listings.length === 0 && <p className="mg-card p-4">There’s nothing in the event shop yet.</p>}
      {groups.map(({ category, items }) => (
        <section key={category} className="mg-sec" aria-label={CATEGORY_LABEL[category]}>
          <div className="mg-sec-head"><h2>{CATEGORY_LABEL[category]}</h2></div>
          <ul className="mg-lines" aria-label={`${CATEGORY_LABEL[category]} for sale`}>
            {items.map((listing) => {
              const quantity = basket[listing.id] ?? 0;
              const soldOut = listing.stockQuantity === 0;
              const note = [listing.description, listing.stockQuantity != null && !soldOut ? `${listing.stockQuantity} left` : null].filter(Boolean).join(' · ');
              return (
                <li key={listing.id} className={`grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 py-2 pl-3 pr-2 ${quantity > 0 ? 'bg-[rgb(var(--mg-subtle))]' : ''}`}>
                  <span className="flex min-w-0 flex-col gap-[3px]">
                    <strong className="text-[15px] font-semibold">{listing.title}</strong>
                    {note && <span className="text-xs text-[rgb(var(--mg-muted))]">{note}</span>}
                    <span className="mg-display text-[17px] font-bold leading-none text-[rgb(var(--mg-heading))]">{pounds(listing.priceMinor)}</span>
                  </span>
                  {soldOut ? <RefineStatus tone="warn">Sold out</RefineStatus>
                    : <RefineQty name={listing.title} value={quantity} max={listing.stockQuantity ?? 99} onChange={(next) => changeQuantity(listing, next)} />}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <section className="mg-sec" aria-label="Tack and equipment for sale">
        <div className="mg-sec-head"><h2>Tack and equipment for sale</h2></div>
        <ShopClassifieds intro="Posts from other Pony Clubbers. Agree a price with the seller and collect it at the event." />
      </section>
      {basketLines.length > 0 && (
        <div role="region" aria-label="Basket summary" className="mg-basket-bar">
          <span className="flex flex-1 flex-col gap-0.5"><span className="text-xs text-[rgb(var(--mg-header-sub))]">{itemsText(basketCount)}</span><strong className="mg-display text-[22px] font-bold leading-none">{pounds(estimatedTotal)}</strong></span>
          <button type="button" className="inline-flex min-h-11 items-center rounded-lg bg-[rgb(var(--mg-red))] px-5 text-[15px] font-bold text-white" onClick={() => setView('basket')}>Review order</button>
        </div>
      )}
    </div>
  );
}

/** The app header for the product list: back to the shop, with the event and its date underneath. */
function ShopHeader() {
  const { competition } = useCompetition();
  const start = new Date(competition.startDate);
  const when = Number.isNaN(start.getTime()) ? '' : start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  usePageHeader({ title: 'Event shop', subtitle: [competition.name, when].filter(Boolean).join(' · '), plain: true, backTo: '/shop', backLabel: 'Back to shop' });
  return null;
}

function OrderLines({ order }: { order: EventOrder }) {
  return (
    <>
      <RefineList label="Order summary">
        {order.lines.map((line) => (
          <li key={line.id} className="rf-row" style={{ minHeight: 48 }}>
            <span className="rf-grow">{line.title} × {line.quantity}</span>
            <span className="rf-price">{pounds(line.lineTotalMinor)}</span>
          </li>
        ))}
      </RefineList>
      <div className="rf-sum rf-sum-total -mx-4"><span>Total</span><span>{pounds(order.totalMinor)}</span></div>
    </>
  );
}

/** What follows a demo payment: confirmed, declined or cancelled. The order may already exist, so the wording follows its real state. */
function ShopOutcome({ order, payment, retry, onShop }: { order: EventOrder; payment: TestPayment; retry: () => void; onShop: () => void }) {
  if (payment.status === 0) {
    return (
      <>
        <OutcomeState payment={payment} title={`Order #${order.id}`} detail={`Paid ${pounds(payment.amountMinor)} · ${clock(payment.createdAt)}`} />
        <OrderLines order={order} />
        <RefineNote>{COLLECT_NOTE} Show your order number when you collect.</RefineNote>
        <RefineFoot>
          <button type="button" className="rf-btn" onClick={onShop}>Shop</button>
          <Link className="rf-btn rf-btn-primary rf-grow" to={`/me/orders?order=${order.id}`}>View receipt</Link>
        </RefineFoot>
      </>
    );
  }
  if (payment.status === 1) {
    return (
      <>
        <OutcomeState payment={payment} detail={`Nothing was charged. Order #${order.id} is waiting for payment.`} />
        <RefineFoot column>
          <button type="button" className="rf-btn rf-btn-primary" onClick={retry}>Try again</button>
          <button type="button" className="rf-btn rf-btn-text" onClick={onShop}>Back to shop</button>
        </RefineFoot>
      </>
    );
  }
  return (
    <>
      <OutcomeState payment={payment} title="Payment cancelled" detail={`Order #${order.id} was cancelled and nothing was charged. Your basket is kept.`} />
      <RefineFoot>
        <button type="button" className="rf-btn rf-btn-primary rf-wide" onClick={onShop}>Back to shop</button>
      </RefineFoot>
    </>
  );
}

type OrderCheckoutProps = { order: EventOrder; onChanged: (order: EventOrder) => void } & Partial<Pick<
  ComponentProps<typeof DemoPaymentFlow>,
  'variant' | 'context' | 'onBack' | 'backLabel' | 'approvedTitle' | 'resultContext' | 'renderResult' | 'minProcessingMs'
>>;

export function DemoOrderCheckout({ order, onChanged, ...flow }: OrderCheckoutProps) {
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
      {...flow}
    />
  );
}
