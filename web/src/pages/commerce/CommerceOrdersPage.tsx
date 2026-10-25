import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { downloadCsv, toCsv } from '../../lib/csv';
import { RefineDisclosure, RefineFoot, RefineHeader, RefineList, RefineNote, RefinePage, RefineSection, RefineSheet, RefineStatus, type StatusTone } from '../refine/Refine';
import { LoadError, TestReceipt } from './commerceUi';
import { errorMessage, newIdempotencyKey, pounds } from './commerceFormat';
import { OutcomeState } from './DemoPaymentFlow';
import { DemoOrderCheckout } from './EventShopPage';
import type { CommerceOrderStatus, DemoOrderPaymentResult, EventOrder, EventOrderLine, SellerSale, TestPayment } from './types';
import './commerce.css';

type View = 'purchases' | 'sales';

/** The word shown for an order: what the buyer needs to do or what happened. Colour only reinforces it. */
const STATUS: Record<CommerceOrderStatus, { text: string; tone: StatusTone }> = {
  0: { text: 'Pay the organiser', tone: 'warn' },
  1: { text: 'Payment due', tone: 'warn' },
  2: { text: 'Paid', tone: 'ok' },
  3: { text: 'Declined', tone: 'bad' },
  4: { text: 'Cancelled', tone: 'mut' },
  5: { text: 'Refunded', tone: 'mut' },
};

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const whenText = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const lineCount = (lines: EventOrderLine[]) => lines.reduce((total, line) => total + line.quantity, 0);

export function CommerceOrdersPage() {
  const { user } = useAuth();
  return <CommerceOrdersContent key={user?.id ?? 'signed-out'} />;
}

