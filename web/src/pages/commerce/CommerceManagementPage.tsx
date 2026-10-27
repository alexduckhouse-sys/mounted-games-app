import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { CardDropdownRow } from '../../components/CardDropdownRow';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { confirmDialog } from '../../components/ConfirmDialog';
import { usePageWidth } from '../../components/pageWidthState';
import { useCompetition } from '../competition/context';
import { Chip, FormSheet, SheetField, type ChipTone } from '../clubShop/ui';
import { LoadError } from './commerceUi';
import { errorMessage, orderLineText, pounds } from './commerceFormat';
import type { CommerceOrderStatus, CompetitionListing, EventCommerceSettings, EventOrder } from './types';
import '../../components/sitePages.css';
import '../clubShop/clubShop.css';

type ManagementView = 'items' | 'orders' | 'payments';

/** What the organiser sees for an order: whether the money has arrived. */
const ORDER_STATUS: Record<CommerceOrderStatus, { text: string; tone: ChipTone }> = {
  0: { text: 'Not paid', tone: 'warn' },
  1: { text: 'Payment due', tone: 'warn' },
  2: { text: 'Paid', tone: 'good' },
  3: { text: 'Declined', tone: 'bad' },
  4: { text: 'Cancelled', tone: 'grey' },
  5: { text: 'Refunded', tone: 'grey' },
};

const PAY_OPTIONS = [
  { value: 'manual', label: 'Pay the organiser' },
  { value: 'demo', label: 'Demo (no money taken)' },
];

const stockText = (listing: CompetitionListing) => (listing.item.stockQuantity == null ? 'Unlimited' : `${listing.item.stockQuantity} available`);
const sellerText = (listing: CompetitionListing) => listing.sellerName || 'A seller';

export function CommerceManagementPage() {
  usePageWidth('narrow');
  const { competition } = useCompetition();
  const { user } = useAuth();
  return <CommerceManagementContent key={`${competition.id}:${user?.id ?? 'signed-out'}`} />;
}

