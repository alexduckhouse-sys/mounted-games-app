import { useT } from '../../i18n/LanguageContext';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { tr } from '../../i18n/translate';
import { useAuth } from '../../auth/AuthContext';
import { CardDropdownRow } from '../../components/CardDropdownRow';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { confirmDialog } from '../../components/ConfirmDialog';
import { usePageWidth } from '../../components/pageWidthState';
import { useCompetition } from '../competition/context';
import { Chip, FormSheet, SheetField, type ChipTone } from '../clubShop/ui';
import { LoadError } from './commerceUi';
import { errorMessage, orderLineText, pounds } from './commerceFormat';
import { paidWord } from '../../lib/paidWord';
import type { CommerceOrderStatus, CompetitionListing, EventCommerceSettings, EventOrder } from './types';
import '../../components/sitePages.css';
import '../clubShop/clubShop.css';

type ManagementView = 'items' | 'orders' | 'payments';

/** What the organiser sees for an order: whether the money has arrived. */
const ORDER_STATUS: Record<CommerceOrderStatus, { text: string; tone: ChipTone }> = {
  0: { get text() { return tr('ops3.shop.status0'); }, tone: 'warn' },
  1: { get text() { return tr('ops3.shop.status1'); }, tone: 'warn' },
  2: { get text() { return tr('ops3.shop.status2'); }, tone: 'good' },
  3: { get text() { return tr('ops3.shop.status3'); }, tone: 'bad' },
  4: { get text() { return tr('ops3.shop.status4'); }, tone: 'grey' },
  5: { get text() { return tr('ops3.shop.status5'); }, tone: 'grey' },
};

const PAY_OPTIONS = [
  { value: 'manual', get label() { return tr('ops3.shop.payOrganiser'); } },
  { value: 'demo', get label() { return tr('ops3.shop.demoNoMoney'); } },
];

const stockText = (listing: CompetitionListing) => (listing.item.stockQuantity == null ? tr('ops3.shop.unlimited') : tr('ops3.shop.available', { count: listing.item.stockQuantity }));
const sellerText = (listing: CompetitionListing) => listing.sellerName || tr('ops3.shop.aSeller');

export function CommerceManagementPage() {
  usePageWidth('narrow');
  const { competition } = useCompetition();
  const { user } = useAuth();
  return <CommerceManagementContent key={`${competition.id}:${user?.id ?? 'signed-out'}`} />;
}

