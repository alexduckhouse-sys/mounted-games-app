import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CreditCard, RotateCcw } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { LoadError, StatusPill, TestReceipt } from './commerceUi';
import { ORDER_LABEL, errorMessage, newIdempotencyKey, pounds } from './commerceFormat';
import { DemoPaymentFlow } from './DemoPaymentFlow';
import type { DemoOrderPaymentResult, EventOrder, FakePaymentOutcome, SellerSale, TestPayment } from './types';
import './commerce.css';

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
  const [paymentOrderId, setPaymentOrderId] = useState<number | null>(null);
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

  const paymentOrder = orders?.find((order) => order.id === paymentOrderId) ?? null;
  if (paymentOrder) {
    const receipt = [...paymentOrder.testPayments].reverse().find((payment) => payment.isTest);
    return (
      <div className="skin commerce-page mx-auto w-full max-w-3xl pb-6">
        <button type="button" className="commerce-back" onClick={() => setPaymentOrderId(null)}><ArrowLeft className="h-4 w-4" /> Back to orders</button>
        <header className="commerce-title-block">
          <p className="mg-eyebrow">Demo checkout</p>
          <h1 className="mg-h1">Order #{paymentOrder.id}</h1>
          <p className="mg-lede">{paymentOrder.lines.map((line) => `${line.title} × ${line.quantity}`).join(', ')}</p>
        </header>
        <DemoPaymentFlow
          targetKey={`order-${paymentOrder.id}`}
          title={`Order #${paymentOrder.id}`}
          amountMinor={paymentOrder.totalMinor}
          initialPayment={receipt}
          canPay={paymentOrder.status === 1 || paymentOrder.status === 3}
          onPay={(outcome, idempotencyKey) => demo(paymentOrder, outcome, idempotencyKey)}
        />
      </div>
    );
  }

  return (
    <div className="skin commerce-page mx-auto w-full max-w-3xl pb-6">
      <header className="commerce-title-block"><p className="mg-eyebrow">Shop activity</p><h1 className="mg-h1">Orders</h1><p className="mg-lede">Your purchases and the items people have bought from you.</p></header>
      <div className="mg-seg self-start" aria-label="Order view">
        <button type="button" aria-pressed={view === 'purchases'} onClick={() => setView('purchases')}>Purchases</button>
        <button type="button" aria-pressed={view === 'sales'} onClick={() => setView('sales')}>Sales</button>
      </div>
      {error && <LoadError message={error} onRetry={() => void load()} />}
      {view === 'purchases' ? (
        <PurchaseList orders={orders} busyId={busyId} onCancel={cancel} onPay={setPaymentOrderId} onRefund={refund} />
      ) : (
        <SalesList sales={sales} />
      )}
    </div>
  );
}

function PurchaseList({
  orders, busyId, onCancel, onPay, onRefund,
}: {
  orders: EventOrder[] | null;
  busyId: number | null;
  onCancel: (order: EventOrder) => Promise<void>;
  onPay: (orderId: number) => void;
  onRefund: (order: EventOrder) => Promise<void>;
}) {
  if (orders == null) return <p role="status" className="mg-card p-4">Loading purchases…</p>;
  if (orders.length === 0) return <p className="mg-card p-5">You haven’t placed an event order yet.</p>;
  return (
    <section className="commerce-rows" aria-label="Purchases">
      {orders.map((order) => {
        const receipt = [...order.testPayments].reverse().find((payment) => payment.isTest);
        const canCancel = [0, 1, 3].includes(order.status);
        return (
          <article key={order.id} className="commerce-order-row">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mg-h2">Order #{order.id}</h2>
              <StatusPill tone={order.isTestOrder ? 'test' : order.status === 2 ? 'good' : 'neutral'}>{order.isTestOrder ? `Demo · ${ORDER_LABEL[order.status]}` : ORDER_LABEL[order.status]}</StatusPill>
              <strong className="ml-auto">{pounds(order.totalMinor)}</strong>
            </div>
            <p className="commerce-order-items">{order.lines.map((line) => `${line.title} × ${line.quantity}`).join(', ')}</p>
            {!order.isTestOrder && order.status === 0 && <p className="mg-notice">Pay the organiser directly. They’ll update this order when the money arrives.</p>}
            {receipt && <CompactReceipt payment={receipt} />}
            <div className="commerce-inline-actions">
              {order.isTestOrder && (order.status === 1 || order.status === 3) && (
                <button type="button" className="commerce-compact-button commerce-compact-button--primary" onClick={() => onPay(order.id)}><CreditCard className="h-4 w-4" /> {order.status === 3 ? 'Retry demo payment' : 'Pay demo order'}</button>
              )}
              {canCancel && <button type="button" className="commerce-compact-button" disabled={busyId === order.id} onClick={() => void onCancel(order)}>Cancel order</button>}
              {order.isTestOrder && order.status === 2 && <button type="button" className="commerce-compact-button" disabled={busyId === order.id} onClick={() => void onRefund(order)}><RotateCcw className="h-4 w-4" /> Demo refund</button>}
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
    <section className="commerce-rows" aria-label="Sales">
      {sales.map((sale) => (
        <article key={sale.orderId} className="commerce-order-row">
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

function CompactReceipt({ payment }: { payment: TestPayment }) {
  return (
    <p className="commerce-receipt">
      <span>{payment.receiptLabel}</span>
      <span>{payment.receiptReference}</span>
    </p>
  );
}