function CommerceOrdersContent() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>('purchases');
  const [orders, setOrders] = useState<EventOrder[] | null>(null);
  const [sales, setSales] = useState<SellerSale[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [paying, setPaying] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const refundAttempts = useRef(new Map<number, string>());
  const openId = Number(params.get('order')) || null;

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
        setError(errorMessage(requestError, 'Couldn’t load your orders.'));
      });
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  function open(id: number | null) {
    setPaying(false);
    setRefundOpen(false);
    setParams(id == null ? {} : { order: String(id) }, { replace: false });
  }

  const replaceOrder = (next: EventOrder) => setOrders((current) => current?.map((existing) => existing.id === next.id ? next : existing) ?? null);

  async function cancel(order: EventOrder) {
    setBusyId(order.id);
    setError(null);
    try {
      await api.post(`/commerce/orders/${order.id}/cancel`);
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError, 'Couldn’t cancel the order.'));
    } finally {
      setBusyId(null);
    }
  }

  async function refund(order: EventOrder) {
    const idempotencyKey = refundAttempts.current.get(order.id) ?? newIdempotencyKey(`demo-refund-${order.id}`);
    refundAttempts.current.set(order.id, idempotencyKey);
    setBusyId(order.id);
    setError(null);
    try {
      const { data } = await api.post<DemoOrderPaymentResult>(`/commerce/orders/${order.id}/demo-refund`, { idempotencyKey, outcome: 0 });
      refundAttempts.current.delete(order.id);
      replaceOrder(data.order);
      setRefundOpen(false);
    } catch (requestError) {
      setError(errorMessage(requestError, 'Couldn’t run the test refund.'));
      setRefundOpen(false);
    } finally {
      setBusyId(null);
    }
  }

  if (!user) return <RefinePage><p className="rf-note py-6">Sign in to see your purchases and sales. <Link to="/login">Sign in</Link></p></RefinePage>;

  const current = openId != null ? orders?.find((order) => order.id === openId) ?? null : null;

  if (current && paying) {
    return (
      <DemoOrderCheckout
        order={current}
        onChanged={replaceOrder}
        variant="page"
        context={`Order #${current.id} · ${pounds(current.totalMinor)}`}
        onBack={() => setPaying(false)}
        backLabel="Back to order"
        approvedTitle="Payment approved"
        resultContext={`Order #${current.id}`}
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

  if (current) {
    return (
      <Receipt
        order={current}
        busy={busyId === current.id}
        error={error}
        onRetry={() => void load()}
        onBack={() => open(null)}
        onPay={() => setPaying(true)}
        onCancel={() => void cancel(current)}
        onRefund={() => setRefundOpen(true)}
        refundOpen={refundOpen}
        onRefundConfirm={() => void refund(current)}
        onRefundClose={() => setRefundOpen(false)}
      />
    );
  }

  const demoOrders = orders?.filter((order) => order.isTestOrder) ?? [];
  const realOrders = orders?.filter((order) => !order.isTestOrder) ?? [];
  return (
    <RefinePage>
      <RefineHeader
        back="/events"
        backLabel="Back to competitions"
        context="Shop"
        title="Your orders"
        tabs={[
          { label: 'Purchases', active: view === 'purchases', onSelect: () => setView('purchases') },
          { label: 'Sales', active: view === 'sales', onSelect: () => setView('sales') },
        ]}
        tabsKind="tablist"
        tabsLabel="Order view"
      />
      {error && <LoadError message={error} onRetry={() => void load()} />}
      {view === 'purchases' ? (
        orders == null ? <p role="status" className="rf-note">Loading purchases…</p>
          : orders.length === 0 ? <p className="rf-note">You haven’t placed an event order yet.</p>
            : (
              <>
                {realOrders.length > 0 && <OrderGroup title="Orders" orders={realOrders} onOpen={open} />}
                {demoOrders.length > 0 && <OrderGroup title="Demo orders" meta="Test payments only" orders={demoOrders} onOpen={open} />}
              </>
            )
      ) : (
        <SalesList sales={sales} />
      )}
    </RefinePage>
  );
}

function OrderGroup({ title, meta, orders, onOpen }: { title: string; meta?: string; orders: EventOrder[]; onOpen: (id: number) => void }) {
  return (
    <>
      <RefineSection title={title} meta={meta} />
      <RefineList label={title}>
        {orders.map((order) => {
          const status = STATUS[order.status];
          return (
            <li key={order.id}>
              <button type="button" className="rf-row" onClick={() => onOpen(order.id)}>
                <span className="rf-grow">
                  <span className="rf-t1">Order #{order.id}</span>
                  <span className="rf-t2">{shortDate(order.createdAt)} · {lineCount(order.lines)} {lineCount(order.lines) === 1 ? 'item' : 'items'}</span>
                </span>
                <span className="text-right"><span className="rf-price block">{pounds(order.totalMinor)}</span><RefineStatus tone={status.tone}>{status.text}</RefineStatus></span>
              </button>
            </li>
          );
        })}
      </RefineList>
    </>
  );
}

const STABLING_LINE_PATTERN = /stabl|hook[\s-]*up|shaving|haylage|bedding|bale|camping|pitch|corral|lorry/i;

type ExtendedSellerSale = SellerSale & {
  buyerName?: string | null;
  clubName?: string | null;
  paymentReference?: string | null;
};

function SalesList({ sales }: { sales: SellerSale[] | null }) {
  if (sales == null) return <p role="status" className="rf-note">Loading sales…</p>;

  const totalPaidMinor = sales
    .filter((s) => s.status === 2)
    .reduce((sum, s) => sum + s.sellerTotalMinor, 0);
  const totalPendingMinor = sales
    .filter((s) => s.status === 0 || s.status === 1)
    .reduce((sum, s) => sum + s.sellerTotalMinor, 0);
  const totalRefundedCancelledMinor = sales
    .filter((s) => s.status === 4 || s.status === 5)
    .reduce((sum, s) => sum + s.sellerTotalMinor, 0);

  let stablingMinor = 0;
  let otherItemsMinor = 0;
  for (const sale of sales) {
    if (sale.status === 4 || sale.status === 5) continue;
    for (const line of sale.lines) {
      if (STABLING_LINE_PATTERN.test(line.title)) {
        stablingMinor += line.lineTotalMinor;
      } else {
        otherItemsMinor += line.lineTotalMinor;
      }
    }
  }

  function exportTreasurerCsv() {
    const header = [
      'Order ID',
      'Date',
      'Buyer Name',
      'Club',
      'Item',
      'Category',
      'Quantity',
      'Status',
      'Payment Reference',
      'Amount (GBP)',
    ];
    const rows: ReadonlyArray<unknown>[] = [];
    for (const sale of sales as ExtendedSellerSale[]) {
      const buyer = sale.buyerName?.trim() || 'Event buyer';
      const club = sale.clubName?.trim() || '—';
      const statusText = STATUS[sale.status]?.text ?? String(sale.status);
      const ref = sale.paymentReference?.trim() || (sale.isTestOrder ? `TEST-${sale.orderId}` : `ORD-${sale.orderId}`);
      if (sale.lines.length === 0) {
        rows.push([
          sale.orderId,
          sale.createdAt,
          buyer,
          club,
          'Order total',
          'Other items',
          1,
          statusText,
          ref,
          (sale.sellerTotalMinor / 100).toFixed(2),
        ]);
      } else {
        for (const line of sale.lines) {
          const category = STABLING_LINE_PATTERN.test(line.title) ? 'Stabling & Hook-up' : 'Other items';
          rows.push([
            sale.orderId,
            sale.createdAt,
            buyer,
            club,
            line.title,
            category,
            line.quantity,
            statusText,
            ref,
            (line.lineTotalMinor / 100).toFixed(2),
          ]);
        }
      }
    }
    downloadCsv('treasurer-reconciliation.csv', toCsv(header, rows));
  }

  return (
    <>
      <section aria-label="Treasurer Reconciliation Summary" className="mg-card mt-3 flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="mg-display m-0 text-base font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">
              Treasurer Reconciliation Summary
            </h2>
            <p className="m-0 text-xs text-[rgb(var(--mg-muted))]">
              Gross receipts, pending BACS/organiser payments &amp; category breakdown
            </p>
          </div>
          <button
            type="button"
            onClick={exportTreasurerCsv}
            className="mg-btn mg-btn-secondary !min-h-9 !px-3 text-xs font-bold"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export Treasurer CSV
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] p-2.5">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--mg-muted))]">
              Total Gross (Paid)
            </span>
            <strong className="mg-display mt-0.5 block text-lg font-bold tabular-nums text-[rgb(var(--mg-ok))]">
              {pounds(totalPaidMinor)}
            </strong>
          </div>
          <div className="rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] p-2.5">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--mg-muted))]">
              Total Pending (Pay the organiser / Payment due)
            </span>
            <strong className="mg-display mt-0.5 block text-lg font-bold tabular-nums text-[rgb(var(--mg-heading))]">
              {pounds(totalPendingMinor)}
            </strong>
          </div>
          <div className="rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] p-2.5">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--mg-muted))]">
              Total Refunded / Cancelled
            </span>
            <strong className="mg-display mt-0.5 block text-lg font-bold tabular-nums text-[rgb(var(--mg-muted))]">
              {pounds(totalRefundedCancelledMinor)}
            </strong>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-[rgb(var(--mg-rule-soft))] pt-2.5 text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold text-[rgb(var(--mg-body))]">Stabling &amp; Hook-up</span>
            <strong className="mg-display text-sm font-bold tabular-nums text-[rgb(var(--mg-heading))]">
              {pounds(stablingMinor)}
            </strong>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold text-[rgb(var(--mg-body))]">Other items</span>
            <strong className="mg-display text-sm font-bold tabular-nums text-[rgb(var(--mg-heading))]">
              {pounds(otherItemsMinor)}
            </strong>
          </div>
        </div>
      </section>

      {sales.length === 0 ? (
        <p className="rf-note">You don’t have any event sales yet.</p>
      ) : (
        <>
          <RefineSection title="Sales" meta="Collect at the event" />
          <RefineList label="Sales">
            {sales.map((sale) => {
              const status = STATUS[sale.status];
              return (
                <li key={sale.orderId} className="rf-row">
                  <span className="rf-grow">
                    <span className="rf-t1">Order #{sale.orderId}{sale.isTestOrder && ' · demo'}</span>
                    <span className="rf-t2">{sale.lines.map((line) => `${line.title} × ${line.quantity}`).join(', ')}</span>
                  </span>
                  <span className="text-right"><span className="rf-price block">{pounds(sale.sellerTotalMinor)}</span><RefineStatus tone={status.tone}>{status.text}</RefineStatus></span>
                </li>
              );
            })}
          </RefineList>
        </>
      )}
    </>
  );
}

