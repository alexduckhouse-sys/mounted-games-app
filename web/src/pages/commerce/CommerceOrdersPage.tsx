import { useT } from '../../i18n/LanguageContext';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { activeLocale, tr } from '../../i18n/translate';
import { useAuth } from '../../auth/AuthContext';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { confirmDialog } from '../../components/ConfirmDialog';
import { DemoPaymentNotice } from '../../components/DemoPaymentNotice';
import { Sheet } from '../../components/Sheet';
import { downloadCsv, toCsv } from '../../lib/csv';
import { RefineFoot } from '../refine/Refine';
import { Chip, type ChipTone } from '../clubShop/ui';
import { LoadError, TestReceipt } from './commerceUi';
import { lineTitle } from '../../lib/shopOptions';
import { errorMessage, newIdempotencyKey, orderLineText, pounds } from './commerceFormat';
import { paidWord } from '../../lib/paidWord';
import { OutcomeState } from './DemoPaymentFlow';
import { DemoOrderCheckout } from './EventShopPage';
import type { CommerceOrderStatus, DemoOrderPaymentResult, EventOrder, EventOrderLine, SellerSale, TestPayment } from './types';
import '../../components/sitePages.css';
import '../clubShop/clubShop.css';

type View = 'bought' | 'sold';

/** The word shown for an order: what the buyer needs to do or what happened. Colour only reinforces it. */
const STATUS: Record<CommerceOrderStatus, { text: string; tone: ChipTone }> = {
  0: { get text() { return tr('ops3.shop.payOrganiser'); }, tone: 'warn' },
  1: { get text() { return tr('ops3.shop.status1'); }, tone: 'warn' },
  2: { get text() { return tr('ops3.shop.status2'); }, tone: 'good' },
  3: { get text() { return tr('ops3.shop.status3'); }, tone: 'bad' },
  4: { get text() { return tr('ops3.shop.status4'); }, tone: 'grey' },
  5: { get text() { return tr('ops3.shop.status5'); }, tone: 'grey' },
};