function CommerceManagementContent() {
  const t = useT();
  const { competition } = useCompetition();
  const { canOrganise } = useAuth();
  const [listings, setListings] = useState<CompetitionListing[] | null>(null);
  const [orders, setOrders] = useState<EventOrder[] | null>(null);
  const [settings, setSettings] = useState<EventCommerceSettings | null>(null);
  const [view, setView] = useState<ManagementView>('items');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState<CompetitionListing | null>(null);
  usePageHeader({ title: t('ops2.sponsors.eventShop'), subtitle: competition.name, plain: true, backTo: `/competitions/${competition.id}/details`, backLabel: t('ops3.shop.backDetails') });

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
        setError(errorMessage(requestError, t('ops3.shop.loadError')));
      });
  }, [canOrganise, competition, t]);

  useEffect(() => { void load(); }, [load]);

  /** Runs a write, then reloads. Returns the problem to show, or null when it worked. */
  async function run(action: () => Promise<unknown>, failure: string): Promise<string | null> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      return null;
    } catch (requestError) {
      const message = errorMessage(requestError, failure);
      setError(message);
      return message;
    } finally {
      setBusy(false);
    }
  }

  const approve = (listing: CompetitionListing) =>
    run(() => api.put(`/commerce/listings/${listing.id}/approval`, { status: 1, reviewNote: null }), t('ops3.shop.approveError'));

  const decline = (listing: CompetitionListing, reason: string) =>
    run(() => api.put(`/commerce/listings/${listing.id}/approval`, { status: 2, reviewNote: reason.trim() || null }), t('ops3.shop.declineError'));

  async function setDemo(isDemo: boolean) {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.put<EventCommerceSettings>(`/commerce/competitions/${competition.id}/settings`, { isDemo });
      setSettings(data);
    } catch (requestError) {
      setError(errorMessage(requestError, t('ops3.shop.payError')));
    } finally {
      setBusy(false);
    }
  }

  async function manualAction(order: EventOrder, action: 'manual-payment' | 'manual-refund') {
    if (action === 'manual-refund' && !(await confirmDialog({
      title: t('ops3.shop.markRefundedQ', { id: order.id }),
      message: t('ops3.shop.markRefundedMsg'),
      confirmLabel: t('ops3.shop.markRefunded'),
      cancelLabel: t('ops3.shop.notYet'),
      destructive: true,
    }))) return;
    await run(
      () => api.post(`/commerce/orders/${order.id}/${action}`, { confirmedExternally: true }),
      action === 'manual-payment' ? t('ops3.shop.markPaidError') : t('ops3.shop.markRefundedError'),
    );
  }

  if (!canOrganise(competition)) return <div className="skin cs-page"><p className="sp-note">{t('ops3.shop.organiserOnly')}</p></div>;

  const waiting = listings?.filter((listing) => listing.status === 0) ?? [];
  const onSale = listings?.filter((listing) => listing.status === 1) ?? [];
  const notOnSale = listings?.filter((listing) => listing.status === 2 || listing.status === 3) ?? [];
  const tabs: { id: ManagementView; label: string }[] = [
    { id: 'items', label: `${t('ops3.shop.items')}${waiting.length > 0 ? ` (${waiting.length})` : ''}` },
    { id: 'orders', label: t('ops3.shop.orders') },
    { id: 'payments', label: t('ops3.shop.payments') },
  ];

  return (
    <div className="skin cs-page">
      <h1 className="sr-only">{t('ops2.sponsors.eventShop')}</h1>
      <div className="sp-seg" role="tablist" aria-label={t('ops2.sponsors.eventShop')}>
        {tabs.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={view === tab.id} onClick={() => setView(tab.id)}>{tab.label}</button>
        ))}
      </div>
      {error && <div className="cs-gap"><LoadError message={error} onRetry={() => void load()} /></div>}

      {view === 'items' && (
        listings == null ? <p role="status" className="sp-note">{t('ops3.shop.loadingItems')}</p> : (
          <>
            <h2 className="sp-sec">{t('ops3.shop.toApprove')} <small>{waiting.length}</small></h2>
            <div className="sp-card">
              {waiting.map((listing) => (
                <div key={listing.id} className="cs-row cs-stack">
                  <span className="cs-line">
                    <span className="sp-grow"><span className="sp-t1">{listing.item.title}</span><span className="sp-t2">{sellerText(listing)} · {stockText(listing)}</span></span>
                    <span className="sp-price !text-[18px]">{pounds(listing.item.priceMinor)}</span>
                  </span>
                  <span className="cs-end">
                    <button type="button" className="kit-redtext cs-redtext-s" disabled={busy} aria-label={t('ops3.shop.declineAria', { title: listing.item.title })} onClick={() => setDeclining(listing)}>{t('ops3.shop.decline')}</button>
                    <button type="button" className="kit-pill kit-pill-fill cs-pill-s" disabled={busy} aria-label={t('ops3.shop.approveAria', { title: listing.item.title })} onClick={() => { void approve(listing); }}>{t('ops3.shop.approve')}</button>
                  </span>
                </div>
              ))}
              {waiting.length === 0 && <p className="cs-row sp-t2 m-0">{t('ops3.shop.nothingWaiting')}</p>}
            </div>

            <h2 className="sp-sec">{t('ops3.shop.onSale')} <small>{onSale.length}</small></h2>
            <div className="sp-card">
              {onSale.map((listing) => (
                <div key={listing.id} className="cs-row">
                  <span className="sp-grow"><span className="sp-t1">{listing.item.title}</span><span className="sp-t2">{sellerText(listing)} · {pounds(listing.item.priceMinor)}</span></span>
                  <Chip tone="good">{t('ops3.shop.onSale')}</Chip>
                </div>
              ))}
              {onSale.length === 0 && <p className="cs-row sp-t2 m-0">{t('ops3.shop.nothingOnSale')}</p>}
            </div>

            {notOnSale.length > 0 && (
              <>
                <h2 className="sp-sec">{t('ops3.shop.notOnSale')} <small>{notOnSale.length}</small></h2>
                <div className="sp-card">
                  {notOnSale.map((listing) => (
                    <div key={listing.id} className="cs-row">
                      <span className="sp-grow"><span className="sp-t1">{listing.item.title}</span><span className="sp-t2">{sellerText(listing)} · {pounds(listing.item.priceMinor)}</span></span>
                      <Chip tone={listing.status === 2 ? 'bad' : 'grey'}>{listing.status === 2 ? t('ops3.shop.status3') : t('ops2.protest.withdrawn')}</Chip>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )
      )}

      {view === 'orders' && (
        orders == null ? <p role="status" className="sp-note">{t('ops3.shop.loadingOrders')}</p> : (
          <>
            <h2 className="sp-sec">{t('ops3.shop.orders')} <small>{orders.length}</small></h2>
            <div className="sp-card">
              {orders.map((order) => {
                const status = ORDER_STATUS[order.status];
                const canMarkPaid = !order.isTestOrder && order.status === 0;
                const canMarkRefunded = !order.isTestOrder && order.status === 2;
                return (
                  <div key={order.id} className="cs-row cs-stack">
                    <span className="cs-line">
                      <span className="sp-grow">
                        <span className="sp-t1">{t('ops3.shop.orderBuyer', { id: order.id, buyer: order.buyerName || t('ops3.shop.buyer') })}</span>
                        <span className="sp-t2">{order.lines.map(orderLineText).join(', ')}</span>
                      </span>
                      <span className="cs-right">
                        <span className="sp-price !text-[18px]">{pounds(order.totalMinor)}</span>
                        <Chip tone={status.tone}>{order.isTestOrder ? (order.status === 2 ? paidWord(true) : t('ops3.shop.demoStatus', { status: status.text })) : status.text}</Chip>
                      </span>
                    </span>
                    {(canMarkPaid || canMarkRefunded) && (
                      <span className="cs-end">
                        {canMarkPaid && <button type="button" className="kit-pill kit-pill-fill cs-pill-s" disabled={busy} aria-label={t('ops3.shop.markPaidAria', { id: order.id })} onClick={() => { void manualAction(order, 'manual-payment'); }}>{t('ops2.entries.markPaid')}</button>}
                        {canMarkRefunded && <button type="button" className="kit-pill cs-pill-s" disabled={busy} aria-label={t('ops3.shop.markRefundedAria', { id: order.id })} onClick={() => { void manualAction(order, 'manual-refund'); }}>{t('ops3.shop.markRefunded')}</button>}
                      </span>
                    )}
                  </div>
                );
              })}
              {orders.length === 0 && <p className="cs-row sp-t2 m-0">{t('ops3.shop.noOrders')}</p>}
            </div>
          </>
        )
      )}

      {view === 'payments' && (
        settings == null ? <p role="status" className="sp-note">{t('common.loading')}</p> : (
          <>
            <h2 className="sp-sec">{t('ops3.shop.payments')}</h2>
            <div className="sp-card">
              <CardDropdownRow label={t('ops3.shop.howPay')} value={settings.isDemo ? 'demo' : 'manual'} options={PAY_OPTIONS} disabled={busy || settings.isLocked}
                onChange={(value) => { if ((value === 'demo') !== settings.isDemo) void setDemo(value === 'demo'); }} />
            </div>
            <p className="sp-note">{settings.isLocked ? t('ops3.shop.fixed') : t('ops3.shop.demoNote')}</p>
          </>
        )
      )}

      {declining && (
        <DeclineSheet listing={declining} onClose={() => setDeclining(null)} onDecline={(reason) => decline(declining, reason)} />
      )}
    </div>
  );
}

/** Asks why, so the seller sees a reason next to "Declined". */
function DeclineSheet({ listing, onClose, onDecline }: { listing: CompetitionListing; onClose: () => void; onDecline: (reason: string) => Promise<string | null> }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <FormSheet title={t('ops3.shop.declineTitle')} description={t('ops3.shop.declineDesc', { title: listing.item.title, seller: sellerText(listing) })} saveLabel={t('ops3.shop.decline')} onClose={onClose} error={problem}
      onSave={async () => { const message = await onDecline(reason); setProblem(message); return message == null; }}>
      <SheetField label={t('ops2.panel.reasonLabel')}>
        <textarea rows={3} maxLength={500} placeholder={t('ops3.shop.declinePh')} value={reason} onChange={(event) => setReason(event.target.value)} />
      </SheetField>
    </FormSheet>
  );
}