interface ReceiptProps {
  order: EventOrder;
  busy: boolean;
  error: string | null;
  refundOpen: boolean;
  onRetry: () => void;
  onBack: () => void;
  onPay: () => void;
  onCancel: () => void;
  onRefund: () => void;
  onRefundConfirm: () => void;
  onRefundClose: () => void;
}

function Receipt({ order, busy, error, refundOpen, onRetry, onBack, onPay, onCancel, onRefund, onRefundConfirm, onRefundClose }: ReceiptProps) {
  const status = STATUS[order.status];
  const payment: TestPayment | undefined = [...order.testPayments].reverse().find((candidate) => candidate.isTest);
  const canPay = order.isTestOrder && (order.status === 1 || order.status === 3);
  const canCancel = [0, 1, 3].includes(order.status);
  const canRefund = order.isTestOrder && order.status === 2;
  const when = order.paidAt ?? order.refundedAt ?? order.cancelledAt ?? order.createdAt;
  return (
    <RefinePage>
      <RefineHeader onBack={onBack} backLabel="Back to orders" context="Orders" title={`Order #${order.id}`} demo={order.isTestOrder} />
      {error && <LoadError message={error} onRetry={onRetry} />}
      <div className="rf-list mt-3" style={{ padding: '6px 0' }}>
        <div className="rf-sum"><span className="rf-mut">Status</span><RefineStatus tone={status.tone}>{status.text}</RefineStatus></div>
        <div className="rf-sum"><span className="rf-mut">When</span><span>{whenText(when)}</span></div>
        {payment && <div className="rf-sum"><span className="rf-mut">Reference</span><span className="break-all text-right text-sm">{payment.receiptReference}</span></div>}
      </div>
      <RefineSection title="Items" />
      <RefineList label="Items">
        {order.lines.map((line) => (
          <li key={line.id} className="rf-row" style={{ minHeight: 48 }}>
            <span className="rf-grow">{line.title} × {line.quantity}</span>
            <span className="rf-price">{pounds(line.lineTotalMinor)}</span>
          </li>
        ))}
      </RefineList>
      <div className="rf-sum rf-sum-total -mx-4"><span>Total</span><span>{pounds(order.totalMinor)}</span></div>
      {order.isTestOrder && payment && <TestReceipt payment={payment} />}
      <RefineNote>
        {order.isTestOrder ? 'A demo order: no money moved. ' : order.status === 0 ? 'Pay the organiser directly. They’ll update this order when the money arrives. ' : ''}
        Collect at the event.
      </RefineNote>
      {(canCancel || canRefund) && (
        <div className="rf-list mt-3">
          <RefineDisclosure title="Order actions">
            <div className="flex flex-col gap-2 px-4 pb-3">
              {canCancel && <button type="button" className="rf-btn rf-wide" disabled={busy} onClick={onCancel}>Cancel order</button>}
              {canRefund && <button type="button" className="rf-btn rf-wide" disabled={busy} onClick={onRefund}>Refund order…</button>}
            </div>
          </RefineDisclosure>
        </div>
      )}
      {canPay && (
        <RefineFoot>
          <button type="button" className="rf-btn rf-btn-primary rf-wide" onClick={onPay}>{order.status === 3 ? 'Retry demo payment' : 'Pay demo order'}</button>
        </RefineFoot>
      )}
      {refundOpen && (
        <RefineSheet title={`Refund ${pounds(order.totalMinor)}?`} onClose={onRefundClose}>
          <p className="m-0 text-sm">Refunds the whole of order #{order.id}. It’s a demo, so no money moves. The order shows as Refunded.</p>
          <div className="rf-actions">
            <button type="button" className="rf-btn" onClick={onRefundClose}>Keep order</button>
            <button type="button" className="rf-btn rf-btn-danger rf-grow" disabled={busy} onClick={onRefundConfirm}>Refund {pounds(order.totalMinor)}</button>
          </div>
        </RefineSheet>
      )}
    </RefinePage>
  );
}

export function LatestTestReceipt({ payments }: { payments: TestPayment[] }) {
  const payment = payments.at(-1);
  return payment ? <TestReceipt payment={payment} /> : null;
}
