import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Link } from 'react-router-dom';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { Notice } from '../../components/Notice';
import { RoundStepper } from '../../components/RoundStepper';
import { feeText } from '../../lib/entryOptions';
import { allOptionsSoldOut, hasOptions, isSoldOut, listingTotal, maxQuantity, optionsOf, orderLines, parseBasketKey, quantityIn, setQuantity, upgradeBasket, type OptionBasket } from '../../lib/shopOptions';
import { usePageWidth } from '../../components/pageWidthState';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCompetition } from '../competition/context';
import { RefineFoot, RefineHeader, RefineList, RefineNote, RefinePage, RefineStatus } from '../refine/Refine';
import { LoadError } from './commerceUi';
import { CATEGORY_LABEL, errorMessage, newIdempotencyKey, orderLineText, pounds } from './commerceFormat';
import { DemoPaymentFlow, OutcomeState } from './DemoPaymentFlow';
import type { CommerceItemCategory, DemoOrderPaymentResult, EventCommerceSettings, EventOrder, FakePaymentOutcome, PublicCompetitionListing, TestPayment } from './types';
import './commerce.css';
import '../../components/sitePages.css';
import '../../components/eventPages.css';

/** Camping and stabling first, then kit, tickets and the rest. */
const SHOP_ORDER: CommerceItemCategory[] = [2, 0, 1, 3];

const COLLECT_NOTE = 'Collect at the event.';

export function EventShopPage() {
  const { competition } = useCompetition();
  const { user } = useAuth();
  return <EventShopContent key={`${competition.id}:${user?.id ?? 'signed-out'}`} />;
}

type View = 'shop' | 'payment' | 'placed';