/** The chip for an order. A paid demo order reads "Demo paid". */
const statusFor = (status: CommerceOrderStatus, isTest: boolean) => (status === 2 ? { ...STATUS[2], text: paidWord(isTest) } : STATUS[status]);

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(activeLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
const whenText = (iso: string) => new Date(iso).toLocaleString(activeLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const linesText = (lines: EventOrderLine[]) => lines.map(orderLineText).join(', ');
const eventName = (name: string | null | undefined) => name || tr('ops3.orders.eventOrder');

export function CommerceOrdersPage() {
  const { user } = useAuth();
  return <CommerceOrdersContent key={user?.id ?? 'signed-out'} />;
}

function CommerceOrdersContent() {
  const t = useT();
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
  usePageHeader({ title: t('ops3.orders.title'), plain: true, backTo: '/me', backLabel: t('ops3.orders.backProfile') });

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
        setError(errorMessage(requestError, t('ops3.orders.loadError')));
      });
  }, [user, t]);

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
    if (!(await confirmDialog({ title: t('ops3.orders.cancelQ'), message: t('ops3.orders.cancelMsg', { id: order.id }), confirmLabel: t('ops3.orders.cancelOrder'), cancelLabel: t('ops3.orders.keep'), destructive: true }))) return false;
    setBusyId(order.id);
    setError(null);
    try {
      await api.post(`/commerce/orders/${order.id}/cancel`);
      await load();
      return true;
    } catch (requestError) {
      setError(errorMessage(requestError, t('ops3.orders.cancelError')));
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function refund(order: EventOrder): Promise<boolean> {
    if (!(await confirmDialog({ title: t('ops3.orders.refundQ', { amount: pounds(order.totalMinor) }), message: t('ops3.orders.refundMsg', { id: order.id }), confirmLabel: t('ops3.orders.refundQ', { amount: pounds(order.totalMinor) }).replace(/\?$/, ''), cancelLabel: t('ops3.orders.keep'), destructive: true }))) return false;
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
      setError(errorMessage(requestError, t('ops3.orders.refundError')));
      return false;
    } finally {
      setBusyId(null);
    }
  }

  if (!user) return <div className="skin cs-page"><p className="sp-note">{t('ops3.orders.signIn')} <Link to="/login">{t('common.signIn')}</Link></p></div>;

  const current = openId != null ? orders?.find((order) => order.id === openId) ?? null : null;

  if (current && paying) {
    return (
      <DemoOrderCheckout
        order={current}
        onChanged={replaceOrder}
        variant="page"
        context={t('ops3.orders.ctx', { id: current.id, total: pounds(current.totalMinor) })}
        onBack={() => setPaying(false)}
        backLabel={t('ops3.orders.backOrder')}
        approvedTitle={t('ops3.orders.approved')}
        resultContext={t('ops3.orders.resultCtx', { id: current.id })}
        renderResult={({ payment, retry }) => (
          <>
            <OutcomeState payment={payment} />
            <RefineFoot column>
              {payment.status === 1 && <button type="button" className="rf-btn rf-btn-primary" onClick={retry}>{t('common.tryAgain')}</button>}
              <button type="button" className={`rf-btn ${payment.status === 1 ? 'rf-btn-text' : 'rf-btn-primary'}`} onClick={() => setPaying(false)}>{t('ops3.orders.backOrder')}</button>
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
      <h1 className="sr-only">{t('ops3.orders.title')}</h1>
      <div className="sp-seg" role="tablist" aria-label={t('ops3.shop.orders')}>
        <button type="button" role="tab" aria-selected={view === 'bought'} onClick={() => setView('bought')}>{t('ops3.orders.bought')}</button>
        <button type="button" role="tab" aria-selected={view === 'sold'} onClick={() => setView('sold')}>{t('ops3.orders.sold')}</button>
      </div>
      {error && <div className="cs-gap"><LoadError message={error} onRetry={() => void load()} /></div>}

      {view === 'bought' ? (
        orders == null ? <p role="status" className="sp-note">{t('ops3.orders.loading')}</p>
          : orders.length === 0 ? <p className="sp-note">{t('ops3.orders.none')}</p>
            : (
              <>
                {orders.some((order) => order.status === 0 || order.status === 1) && <DemoPaymentNotice what="order" />}
                {realOrders.length > 0 && <OrderGroup title={t('ops3.orders.yours')} orders={realOrders} onOpen={open} />}
                {demoOrders.length > 0 && <OrderGroup title={t('ops3.orders.demo')} meta={t('ops3.orders.testOnly')} orders={demoOrders} onOpen={open} />}
                {realOrders.length > 0 && <p className="sp-note">{t('ops3.orders.payDirect')}</p>}
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
  const t = useT();
  return (
    <section aria-label={title}>
      <h2 className="sp-sec">{title}{meta && <small>{meta}</small>}</h2>
      <div className="sp-card">
        {orders.map((order) => {
          const status = statusFor(order.status, order.isTestOrder);
          return (
            <button key={order.id} type="button" className="sp-row" onClick={() => onOpen(order.id)}>
              <span className="sp-grow">
                <span className="sp-t1">{eventName(order.competitionName)}</span>
                <span className="sp-t2">{t('ops3.orders.line', { id: order.id, date: shortDate(order.createdAt), lines: linesText(order.lines) })}</span>
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
  const t = useT();
  if (sales == null) return <p role="status" className="sp-note">{t('ops3.orders.loadingSales')}</p>;

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
        <div className="cs-tile"><strong>{pounds(sum([2]))}</strong><span>{t('ops3.shop.paid')}</span></div>
        <div className="cs-tile"><strong>{pounds(sum([0, 1]))}</strong><span>{t('ops2.entries.notPaidYet')}</span></div>
        <div className="cs-tile"><strong>{pounds(sum([5]))}</strong><span>{t('ops3.shop.status5')}</span></div>
      </div>

      {sales.length === 0 ? (
        <p className="sp-note">{t('ops3.orders.noSales')}</p>
      ) : (
        <>
          <h2 className="sp-sec">{t('ops3.orders.sales')} <small>{t('ops3.orders.collect')}</small></h2>
          <div className="sp-card">
            {sales.map((sale) => {
              const status = statusFor(sale.status, sale.isTestOrder);
              return (
                <div key={sale.orderId} className="cs-row">
                  <span className="sp-grow">
                    <span className="sp-t1">{eventName(sale.competitionName)}</span>
                    <span className="sp-t2">{t('ops3.orders.saleLine', { id: sale.orderId, demo: sale.isTestOrder ? ` · ${t('ops3.orders.demoWord')}` : '', lines: linesText(sale.lines) })}</span>
                  </span>
                  <span className="cs-right"><span className="sp-price !text-[18px]">{pounds(sale.sellerTotalMinor)}</span><Chip tone={status.tone}>{status.text}</Chip></span>
                </div>
              );
            })}
          </div>
          <div className="kit-acts cs-gap">
            <button type="button" className="kit-pill cs-pill-s" onClick={exportTreasurerCsv}>{t('ops3.orders.treasurer')}</button>
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
  const t = useT();
  const status = statusFor(order.status, order.isTestOrder);
  const payment: TestPayment | undefined = [...order.testPayments].reverse().find((candidate) => candidate.isTest);
  const canPay = order.isTestOrder && (order.status === 1 || order.status === 3);
  const canCancel = [0, 1, 3].includes(order.status);
  const canRefund = order.isTestOrder && order.status === 2;
  const when = order.paidAt ?? order.refundedAt ?? order.cancelledAt ?? order.createdAt;
  return (
    <Sheet title={t('ops3.orders.sheetTitle', { id: order.id, demo: order.isTestOrder ? ` (${t('ops3.orders.demoWord')})` : '' })} onClose={onClose}>
      {({ close }) => (
        <>
          <dl className="cs-sheet-facts">
            <div><dt>{t('ops3.orders.event')}</dt><dd>{eventName(order.competitionName)}</dd></div>
            <div><dt>{t('ops2.sponsors.status')}</dt><dd>{status.text}</dd></div>
            <div><dt>{t('ops3.orders.when')}</dt><dd>{whenText(when)}</dd></div>
            {order.lines.map((line) => <div key={line.id}><dt>{orderLineText(line)}</dt><dd>{pounds(line.lineTotalMinor)}</dd></div>)}
            <div><dt>{t('ops2.print.total')}</dt><dd><strong>{pounds(order.totalMinor)}</strong></dd></div>
          </dl>
          {order.isTestOrder && payment && <TestReceipt payment={payment} />}
          <DemoPaymentNotice what="order" />
          <p className="kit-sheet-text">
            {order.isTestOrder ? '' : order.status === 0 ? `${t('ops3.orders.payDirectShort')} ` : ''}
            {t('ops3.orders.collect')}.
          </p>
          <div className="kit-acts">
            {canPay && <button type="button" className="kit-pill kit-pill-fill" onClick={() => close(onPay)}>{order.status === 3 ? t('ops3.orders.retry') : t('ops3.orders.payDemo')}</button>}
            <button type="button" className={`kit-pill${canPay ? '' : ' kit-pill-fill'}`} onClick={() => close()}>{t('common.done')}</button>
            {canCancel && <button type="button" className="kit-redtext" disabled={busy} onClick={() => { void onCancel().then((done) => { if (done) close(); }); }}>{t('ops3.orders.cancelOrder')}</button>}
            {canRefund && <button type="button" className="kit-redtext" disabled={busy} onClick={() => { void onRefund(); }}>{t('ops3.orders.refundOrder')}</button>}
          </div>
        </>
      )}
    </Sheet>
  );
}
