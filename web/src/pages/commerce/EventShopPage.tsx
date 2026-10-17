import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown, Minus, Plus, ShoppingBag } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCompetition } from '../competition/context';
import { LoadError, StatusPill } from './commerceUi';
import { CATEGORY_LABEL, errorMessage, newIdempotencyKey, pounds } from './commerceFormat';
import { DemoPaymentFlow } from './DemoPaymentFlow';
import type { CommerceItemCategory, DemoOrderPaymentResult, EventCommerceSettings, EventOrder, FakePaymentOutcome, PublicCompetitionListing, TestPayment } from './types';
import './commerce.css';

type Filter = 'all' | CommerceItemCategory;
const SHOP_FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  ...([1, 2, 0, 3] as CommerceItemCategory[]).map((category) => ({ value: category, label: CATEGORY_LABEL[category] })),
];

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
  const [basketOpen, setBasketOpen] = useState(false);
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
  const basketCount = basketLines.reduce((total, line) => total + line.quantity, 0);

  function changeQuantity(listing: PublicCompetitionListing, delta: number) {
    if (busy) return;
    orderAttempt.current = null;
    const next = Math.max(0, Math.min(listing.stockQuantity ?? 99, (basket[listing.id] ?? 0) + delta));
    const nextBasket = { ...basket, [listing.id]: next };
    setBasket(nextBasket);
    if (basketOpen && Object.values(nextBasket).every((quantity) => quantity === 0)) setBasketOpen(false);
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

  function moveFilterFocus(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabList = event.currentTarget.closest('[role="tablist"]');
    if (!tabList) return;
    const tabs = Array.from(tabList.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const current = tabs.indexOf(event.currentTarget);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next]?.focus();
    tabs[next]?.click();
  }

  if (order) {
    return (
      <div className="skin commerce-page mx-auto w-full max-w-3xl pb-6">
        <button type="button" className="commerce-back" onClick={() => { setOrder(null); setBasketOpen(false); }}>
          <ArrowLeft className="h-4 w-4" /> Back to shop
        </button>
        <header className="commerce-title-block">
          <p className="mg-eyebrow">Order placed</p>
          <h1 className="mg-h1">Order #{order.id}</h1>
          <p className="mg-lede">Your confirmed total is <strong>{pounds(order.totalMinor)}</strong>.</p>
        </header>
        <OrderSummary order={order} />
        {order.isTestOrder ? (
          <DemoOrderCheckout order={order} onChanged={setOrder} />
        ) : (
          <p className="mg-notice">Pay the organiser using their usual payment details. They’ll mark the order paid when it arrives.</p>
        )}
      </div>
    );
  }

  if (basketOpen) {
    return (
      <div className="skin commerce-page mx-auto w-full max-w-3xl pb-6">
        <button type="button" className="commerce-back" disabled={busy} onClick={() => setBasketOpen(false)}>
          <ArrowLeft className="h-4 w-4" /> Back to shop
        </button>
        <header className="commerce-title-block">
          <p className="mg-eyebrow">{competition.name}</p>
          <h1 className="mg-h1">Your basket</h1>
          <p className="mg-lede">Check quantities before placing your order.</p>
        </header>
        {error && <LoadError message={error} onRetry={() => void load()} />}
        <section className="commerce-rows" aria-label="Basket items">
          {basketLines.map(({ listing, quantity }) => (
            <article key={listing.id} className="commerce-basket-line">
              <div className="min-w-0 flex-1">
                <h2 className="commerce-row-title">{listing.title}</h2>
                <p className="mg-meta">{pounds(listing.priceMinor)} each</p>
              </div>
              <QuantityControl listing={listing} quantity={quantity} disabled={busy} onChange={changeQuantity} />
              <strong className="w-20 text-right">{pounds(listing.priceMinor * quantity)}</strong>
            </article>
          ))}
        </section>
        <section className="commerce-total" aria-label="Order total">
          <div><span>Total</span><strong>{pounds(estimatedTotal)}</strong></div>
          <p>Your total is confirmed when you place the order. Collect everything at the event.</p>
        </section>
        {user ? (
          <button type="button" className="mg-btn mg-btn-primary w-full" disabled={busy || basketLines.length === 0} onClick={() => void checkout()}>
            {busy ? 'Placing order…' : settings?.isDemo ? 'Create demo order' : 'Place order'}
          </button>
        ) : (
          <Link className="mg-btn mg-btn-primary w-full" to="/login">Sign in to order</Link>
        )}
      </div>
    );
  }

  return (
    <div className={`skin commerce-page mx-auto w-full max-w-3xl ${basketLines.length > 0 ? 'commerce-page--with-basket' : ''}`}>
      <header className="commerce-title-block">
        <p className="mg-eyebrow">{competition.name}</p>
        <h1 className="mg-h1">Event shop</h1>
        <p className="mg-lede">Listings approved by the organiser. Collect at the event.</p>
      </header>

      <div role="tablist" aria-label="Shop categories" className="commerce-category-tabs">
        {SHOP_FILTERS.map(({ value, label }) => (
          <button
            key={value}
            id={`shop-filter-${value}`}
            type="button"
            role="tab"
            aria-controls="shop-products"
            aria-selected={filter === value}
            tabIndex={filter === value ? 0 : -1}
            onClick={() => setFilter(value)}
            onKeyDown={moveFilterFocus}
          >
            {label}
          </button>
        ))}
      </div>

      <div id="shop-products" role="tabpanel" aria-labelledby={`shop-filter-${filter}`}>
        {error && <LoadError message={error} onRetry={() => void load()} />}
        {listings == null && !error && <p role="status" className="mg-card p-4 text-[rgb(var(--mg-muted))]">Loading the shop…</p>}
        {listings && listings.length === 0 && <p className="mg-card p-5">There’s nothing in the event shop yet.</p>}
        {listings && listings.length > 0 && visible.length === 0 && <p className="mg-card p-5">There’s nothing in this category yet.</p>}

        {visible.length > 0 && (
          <section className="commerce-rows" aria-label="Products">
            {visible.map((listing) => {
              const quantity = basket[listing.id] ?? 0;
              const soldOut = listing.stockQuantity === 0;
              return (
                <article key={listing.id} className="commerce-product-row">
                  {listing.imageUrl
                    ? <img src={listing.imageUrl} alt="" className="commerce-product-image" />
                    : <div className="commerce-product-image commerce-product-image--empty" aria-hidden="true"><ShoppingBag className="h-5 w-5" /></div>}
                  <div className="min-w-0 flex-1">
                    <p className="commerce-row-kicker">{CATEGORY_LABEL[listing.category]}</p>
                    <ProductDetails listing={listing} />
                  </div>
                  <div className="commerce-product-action">
                    <strong>{pounds(listing.priceMinor)}</strong>
                    {soldOut ? <StatusPill tone="warn">Sold out</StatusPill> : quantity === 0 ? (
                      <button type="button" className="commerce-add" aria-label={`Add ${listing.title}`} onClick={() => changeQuantity(listing, 1)}>Add</button>
                    ) : <QuantityControl listing={listing} quantity={quantity} onChange={changeQuantity} />}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>

      {basketLines.length > 0 && <BasketBar count={basketCount} total={estimatedTotal} onOpen={() => setBasketOpen(true)} />}
    </div>
  );
}

function ProductDetails({ listing }: { listing: PublicCompetitionListing }) {
  const [expanded, setExpanded] = useState(false);
  const descriptionId = `shop-product-description-${listing.id}`;
  return (
    <div>
      <h2 className="commerce-row-title">
        <button type="button" aria-expanded={expanded} aria-controls={descriptionId} onClick={() => setExpanded((current) => !current)}>
          <span>{listing.title}</span>
          <ChevronDown aria-hidden="true" className="h-4 w-4" />
        </button>
      </h2>
      <p id={descriptionId} className={`commerce-row-description ${expanded ? 'commerce-row-description--expanded' : ''}`}>{listing.description}</p>
    </div>
  );
}

function QuantityControl({
  listing, quantity, disabled = false, onChange,
}: {
  listing: PublicCompetitionListing;
  quantity: number;
  disabled?: boolean;
  onChange: (listing: PublicCompetitionListing, delta: number) => void;
}) {
  return (
    <div className="commerce-quantity" aria-label={`Quantity for ${listing.title}`}>
      <button type="button" aria-label={`Remove one ${listing.title}`} disabled={disabled} onClick={() => onChange(listing, -1)}><Minus className="h-4 w-4" /></button>
      <output aria-live="polite">{quantity}</output>
      <button type="button" aria-label={`Add one ${listing.title}`} disabled={disabled || quantity >= (listing.stockQuantity ?? 99)} onClick={() => onChange(listing, 1)}><Plus className="h-4 w-4" /></button>
    </div>
  );
}

function BasketBar({ count, total, onOpen }: { count: number; total: number; onOpen: () => void }) {
  return (
    <aside className="commerce-basket-bar" aria-label="Basket summary">
      <div className="min-w-0 flex-1">
        <p>{count} {count === 1 ? 'item' : 'items'}</p>
        <strong>{pounds(total)}</strong>
      </div>
      <button type="button" onClick={onOpen}>View basket <ShoppingBag className="h-4 w-4" /></button>
    </aside>
  );
}

function OrderSummary({ order }: { order: EventOrder }) {
  return (
    <section className="commerce-rows" aria-label="Order summary">
      {order.lines.map((line) => (
        <div key={line.id} className="commerce-basket-line">
          <span className="flex-1">{line.title} × {line.quantity}</span>
          <strong>{pounds(line.lineTotalMinor)}</strong>
        </div>
      ))}
    </section>
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