const itemsText = (count: number) => `${count} ${count === 1 ? 'item' : 'items'}`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function EventShopContent() {
  usePageWidth('narrow');
  const { competition } = useCompetition();
  const { user } = useAuth();
  const [listings, setListings] = useState<PublicCompetitionListing[] | null>(null);
  const [settings, setSettings] = useState<EventCommerceSettings | null>(null);
  const [basket, setBasket] = useState<OptionBasket>({});
  // The option pill chosen on each item that has options, by listing id.
  const [picked, setPicked] = useState<Record<number, number>>({});
  // What an item asks for once it is in the order (a stable number, a number plate), by listing.
  const [details, setDetails] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<EventOrder | null>(null);
  const [view, setView] = useState<View>('shop');
  const orderAttempt = useRef<{ basketSignature: string; idempotencyKey: string } | null>(null);
  // The order button at the foot of the list; the sticky basket bar scrolls to it and steps aside while it is on screen.
  const orderButton = useRef<HTMLElement | null>(null);
  const [orderVisible, setOrderVisible] = useState(false);

  const load = useCallback(() =>
    Promise.all([
      api.get<PublicCompetitionListing[]>(`/commerce/competitions/${competition.id}/listings`),
      api.get<EventCommerceSettings>(`/commerce/competitions/${competition.id}/settings`),
    ])
      .then(([listingResponse, settingsResponse]) => {
        setError(null);
        setListings(listingResponse.data);
        // Keep what is in the basket only where the shop still offers it, and no more than is left.
        setBasket((current) => upgradeBasket(current, listingResponse.data));
        setSettings(settingsResponse.data);
      })
      .catch((requestError: unknown) => {
        setError(errorMessage(requestError, 'Couldn’t load the event shop. Check your signal and try again.'));
      }), [competition.id]);

  useEffect(() => { void load(); }, [load]);

  const basketLines = useMemo(() => Object.entries(basket).flatMap(([key, quantity]) => {
    const parsed = parseBasketKey(key);
    const listing = parsed && (listings ?? []).find((l) => l.id === parsed.listingId);
    return listing && quantity > 0 ? [{ listing, optionId: parsed.optionId, quantity }] : [];
  }), [basket, listings]);
  const estimatedTotal = basketLines.reduce((total, line) => total + line.listing.priceMinor * line.quantity, 0);
  const basketCount = basketLines.reduce((total, line) => total + line.quantity, 0);
  const isDemo = settings?.isDemo ?? false;
  const hasBasket = basketLines.length > 0;

  useEffect(() => {
    const target = orderButton.current;
    if (!hasBasket || !target || typeof IntersectionObserver === 'undefined') return;
    const watcher = new IntersectionObserver(([entry]) => setOrderVisible(entry.isIntersecting));
    watcher.observe(target);
    return () => { watcher.disconnect(); setOrderVisible(false); };
  }, [hasBasket, view]);

  function showOrderButton() {
    const target = orderButton.current;
    if (!target) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.lite === 'true';
    target.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
    target.focus({ preventScroll: true });
  }

  function changeQuantity(listing: PublicCompetitionListing, optionId: number | null, next: number) {
    if (busy) return;
    orderAttempt.current = null;
    setBasket(setQuantity(basket, listing, optionId, next));
  }

  function changeDetail(listingId: number, value: string) {
    orderAttempt.current = null;
    setDetails((current) => ({ ...current, [listingId]: value }));
  }

  /** Places the order. A repeat of the same basket reuses its key, so the server returns the same order. */
  async function checkout() {
    if (!user || basketLines.length === 0) return;
    const detailFor = (listing: PublicCompetitionListing) => (listing.detailPrompt ? details[listing.id]?.trim() ?? '' : '');
    const detailsByListing: Record<number, string> = {};
    for (const { listing } of basketLines) detailsByListing[listing.id] = detailFor(listing);
    const lines = orderLines(basket, detailsByListing);
    const basketSignature = `${competition.id}|${lines
      .map((line) => `${line.listingId}:${line.optionId ?? ''}:${line.quantity}:${line.detail ?? ''}`)
      .join('|')}`;
    if (orderAttempt.current?.basketSignature !== basketSignature) {
      orderAttempt.current = { basketSignature, idempotencyKey: newIdempotencyKey('event-order') };
    }
    setBusy(true);
    setOrderError(null);
    try {
      const { data } = await api.post<EventOrder>(`/commerce/competitions/${competition.id}/orders`, {
        idempotencyKey: orderAttempt.current.idempotencyKey,
        items: lines,
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
      setOrderError(errorMessage(requestError, 'Couldn’t place your order. Check the basket and try again.'));
    } finally {
      setBusy(false);
    }
  }

  function backToShop() {
    setView('shop');
    setOrder(null);
    setError(null);
    setOrderError(null);
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
        onBack={() => setView('shop')}
        backLabel="Back to shop"
        approvedTitle="Order confirmed"
        resultContext={competition.name}
        renderResult={({ payment, retry }) => <ShopOutcome order={order} payment={payment} retry={retry} onShop={backToShop} />}
      />
    );
  }

  const groups = SHOP_ORDER
    .map((category) => ({ category, items: (listings ?? []).filter((listing) => listing.category === category) }))
    .filter((group) => group.items.length > 0);
  const orderLabel = `Order: ${feeText(estimatedTotal)}`;
  return (
    <div className={`rf-page mx-auto flex w-full max-w-xl flex-col pt-3 ${hasBasket ? 'pb-24' : 'pb-2'}`}>
      <ShopHeader />
      <div className="sp-seg" role="navigation" aria-label="Shop switcher">
        <Link to={`/competitions/${competition.id}/shop`} aria-current="page">Event shop</Link>
        <Link to="/shop">Tack &amp; kit classifieds</Link>
      </div>
      {error && <div className="mt-3"><LoadError message={error} onRetry={() => void load()} /></div>}
      {listings == null && !error && <p role="status" className="sp-note">Loading the shop…</p>}
      {listings && listings.length === 0 && <p className="sp-note">There’s nothing in the event shop yet.</p>}
      {groups.map(({ category, items }) => (
        <section key={category} aria-label={CATEGORY_LABEL[category]}>
          <h2 className="sp-sec">{CATEGORY_LABEL[category]}</h2>
          <ul className="sp-card m-0 list-none p-0" aria-label={`${CATEGORY_LABEL[category]} for sale`}>
            {items.map((listing) => {
              const withOptions = hasOptions(listing);
              const quantity = withOptions ? listingTotal(basket, listing.id) : quantityIn(basket, listing.id, null);
              const soldOut = listing.stockQuantity === 0 || allOptionsSoldOut(listing);
              const note = [listing.description, listing.stockQuantity != null && !soldOut ? `${listing.stockQuantity} left` : null].filter(Boolean).join(' · ');
              return (
                <li key={listing.id}>
                  <div className="sp-row">
                    <span className="sp-grow">
                      <span className="sp-t1">{listing.title}</span>
                      <span className="sp-t2">{feeText(listing.priceMinor)}{note ? ` · ${note}` : ''}</span>
                    </span>
                    {soldOut ? <RefineStatus tone="warn">Sold out</RefineStatus>
                      : !withOptions && <RoundStepper name={listing.title} value={quantity} max={maxQuantity(listing, null, basket)} disabled={busy} onChange={(next) => changeQuantity(listing, null, next)} />}
                  </div>
                  {withOptions && !soldOut && (
                    <OptionPicker listing={listing} basket={basket} picked={picked[listing.id] ?? null} disabled={busy}
                      onPick={(optionId) => setPicked((current) => ({ ...current, [listing.id]: optionId }))}
                      onChange={(optionId, next) => changeQuantity(listing, optionId, next)} />
                  )}
                  {quantity > 0 && listing.detailPrompt && (
                    <div className="px-4 pb-3.5">
                      <label className="rf-fld">{listing.detailPrompt}
                        <input type="text" maxLength={80} placeholder={listing.detailHint ?? ''} value={details[listing.id] ?? ''} disabled={busy}
                          onChange={(event) => changeDetail(listing.id, event.target.value)} />
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {hasBasket && (user ? (
        <button type="button" ref={(node) => { orderButton.current = node; }} className="ev-bar" disabled={busy} onClick={() => void checkout()}>{busy ? 'Placing order…' : orderLabel}</button>
      ) : (
        <Link ref={(node) => { orderButton.current = node; }} className="ev-bar" to="/login" state={{ from: `/competitions/${competition.id}/shop` }}>Sign in to order</Link>
      ))}
      {orderError && <div className="mt-3"><Notice actionLabel="Try again" onAction={() => void checkout()} actionDisabled={busy}>{orderError}</Notice></div>}
      {isDemo && hasBasket && <p className="sp-note">This is a demo event. Next you will see a test payment page, and no money is taken.</p>}
      {user && <div className="pt-1"><Link className="ev-text-btn" to="/me/orders">Your orders</Link></div>}
      <p className="sp-note">MG App connects buyers with independent sellers; your purchase contract is directly with the seller listed on each item.</p>
      {hasBasket && !orderVisible && (
        <div className="shop-basket-bar" role="region" aria-label="Your basket">
          <span className="shop-basket-text">
            <span className="shop-basket-count">{itemsText(basketCount)}</span>
            <span className="shop-basket-total">{feeText(estimatedTotal)}</span>
          </span>
          <button type="button" className="kit-pill kit-pill-fill" onClick={showOrderButton}>Checkout</button>
        </div>
      )}
    </div>
  );
}

/** An item's options as pills, one row that wraps, with a stepper for whichever one is chosen. */
function OptionPicker({ listing, basket, picked, disabled, onPick, onChange }: {
  listing: PublicCompetitionListing;
  basket: OptionBasket;
  picked: number | null;
  disabled: boolean;
  onPick: (optionId: number) => void;
  onChange: (optionId: number, next: number) => void;
}) {
  const options = optionsOf(listing);
  const chosen = options.find((option) => option.id === picked && !isSoldOut(option)) ?? null;
  return (
    <div className="shop-opts-wrap">
      <div className="shop-opts" role="radiogroup" aria-label={`Options for ${listing.title}`}>
        {options.map((option) => {
          const soldOut = isSoldOut(option);
          const inBasket = quantityIn(basket, listing.id, option.id);
          const name = soldOut ? `${option.label}, sold out` : inBasket > 0 ? `${option.label}, ${inBasket} in basket` : option.label;
          return (
            <button key={option.id} type="button" role="radio" aria-checked={chosen?.id === option.id} aria-label={name} disabled={soldOut || disabled}
              className="shop-opt" data-sold-out={soldOut ? 'true' : undefined} onClick={() => onPick(option.id)}>
              {option.label}
              {inBasket > 0 && <span className="shop-opt-n" aria-hidden="true">{inBasket}</span>}
            </button>
          );
        })}
      </div>
      {chosen ? (
        <div className="shop-opt-step">
          <span className="sp-t2">{chosen.label}{chosen.stockQuantity != null ? ` · ${chosen.stockQuantity} left` : ''}</span>
          <RoundStepper name={`${listing.title} ${chosen.label}`} value={quantityIn(basket, listing.id, chosen.id)} max={maxQuantity(listing, chosen.id, basket)}
            disabled={disabled} onChange={(next) => onChange(chosen.id, next)} />
        </div>
      ) : <p className="sp-t2 shop-opt-hint">Choose an option to add it.</p>}
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
            <span className="rf-grow">{orderLineText(line)}</span>
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