function CommerceManagementContent() {
  const { competition } = useCompetition();
  const { canOrganise } = useAuth();
  const [listings, setListings] = useState<CompetitionListing[] | null>(null);
  const [orders, setOrders] = useState<EventOrder[] | null>(null);
  const [settings, setSettings] = useState<EventCommerceSettings | null>(null);
  const [view, setView] = useState<ManagementView>('items');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState<CompetitionListing | null>(null);
  usePageHeader({ title: 'Event shop', subtitle: competition.name, plain: true, backTo: `/competitions/${competition.id}/details`, backLabel: 'Back to details' });

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
        setError(errorMessage(requestError, 'Couldn’t load the shop. Check your signal and try again.'));
      });
  }, [canOrganise, competition]);

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
    run(() => api.put(`/commerce/listings/${listing.id}/approval`, { status: 1, reviewNote: null }), 'Couldn’t approve the item. Check your signal and try again.');

  const decline = (listing: CompetitionListing, reason: string) =>
    run(() => api.put(`/commerce/listings/${listing.id}/approval`, { status: 2, reviewNote: reason.trim() || null }), 'Couldn’t decline the item. Check your signal and try again.');

  async function setDemo(isDemo: boolean) {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.put<EventCommerceSettings>(`/commerce/competitions/${competition.id}/settings`, { isDemo });
      setSettings(data);
    } catch (requestError) {
      setError(errorMessage(requestError, 'Couldn’t change how people pay. Check your signal and try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function manualAction(order: EventOrder, action: 'manual-payment' | 'manual-refund') {
    if (action === 'manual-refund' && !(await confirmDialog({
      title: `Mark order ${order.id} refunded?`,
      message: 'Only do this once the money has gone back to the buyer.',
      confirmLabel: 'Mark refunded',
      cancelLabel: 'Not yet',
      destructive: true,
    }))) return;
    await run(
      () => api.post(`/commerce/orders/${order.id}/${action}`, { confirmedExternally: true }),
      action === 'manual-payment' ? 'Couldn’t mark the order paid. Check your signal and try again.' : 'Couldn’t mark the order refunded. Check your signal and try again.',
    );
  }

  if (!canOrganise(competition)) return <div className="skin cs-page"><p className="sp-note">Only this competition’s organiser can manage its shop.</p></div>;

  const waiting = listings?.filter((listing) => listing.status === 0) ?? [];
  const onSale = listings?.filter((listing) => listing.status === 1) ?? [];
  const notOnSale = listings?.filter((listing) => listing.status === 2 || listing.status === 3) ?? [];
  const tabs: { id: ManagementView; label: string }[] = [
    { id: 'items', label: `Items${waiting.length > 0 ? ` (${waiting.length})` : ''}` },
    { id: 'orders', label: 'Orders' },
    { id: 'payments', label: 'Payments' },
  ];

  return (
    <div className="skin cs-page">
      <h1 className="sr-only">Event shop</h1>
      <div className="sp-seg" role="tablist" aria-label="Event shop">
        {tabs.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={view === tab.id} onClick={() => setView(tab.id)}>{tab.label}</button>
        ))}
      </div>
      {error && <div className="cs-gap"><LoadError message={error} onRetry={() => void load()} /></div>}

      {view === 'items' && (
        listings == null ? <p role="status" className="sp-note">Loading items…</p> : (
          <>
            <h2 className="sp-sec">To approve <small>{waiting.length}</small></h2>
            <div className="sp-card">
              {waiting.map((listing) => (
                <div key={listing.id} className="cs-row cs-stack">
                  <span className="cs-line">
                    <span className="sp-grow"><span className="sp-t1">{listing.item.title}</span><span className="sp-t2">{sellerText(listing)} · {stockText(listing)}</span></span>
                    <span className="sp-price !text-[18px]">{pounds(listing.item.priceMinor)}</span>
                  </span>
                  <span className="cs-end">
                    <button type="button" className="kit-redtext cs-redtext-s" disabled={busy} aria-label={`Decline ${listing.item.title}`} onClick={() => setDeclining(listing)}>Decline</button>
                    <button type="button" className="kit-pill kit-pill-fill cs-pill-s" disabled={busy} aria-label={`Approve ${listing.item.title}`} onClick={() => { void approve(listing); }}>Approve</button>
                  </span>
                </div>
              ))}
              {waiting.length === 0 && <p className="cs-row sp-t2 m-0">Nothing waiting.</p>}
            </div>

            <h2 className="sp-sec">On sale <small>{onSale.length}</small></h2>
            <div className="sp-card">
              {onSale.map((listing) => (
                <div key={listing.id} className="cs-row">
                  <span className="sp-grow"><span className="sp-t1">{listing.item.title}</span><span className="sp-t2">{sellerText(listing)} · {pounds(listing.item.priceMinor)}</span></span>
                  <Chip tone="good">On sale</Chip>
                </div>
              ))}
              {onSale.length === 0 && <p className="cs-row sp-t2 m-0">Nothing on sale yet.</p>}
            </div>

            {notOnSale.length > 0 && (
              <>
                <h2 className="sp-sec">Not on sale <small>{notOnSale.length}</small></h2>
                <div className="sp-card">
                  {notOnSale.map((listing) => (
                    <div key={listing.id} className="cs-row">
                      <span className="sp-grow"><span className="sp-t1">{listing.item.title}</span><span className="sp-t2">{sellerText(listing)} · {pounds(listing.item.priceMinor)}</span></span>
                      <Chip tone={listing.status === 2 ? 'bad' : 'grey'}>{listing.status === 2 ? 'Declined' : 'Withdrawn'}</Chip>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )
      )}

      {view === 'orders' && (
        orders == null ? <p role="status" className="sp-note">Loading orders…</p> : (
          <>
            <h2 className="sp-sec">Orders <small>{orders.length}</small></h2>
            <div className="sp-card">
              {orders.map((order) => {
                const status = ORDER_STATUS[order.status];
                const canMarkPaid = !order.isTestOrder && order.status === 0;
                const canMarkRefunded = !order.isTestOrder && order.status === 2;
                return (
                  <div key={order.id} className="cs-row cs-stack">
                    <span className="cs-line">
                      <span className="sp-grow">
                        <span className="sp-t1">Order {order.id} · {order.buyerName || 'Buyer'}</span>
                        <span className="sp-t2">{order.lines.map(orderLineText).join(', ')}</span>
                      </span>
                      <span className="cs-right">
                        <span className="sp-price !text-[18px]">{pounds(order.totalMinor)}</span>
                        <Chip tone={status.tone}>{order.isTestOrder ? `Demo · ${status.text}` : status.text}</Chip>
                      </span>
                    </span>
                    {(canMarkPaid || canMarkRefunded) && (
                      <span className="cs-end">
                        {canMarkPaid && <button type="button" className="kit-pill kit-pill-fill cs-pill-s" disabled={busy} aria-label={`Mark order ${order.id} paid`} onClick={() => { void manualAction(order, 'manual-payment'); }}>Mark paid</button>}
                        {canMarkRefunded && <button type="button" className="kit-pill cs-pill-s" disabled={busy} aria-label={`Mark order ${order.id} refunded`} onClick={() => { void manualAction(order, 'manual-refund'); }}>Mark refunded</button>}
                      </span>
                    )}
                  </div>
                );
              })}
              {orders.length === 0 && <p className="cs-row sp-t2 m-0">No orders yet.</p>}
            </div>
          </>
        )
      )}

      {view === 'payments' && (
        settings == null ? <p role="status" className="sp-note">Loading…</p> : (
          <>
            <h2 className="sp-sec">Payments</h2>
            <div className="sp-card">
              <CardDropdownRow label="How people pay" value={settings.isDemo ? 'demo' : 'manual'} options={PAY_OPTIONS} disabled={busy || settings.isLocked}
                onChange={(value) => { if ((value === 'demo') !== settings.isDemo) void setDemo(value === 'demo'); }} />
            </div>
            <p className="sp-note">{settings.isLocked ? 'Fixed once anyone has ordered.' : 'Demo takes no money. Use it to try the shop.'}</p>
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
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <FormSheet title="Decline this item?" description={`${listing.item.title} from ${sellerText(listing)}. They see your reason.`} saveLabel="Decline" onClose={onClose} error={problem}
      onSave={async () => { const message = await onDecline(reason); setProblem(message); return message == null; }}>
      <SheetField label="Reason">
        <textarea rows={3} maxLength={500} placeholder="e.g. Only stabling and hook-ups at this event." value={reason} onChange={(event) => setReason(event.target.value)} />
      </SheetField>
    </FormSheet>
  );
}
