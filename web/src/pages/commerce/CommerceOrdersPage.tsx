import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Sheet } from '../../components/Sheet';
import { downloadCsv, toCsv } from '../../lib/csv';
import { RefineFoot } from '../refine/Refine';
import { Chip, type ChipTone } from '../clubShop/ui';
import { LoadError, TestReceipt } from './commerceUi';
import { lineTitle } from '../../lib/shopOptions';
import { errorMessage, newIdempotencyKey, orderLineText, pounds } from './commerceFormat';
import { OutcomeState } from './DemoPaymentFlow';
import { DemoOrderCheckout } from './EventShopPage';
import type { CommerceOrderStatus, DemoOrderPaymentResult, EventOrder, EventOrderLine, SellerSale, TestPayment } from './types';
import './commerce.css';
import '../../components/sitePages.css';
import '../clubShop/clubShop.css';

type View = 'bought' | 'sold';

/** The word shown for an order: what the buyer needs to do or what happened. Colour only reinforces it. */
const STATUS: Record<CommerceOrderStatus, { text: string; tone: ChipTone }> = {
  0: { text: 'Pay the organiser', tone: 'warn' },
  1: { text: 'Payment due', tone: 'warn' },
  2: { text: 'Paid', tone: 'good' },
  3: { text: 'Declined', tone: 'bad' },
  4: { text: 'Cancelled', tone: 'grey' },
  5: { text: 'Refunded', tone: 'grey' },
};

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const whenText = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const linesText = (lines: EventOrderLine[]) => lines.map(orderLineText).join(', ');
const eventName = (name: string | null | undefined) => name || 'Event order';

export function CommerceOrdersPage() {
  const { user } = useAuth();
  return <CommerceOrdersContent key={user?.id ?? 'signed-out'} />;
}

