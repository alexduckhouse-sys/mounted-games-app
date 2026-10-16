import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { LoadError, PageHeader, StatusPill, TestReceipt } from './commerceUi';
import { ORDER_LABEL, errorMessage, newIdempotencyKey, pounds } from './commerceFormat';
import { DemoPaymentFlow } from './DemoPaymentFlow';
import type { DemoOrderPaymentResult, EventOrder, FakePaymentOutcome, SellerSale, TestPayment } from './types';

type View = 'purchases' | 'sales';

export function CommerceOrdersPage() {
  const { user } = useAuth();
  return <CommerceOrdersContent key={user?.id ?? 'signed-out'} />;
}

function CommerceOrdersContent() {
  const { user } = useAuth();
  const [view, setView] = useState<View>('purchases');
  const [orders, setOrders] = useState<EventOrder[] | null>(null);
  const [sales, setSales] = useState<SellerSale[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const refundAttempts = useRef(new Map<number, string>());

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

  async function demo(order: EventOrder, outcome: FakePaymentOutcome, idempotencyKey: string) {
    const { data } = await api.post<DemoOrderPaymentResult>(`/commerce/orders/${order.id}/demo-checkout`, {
      idempotencyKey,
      outcome,
    });
    setOrders((current) => current?.map((existing) => existing.id === order.id ? data.order : existing) ?? null);
    return data.payment;
  }

  async function refund(order: EventOrder) {
    const idempotencyKey = refundAttempts.current.get(order.id) ?? newIdempotencyKey(`demo-refund-${order.id}`);
    refundAttempts.current.set(order.id, idempotencyKey);
    setBusyId(order.id);
    setError(null);
    try {
      const { data } = await api.post<DemoOrderPaymentResult>(`/commerce/orders/${order.id}/demo-refund`, {
        idempotencyKey, outcome: 0,
      });
      refundAttempts.current.delete(order.id);
      setOrders((current) => current?.map((existing) => existing.id === order.id ? data.order : existing) ?? null);
    } catch (requestError) {
      setError(errorMessage(requestError, 'Couldn’t run the test refund.'));
    } finally {
      setBusyId(null);
    }
  }

  if (!user) return <div className="skin mg-card p-5">Sign in to see your purchases and sales. <Link className="mg-text-link" to="/login">Sign in</Link></div>;

  return (
    <div className="skin mx-auto flex w-full max-w-3xl flex-col gap-5 pb-6">
      <PageHeader title="Event orders">Check what you’ve ordered and what people have bought from you.</PageHeader>
      <div className="mg-seg self-start" aria-label="Order view">
        <button type="button" aria-pressed={view === 'purchases'} onClick={() => setView('purchases')}>Purchases</button>
        <button type="button" aria-pressed={view === 'sales'} onClick={() => setView('sales')}>Sales</button>
      </div>
      {error && <LoadError message={error} onRetry={() => void load()} />}
      {view === 'purchases' ? (
        <PurchaseList orders={orders} busyId={busyId} onCancel={cancel} onDemo={demo} onRefund={refund} />
      ) : (
        <SalesList sales={sales} />
      )}
    </div>
  );
}

function PurchaseList({
  orders, busyId, onCancel, onDemo, onRefund,
}: {
  orders: EventOrder[] | null;
  busyId: number | null;
  onCancel: (order: EventOrder) => Promise<void>;
  onDemo: (order: EventOrder, outcome: FakePaymentOutcome, idempotencyKey: string) => Promise<TestPayment>;
  onRefund: (order: EventOrder) => Promise<void>;
}) {
  if (orders == null) return <p role="status" className="mg-card p-4">Loading purchases…</p>;
  if (orders.length === 0) return <p className="mg-card p-5">You haven’t placed an event order yet.</p>;
  return (
    <section className="flex flex-col gap-3" aria-label="Purchases">
      {orders.map((order) => {
        const receipt = [...order.testPayments].reverse().find((payment) => payment.isTest);
        const canCancel = [0, 1, 3].includes(order.status);
        return (
          <article key={order.id} className="mg-card flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mg-h2">Order #{order.id}</h2>
              <StatusPill tone={order.isTestOrder ? 'test' : order.status === 2 ? 'good' : 'neutral'}>{order.isTestOrder ? `Demo · ${ORDER_LABEL[order.status]}` : ORDER_LABEL[order.status]}</StatusPill>
              <strong className="ml-auto">{pounds(order.totalMinor)}</strong>
            </div>
            <ul className="divide-y divide-[rgb(var(--mg-rule-soft))]">
              {order.lines.map((line) => <li key={line.id} className="flex gap-3 py-2 text-sm"><span className="flex-1">{line.title} × {line.quantity}</span><strong>{pounds(line.lineTotalMinor)}</strong></li>)}
            </ul>
            {!order.isTestOrder && order.status === 0 && <p className="mg-notice">Pay the organiser directly. They’ll update this order when the money arrives.</p>}
            {order.isTestOrder && (
              <DemoPaymentFlow
                targetKey={`order-${order.id}`}
                title={`Order #${order.id}`}
                amountMinor={order.totalMinor}
                initialPayment={receipt}
                canPay={order.status === 1 || order.status === 3}
                onPay={(outcome, idempotencyKey) => onDemo(order, outcome, idempotencyKey)}
              />
            )}
            {!order.isTestOrder && receipt && <TestReceipt payment={receipt} />}
            <div className="flex flex-wrap gap-2">
              {canCancel && <button type="button" className="mg-btn mg-btn-secondary" disabled={busyId === order.id} onClick={() => void onCancel(order)}>Cancel order</button>}
              {order.isTestOrder && order.status === 2 && <button type="button" className="mg-btn mg-btn-secondary" disabled={busyId === order.id} onClick={() => void onRefund(order)}>Run demo refund</button>}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function SalesList({ sales }: { sales: SellerSale[] | null }) {
  if (sales == null) return <p role="status" className="mg-card p-4">Loading sales…</p>;
  if (sales.length === 0) return <p className="mg-card p-5">You don’t have any event sales yet.</p>;
  return (
    <section className="mg-card mg-list" aria-label="Sales">
      {sales.map((sale) => (
        <article key={sale.orderId} className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mg-h2">Order #{sale.orderId}</h2>
            <StatusPill tone={sale.isTestOrder ? 'test' : sale.status === 2 ? 'good' : 'neutral'}>{sale.isTestOrder ? `Demo · ${ORDER_LABEL[sale.status]}` : ORDER_LABEL[sale.status]}</StatusPill>
            <strong className="ml-auto">{pounds(sale.sellerTotalMinor)}</strong>
          </div>
          <p className="text-sm text-[rgb(var(--mg-body))]">{sale.lines.map((line) => `${line.title} × ${line.quantity}`).join(', ')}</p>
          <p className="mg-meta">Collection at the event.</p>
        </article>
      ))}
    </section>
  );
}

export function LatestTestReceipt({ payments }: { payments: TestPayment[] }) {
  const payment = payments.at(-1);
  return payment ? <TestReceipt payment={payment} /> : null;
}