function CommerceOrdersContent() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>('bought');
  const [orders, setOrders] = useState<EventOrder[] | null>(null);
  const [sales, setSales] = useState<SellerSale[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [paying, setPaying] = useState(false);
  const refundAttempts = useRef(new Map<number, string>());
  const openId = Number(params.get('order')) || null;
  usePageHeader({ title: 'Orders and sales', plain: true, backTo: '/me', backLabel: 'Back to my profile' });

  const load = useCallback(() => {
    if (!user) return Promise.resolve();
    return Promise.all([
      api.get<EventOrder[]>('/commerce/orders/mine'),
      api.get<SellerSale[]>('/commerce/sales/mine'),
    ])
      .then(([ordersResponse, salesResponse]) => {
        setError(null);
        setOrders(ordersResponse.data);
        setSales(salesResponse.data);
      })
      .catch((requestError: unknown) => {
        setError(errorMessage(requestError, 'Couldn’t load your orders. Check your signal and try again.'));
      });
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  function open(id: number | null) {
    setPaying(false);
    setParams(id == null ? {} : { order: String(id) }, { replace: false });
  }

  // The answer to a payment or refund doesn't repeat the event's name, so keep the one already shown.
  const replaceOrder = (next: EventOrder) => setOrders((current) => current?.map((existing) => existing.id === next.id
    ? { ...next, competitionName: next.competitionName ?? existing.competitionName }
    : existing) ?? null);

  async function cancel(order: EventOrder): Promise<boolean> {
    if (!(await confirmDialog({ title: 'Cancel this order?', message: `Order ${order.id} is cancelled and the items go back on sale.`, confirmLabel: 'Cancel order', cancelLabel: 'Keep order', destructive: true }))) return false;
    setBusyId(order.id);
    setError(null);
    try {
      await api.post(`/commerce/orders/${order.id}/cancel`);
      await load();
      return true;
    } catch (requestError) {
      setError(errorMessage(requestError, 'Couldn’t cancel the order. Check your signal and try again.'));
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function refund(order: EventOrder): Promise<boolean> {
    if (!(await confirmDialog({ title: `Refund ${pounds(order.totalMinor)}?`, message: `Refunds the whole of order ${order.id}. It’s a demo, so no money moves. The order shows as Refunded.`, confirmLabel: `Refund ${pounds(order.totalMinor)}`, cancelLabel: 'Keep order', destructive: true }))) return false;
    const idempotencyKey = refundAttempts.current.get(order.id) ?? newIdempotencyKey(`demo-refund-${order.id}`);
    refundAttempts.current.set(order.id, idempotencyKey);
    setBusyId(order.id);
    setError(null);
    try {
      const { data } = await api.post<DemoOrderPaymentResult>(`/commerce/orders/${order.id}/demo-refund`, { idempotencyKey, outcome: 0 });
      refundAttempts.current.delete(order.id);
      replaceOrder(data.order);
      return true;
    } catch (requestError) {
      setError(errorMessage(requestError, 'Couldn’t run the test refund. Check your signal and try again.'));
      return false;
    } finally {
      setBusyId(null);
    }
  }

  if (!user) return <div className="skin cs-page"><p className="sp-note">Sign in to see your orders and sales. <Link to="/login">Sign in</Link></p></div>;

  const current = openId != null ? orders?.find((order) => order.id === openId) ?? null : null;

  if (current && paying) {
    return (
      <DemoOrderCheckout
        order={current}
        onChanged={replaceOrder}
        variant="page"
        context={`Order ${current.id} · ${pounds(current.totalMinor)}`}
        onBack={() => setPaying(false)}
        backLabel="Back to order"
        approvedTitle="Payment approved"
        resultContext={`Order ${current.id}`}
        renderResult={({ payment, retry }) => (
          <>
            <OutcomeState payment={payment} />
            <RefineFoot column>
              {payment.status === 1 && <button type="button" className="rf-btn rf-btn-primary" onClick={retry}>Try again</button>}
              <button type="button" className={`rf-btn ${payment.status === 1 ? 'rf-btn-text' : 'rf-btn-primary'}`} onClick={() => setPaying(false)}>Back to order</button>
            </RefineFoot>
          </>
        )}
      />
    );
  }

  const demoOrders = orders?.filter((order) => order.isTestOrder) ?? [];
  const realOrders = orders?.filter((order) => !order.isTestOrder) ?? [];
  return (
    <div className="skin cs-page">
      <h1 className="sr-only">Orders and sales</h1>
      <div className="sp-seg" role="tablist" aria-label="Orders">
        <button type="button" role="tab" aria-selected={view === 'bought'} onClick={() => setView('bought')}>Bought</button>
        <button type="button" role="tab" aria-selected={view === 'sold'} onClick={() => setView('sold')}>Sold</button>
      </div>
      {error && <div className="cs-gap"><LoadError message={error} onRetry={() => void load()} /></div>}

      {view === 'bought' ? (
        orders == null ? <p role="status" className="sp-note">Loading your orders…</p>
          : orders.length === 0 ? <p className="sp-note">You haven’t bought anything yet.</p>
            : (
              <>
                {realOrders.length > 0 && <OrderGroup title="Your orders" orders={realOrders} onOpen={open} />}
                {demoOrders.length > 0 && <OrderGroup title="Demo orders" meta="Test payments only" orders={demoOrders} onOpen={open} />}
                {realOrders.length > 0 && <p className="sp-note">Pay the organiser directly. They mark the order paid when the money arrives. Collect at the event.</p>}
              </>
            )
      ) : (
        <SalesList sales={sales} />
      )}

      {current && (
        <OrderSheet
          order={current}
          busy={busyId === current.id}
          onClose={() => open(null)}
          onPay={() => setPaying(true)}
          onCancel={() => cancel(current)}
          onRefund={() => refund(current)}
        />
      )}
    </div>
  );
}

function OrderGroup({ title, meta, orders, onOpen }: { title: string; meta?: string; orders: EventOrder[]; onOpen: (id: number) => void }) {
  return (
    <section aria-label={title}>
      <h2 className="sp-sec">{title}{meta && <small>{meta}</small>}</h2>
      <div className="sp-card">
        {orders.map((order) => {
          const status = STATUS[order.status];
          return (
            <button key={order.id} type="button" className="sp-row" onClick={() => onOpen(order.id)}>
              <span className="sp-grow">
                <span className="sp-t1">{eventName(order.competitionName)}</span>
                <span className="sp-t2">Order {order.id} · {shortDate(order.createdAt)} · {linesText(order.lines)}</span>
              </span>
              <span className="cs-right"><span className="sp-price !text-[18px]">{pounds(order.totalMinor)}</span><Chip tone={status.tone}>{status.text}</Chip></span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

const STABLING_LINE_PATTERN = /stabl|hook[\s-]*up|shaving|haylage|bedding|bale|camping|pitch|corral|lorry/i;

function SalesList({ sales }: { sales: SellerSale[] | null }) {
  if (sales == null) return <p role="status" className="sp-note">Loading your sales…</p>;

  // Demo orders move no money, so they stay out of the totals.
  const real = sales.filter((sale) => !sale.isTestOrder);
  const sum = (statuses: CommerceOrderStatus[]) => real.filter((s) => statuses.includes(s.status)).reduce((total, s) => total + s.sellerTotalMinor, 0);

  function exportTreasurerCsv() {
    const header = ['Order ID', 'Date', 'Item', 'Category', 'Quantity', 'Detail', 'Status', 'Test order', 'Amount (GBP)'];
    const rows: ReadonlyArray<unknown>[] = [];
    for (const sale of sales ?? []) {
      const statusText = STATUS[sale.status]?.text ?? String(sale.status);
      if (sale.lines.length === 0) {
        rows.push([sale.orderId, sale.createdAt, 'Order total', 'Other items', 1, '', statusText, sale.isTestOrder ? 'Yes' : 'No', (sale.sellerTotalMinor / 100).toFixed(2)]);
      } else {
        for (const line of sale.lines) {
          const category = STABLING_LINE_PATTERN.test(line.title) ? 'Stabling & Hook-up' : 'Other items';
          rows.push([sale.orderId, sale.createdAt, lineTitle(line), category, line.quantity, line.detail ?? '', statusText, sale.isTestOrder ? 'Yes' : 'No', (line.lineTotalMinor / 100).toFixed(2)]);
        }
      }
    }
    downloadCsv('treasurer-reconciliation.csv', toCsv(header, rows));
  }

  return (
    <>
      <div className="cs-tiles">
        <div className="cs-tile"><strong>{pounds(sum([2]))}</strong><span>Paid</span></div>
        <div className="cs-tile"><strong>{pounds(sum([0, 1]))}</strong><span>Not paid yet</span></div>
        <div className="cs-tile"><strong>{pounds(sum([5]))}</strong><span>Refunded</span></div>
      </div>

      {sales.length === 0 ? (
        <p className="sp-note">You haven’t sold anything yet.</p>
      ) : (
        <>
          <h2 className="sp-sec">Sales <small>Collect at the event</small></h2>
          <div className="sp-card">
            {sales.map((sale) => {
              const status = STATUS[sale.status];
              return (
                <div key={sale.orderId} className="cs-row">
                  <span className="sp-grow">
                    <span className="sp-t1">{eventName(sale.competitionName)}</span>
                    <span className="sp-t2">Order {sale.orderId}{sale.isTestOrder && ' · demo'} · {linesText(sale.lines)}</span>
                  </span>
                  <span className="cs-right"><span className="sp-price !text-[18px]">{pounds(sale.sellerTotalMinor)}</span><Chip tone={status.tone}>{status.text}</Chip></span>
                </div>
              );
            })}
          </div>
          <div className="kit-acts cs-gap">
            <button type="button" className="kit-pill cs-pill-s" onClick={exportTreasurerCsv}>Download for the treasurer (CSV)</button>
          </div>
        </>
      )}
    </>
  );
}

/** One order in a sheet: the details, then what the buyer can do with it. */
function OrderSheet({ order, busy, onClose, onPay, onCancel, onRefund }: {
  order: EventOrder;
  busy: boolean;
  onClose: () => void;
  onPay: () => void;
  onCancel: () => Promise<boolean>;
  onRefund: () => Promise<boolean>;
}) {
  const status = STATUS[order.status];
  const payment: TestPayment | undefined = [...order.testPayments].reverse().find((candidate) => candidate.isTest);
  const canPay = order.isTestOrder && (order.status === 1 || order.status === 3);
  const canCancel = [0, 1, 3].includes(order.status);
  const canRefund = order.isTestOrder && order.status === 2;
  const when = order.paidAt ?? order.refundedAt ?? order.cancelledAt ?? order.createdAt;
  return (
    <Sheet title={`Order ${order.id}${order.isTestOrder ? ' (demo)' : ''}`} onClose={onClose}>
      {({ close }) => (
        <>
          <dl className="cs-sheet-facts">
            <div><dt>Event</dt><dd>{eventName(order.competitionName)}</dd></div>
            <div><dt>Status</dt><dd>{status.text}</dd></div>
            <div><dt>When</dt><dd>{whenText(when)}</dd></div>
            {order.lines.map((line) => <div key={line.id}><dt>{orderLineText(line)}</dt><dd>{pounds(line.lineTotalMinor)}</dd></div>)}
            <div><dt>Total</dt><dd><strong>{pounds(order.totalMinor)}</strong></dd></div>
          </dl>
          {order.isTestOrder && payment && <TestReceipt payment={payment} />}
          <p className="kit-sheet-text">
            {order.isTestOrder ? 'A demo order: no money moved. ' : order.status === 0 ? 'Pay the organiser directly. They mark it paid when the money arrives. ' : ''}
            Collect at the event.
          </p>
          <div className="kit-acts">
            {canPay && <button type="button" className="kit-pill kit-pill-fill" onClick={() => close(onPay)}>{order.status === 3 ? 'Retry demo payment' : 'Pay demo order'}</button>}
            <button type="button" className={`kit-pill${canPay ? '' : ' kit-pill-fill'}`} onClick={() => close()}>Done</button>
            {canCancel && <button type="button" className="kit-redtext" disabled={busy} onClick={() => { void onCancel().then((done) => { if (done) close(); }); }}>Cancel order</button>}
            {canRefund && <button type="button" className="kit-redtext" disabled={busy} onClick={() => { void onRefund(); }}>Refund order…</button>}
          </div>
        </>
      )}
    </Sheet>
  );
}

export function LatestTestReceipt({ payments }: { payments: TestPayment[] }) {
  const payment = payments.at(-1);
  return payment ? <TestReceipt payment={payment} /> : null;
}
