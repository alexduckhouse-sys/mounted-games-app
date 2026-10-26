import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, Minus, Plus } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { CardDropdownRow } from '../../components/CardDropdownRow';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { confirmDialog } from '../../components/ConfirmDialog';
import { LazyImage } from '../../components/LazyImage';
import { NumberField } from '../../components/NumberField';
import { initialsOf } from '../../lib/profile';
import { Chip, FormSheet, SheetField, type ChipTone } from '../clubShop/ui';
import { LoadError } from './commerceUi';
import { errorMessage, pounds } from './commerceFormat';
import type { CatalogueItem, CommerceItemCategory, CommerceListingStatus, CompetitionChoice, CompetitionChoicePage, CompetitionListing } from './types';
import '../../components/sitePages.css';
import '../clubShop/clubShop.css';

interface ItemForm {
  title: string;
  description: string;
  price: string;
  category: CommerceItemCategory;
  /** 0 means "No limit". */
  stock: number;
  /** An item that has sold out keeps its 0 left until the stepper is touched. */
  soldOut: boolean;
  imageUrl: string;
}

const EMPTY_FORM: ItemForm = { title: '', description: '', price: '', category: 0, stock: 0, soldOut: false, imageUrl: '' };
const PICKER_PAGE_SIZE = 50;
const MAX_PICKER_PAGES = 10_000;

/** The category names the seller picks from. */
const CATEGORY_CHOICES: { value: CommerceItemCategory; label: string }[] = [
  { value: 0, label: 'Merchandise' },
  { value: 1, label: 'Tickets' },
  { value: 2, label: 'Camping and stabling' },
  { value: 3, label: 'Other' },
];
const categoryName = (category: CommerceItemCategory) => CATEGORY_CHOICES.find((c) => c.value === category)?.label ?? 'Other';

/** The word and colour for one event's listing of an item. */
const LISTING_STATUS: Record<CommerceListingStatus, { text: string; tone: ChipTone }> = {
  0: { text: 'Waiting', tone: 'warn' },
  1: { text: 'On sale', tone: 'good' },
  2: { text: 'Declined', tone: 'bad' },
  3: { text: 'Withdrawn', tone: 'grey' },
};

async function loadUpcomingCompetitions(): Promise<CompetitionChoice[]> {
  const choices: CompetitionChoice[] = [];
  for (let page = 1; page <= MAX_PICKER_PAGES; page += 1) {
    const { data } = await api.get<CompetitionChoicePage>('/competitions/picker', {
      params: { past: false, page, pageSize: PICKER_PAGE_SIZE },
    });
    for (const choice of data.items) {
      if (!choices.some((existing) => existing.id === choice.id)) choices.push(choice);
    }
    if (!data.hasMore) return choices;
  }
  throw new Error('The competition list is too large to load.');
}

const eventDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const countText = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** One-line summary of where an item is on offer. Colour is only used when something needs attention. */
function itemSummary(item: CatalogueItem, listings: CompetitionListing[]): { text: string; tone: 'amber' | 'red' | null } {
  if (!item.isActive) return { text: 'Archived', tone: null };
  if (listings.length === 0) return { text: 'Not offered anywhere', tone: null };
  const waiting = listings.filter((listing) => listing.status === 0).length;
  const declined = listings.filter((listing) => listing.status === 2).length;
  const live = listings.filter((listing) => listing.status === 0 || listing.status === 1).length;
  if (waiting > 0) return { text: `${countText(live, 'event')} · ${waiting} waiting`, tone: 'amber' };
  if (declined > 0 && live === 0) return { text: `Declined at ${countText(declined, 'event')}`, tone: 'red' };
  return { text: live === 0 ? 'Not offered anywhere' : countText(live, 'event'), tone: null };
}

const stockText = (item: CatalogueItem) => (item.stockQuantity == null ? 'No limit' : item.stockQuantity === 0 ? 'Sold out' : `${item.stockQuantity} left`);

export function SellerCataloguePage() {
  const { user } = useAuth();
  return <SellerCatalogueContent key={user?.id ?? 'signed-out'} />;
}

function SellerCatalogueContent() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<CatalogueItem[] | null>(null);
  const [listings, setListings] = useState<CompetitionListing[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionChoice[]>([]);
  const [sheet, setSheet] = useState<'add' | 'edit' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeId = Number(params.get('item')) || null;
  const active = items?.find((item) => item.id === activeId) ?? null;
  usePageHeader(active
    ? { title: active.title, plain: true, backTo: '/me/catalogue', backLabel: 'Back to things I sell' }
    : { title: 'Things I sell', plain: true, backTo: '/me', backLabel: 'Back to my profile' });

  const load = useCallback(() => {
    if (!user) return Promise.resolve();
    return Promise.all([
      api.get<CatalogueItem[]>('/commerce/catalogue'),
      api.get<CompetitionListing[]>('/commerce/listings/mine'),
      loadUpcomingCompetitions(),
    ])
      .then(([itemsResponse, listingsResponse, competitionChoices]) => {
        setError(null);
        setItems(itemsResponse.data);
        setListings(listingsResponse.data);
        setCompetitions(competitionChoices);
      })
      .catch((requestError: unknown) => {
        setError(errorMessage(requestError, 'Couldn’t load your items. Check your signal and try again.'));
      });
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const listingsByItem = useMemo(() => {
    const grouped = new Map<number, CompetitionListing[]>();
    for (const listing of listings) grouped.set(listing.catalogueItemId, [...(grouped.get(listing.catalogueItemId) ?? []), listing]);
    return grouped;
  }, [listings]);

  /** Runs a write, then reloads. Returns whether it worked, so callers can close sheets or move on. */
  async function run<T>(action: () => Promise<T>, failure: string): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
    setBusy(true);
    setError(null);
    try {
      const value = await action();
      await load();
      return { ok: true, value };
    } catch (requestError) {
      const message = errorMessage(requestError, failure);
      setError(message);
      return { ok: false, message };
    } finally {
      setBusy(false);
    }
  }

  /** Saves the sheet as a new item or as changes to the open one. Returns a problem to show, or null when it saved. */
  async function save(form: ItemForm, editing: CatalogueItem | null): Promise<string | null> {
    const price = Number(form.price);
    if (!form.title.trim() || !form.description.trim() || form.price.trim() === '' || !Number.isFinite(price) || price < 0) {
      return 'Add a name and description, then check the price.';
    }
    const body = {
      title: form.title.trim(),
      description: form.description.trim(),
      priceMinor: Math.round(price * 100),
      stockQuantity: form.soldOut ? 0 : form.stock === 0 ? null : form.stock,
      category: form.category,
      imageUrl: form.imageUrl.trim() || null,
      isActive: editing?.isActive ?? true,
      expectedVersion: editing?.version,
    };
    const result = await run(async () => {
      if (editing) return (await api.put<CatalogueItem>(`/commerce/catalogue/${editing.id}`, body)).data;
      return (await api.post<CatalogueItem>('/commerce/catalogue', body)).data;
    }, 'Couldn’t save the item. Check your signal and try again.');
    if (!result.ok) return result.message;
    // A new item opens on its own page, ready to be offered at an event.
    if (!editing && result.value?.id != null) setParams({ item: String(result.value.id) });
    return null;
  }

  async function withdraw(listing: CompetitionListing) {
    if (!(await confirmDialog({ title: 'Withdraw this listing?', message: 'Buyers stop seeing it in the shop.', confirmLabel: 'Withdraw listing', destructive: true }))) return;
    await run(() => api.delete(`/commerce/listings/${listing.id}`), 'Couldn’t withdraw the listing. Check your signal and try again.');
  }

  async function offer(item: CatalogueItem, competition: CompetitionChoice) {
    await run(() => api.post(`/commerce/competitions/${competition.id}/listings`, { catalogueItemId: item.id }), `Couldn’t offer this at ${competition.name}. Check your signal and try again.`);
  }

  async function archive(item: CatalogueItem) {
    if (!(await confirmDialog({ title: 'Archive this item?', message: `${item.title} is hidden from your items. You can bring it back later.`, confirmLabel: 'Archive item', destructive: true }))) return;
    await run(() => api.delete(`/commerce/catalogue/${item.id}`), 'Couldn’t archive the item. Check your signal and try again.');
  }

  async function restore(item: CatalogueItem) {
    await run(() => api.put(`/commerce/catalogue/${item.id}`, {
      title: item.title, description: item.description, priceMinor: item.priceMinor, stockQuantity: item.stockQuantity,
      category: item.category, imageUrl: item.imageUrl, isActive: true, expectedVersion: item.version,
    }), 'Couldn’t bring the item back. Refresh and try again.');
  }

  if (!user) return <div className="skin cs-page"><p className="sp-note">Sign in to manage the things you sell.</p></div>;

  const problem = error && <div className="cs-gap"><LoadError message={error} onRetry={() => void load()} /></div>;

  if (activeId != null && items == null && !error) return <div className="skin cs-page"><p className="sp-note" role="status">Loading…</p></div>;

  if (active) {
    const itemListings = listingsByItem.get(active.id) ?? [];
    const withListing = new Set(itemListings.map((listing) => listing.competitionId));
    const notOffered = competitions.filter((competition) => !withListing.has(competition.id));
    const nameOf = (id: number) => competitions.find((competition) => competition.id === id);
    return (
      <div className="skin cs-page">
        <h1 className="sr-only">{active.title}</h1>
        {problem}
        <h2 className="sp-sec">Details</h2>
        <div className="sp-card">
          <div className="sp-row"><span className="sp-t1 sp-grow">Price</span><span className="sp-val">{pounds(active.priceMinor)}</span></div>
          <div className="sp-row"><span className="sp-t1 sp-grow">Category</span><span className="sp-val">{categoryName(active.category)}</span></div>
          <div className="sp-row"><span className="sp-t1 sp-grow">Stock</span><span className="sp-val">{stockText(active)}</span></div>
          <button type="button" className="sp-add cs-addbar cs-addbar-plain" disabled={busy} onClick={() => setSheet('edit')}>Edit details</button>
        </div>

        <h2 className="sp-sec">Events</h2>
        <div className="sp-card">
          {itemListings.map((listing) => {
            const status = LISTING_STATUS[listing.status];
            const event = nameOf(listing.competitionId);
            const eventName = event?.name ?? `Event ${listing.competitionId}`;
            return (
              <div key={listing.id} className="cs-row cs-row-wrap">
                <span className="sp-grow"><span className="sp-t1">{eventName}</span>{event && <span className="sp-t2">{eventDate(event.startDate)}</span>}</span>
                <Chip tone={status.tone}>{status.text}</Chip>
                {listing.status === 0 && (
                  <button type="button" className="kit-redtext cs-redtext-s" disabled={busy} aria-label={`Withdraw from ${eventName}`} onClick={() => { void withdraw(listing); }}>Withdraw</button>
                )}
                {active.isActive && (listing.status === 2 || listing.status === 3) && event && (
                  <button type="button" className="kit-pill cs-pill-s" disabled={busy} aria-label={`Offer at ${eventName}`} onClick={() => { void offer(active, event); }}>Offer here</button>
                )}
                {listing.status === 2 && listing.reviewNote && <span className="sp-t2 cs-note-red">Organiser: {listing.reviewNote}</span>}
              </div>
            );
          })}
          {notOffered.map((competition) => (
            <div key={competition.id} className="cs-row cs-row-wrap">
              <span className="sp-grow"><span className="sp-t1">{competition.name}</span><span className="sp-t2">{eventDate(competition.startDate)}</span></span>
              <Chip tone="grey">Not offered</Chip>
              {active.isActive && (
                <button type="button" className="kit-pill cs-pill-s" disabled={busy} aria-label={`Offer at ${competition.name}`} onClick={() => { void offer(active, competition); }}>Offer here</button>
              )}
            </div>
          ))}
          {itemListings.length === 0 && notOffered.length === 0 && <p className="cs-row sp-t2 m-0">No upcoming events.</p>}
        </div>

        <div className="kit-acts cs-gap">
          {active.isActive
            ? <button type="button" className="kit-redtext" disabled={busy} onClick={() => { void archive(active); }}>Archive this item</button>
            : <button type="button" className="kit-redtext" disabled={busy} onClick={() => { void restore(active); }}>Bring it back</button>}
        </div>

        {sheet === 'edit' && <ItemSheet item={active} onSave={(form) => save(form, active)} onClose={() => setSheet(null)} />}
      </div>
    );
  }

  return (
    <div className="skin cs-page">
      <h1 className="sr-only">Things I sell</h1>
      {problem}
      {items == null && !error && <p className="sp-note" role="status">Loading your items…</p>}
      {items && (
        <>
          <h2 className="sp-sec">Your items <small>{items.length}</small></h2>
          <div className="sp-card">
            {items.map((item) => {
              const summary = itemSummary(item, listingsByItem.get(item.id) ?? []);
              return (
                <button key={item.id} type="button" className={`sp-row${item.isActive ? '' : ' cs-faded'}`} aria-label={item.title} onClick={() => setParams({ item: String(item.id) })}>
                  {item.imageUrl
                    ? <LazyImage src={item.imageUrl} alt="" compact className="cs-ava cs-thumb" />
                    : <span aria-hidden="true" className="cs-ava cs-thumb">{initialsOf(item.title)}</span>}
                  <span className="sp-grow">
                    <span className="sp-t1">{item.title}</span>
                    <span className={`sp-t2${summary.tone === 'amber' ? ' cs-amber' : summary.tone === 'red' ? ' cs-red' : ''}`}>{summary.text}</span>
                  </span>
                  <span className="sp-price !text-[18px]">{pounds(item.priceMinor)}</span>
                  <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
                </button>
              );
            })}
            <button type="button" className="sp-add cs-addbar" onClick={() => setSheet('add')}><Plus aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={2.75} />Add an item</button>
          </div>
        </>
      )}
      {sheet === 'add' && <ItemSheet item={null} onSave={(form) => save(form, null)} onClose={() => setSheet(null)} />}
    </div>
  );
}

const STABLING_PRESETS: { label: string; title: string; category: CommerceItemCategory; description: string; defaultPrice: string }[] = [
  { label: 'Weekend stabling', title: 'Weekend stabling', category: 2, description: 'Temporary event stable box for the weekend. Collect stable allocation from the secretary on arrival.', defaultPrice: '65.00' },
  { label: 'Electric hook-up', title: 'Electric hook-up', category: 2, description: '16A lorry or caravan electric hook-up pitch for the event weekend.', defaultPrice: '45.00' },
  { label: 'Shavings bale', title: 'Shavings bale', category: 2, description: 'Dust-extracted wood shavings bale for event stabling. Collect at the stable compound.', defaultPrice: '10.00' },
  { label: 'Haylage bale', title: 'Haylage bale', category: 2, description: 'Small bale of haylage for event stabling. Collect at the stable compound.', defaultPrice: '12.00' },
];

function formFor(item: CatalogueItem | null): ItemForm {
  if (!item) return EMPTY_FORM;
  return {
    title: item.title,
    description: item.description,
    price: (item.priceMinor / 100).toFixed(2),
    category: item.category,
    stock: item.stockQuantity ?? 0,
    soldOut: item.stockQuantity === 0,
    imageUrl: item.imageUrl ?? '',
  };
}

/** Add an item, or edit one. A new item can start from a stabling preset. */
function ItemSheet({ item, onSave, onClose }: { item: CatalogueItem | null; onSave: (form: ItemForm) => Promise<string | null>; onClose: () => void }) {
  const [form, setForm] = useState<ItemForm>(() => formFor(item));
  const [preset, setPreset] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const change = (patch: Partial<ItemForm>) => { setForm((current) => ({ ...current, ...patch })); setProblem(null); };

  function startFrom(label: string) {
    setPreset(label);
    const found = STABLING_PRESETS.find((p) => p.label === label);
    if (found) change({ title: found.title, category: found.category, description: found.description, price: form.price.trim() || found.defaultPrice });
  }

  const stockLabel = form.soldOut ? 'Sold out' : form.stock === 0 ? 'No limit' : String(form.stock);
  return (
    <FormSheet title={item ? 'Edit item' : 'Add an item'} saveLabel={item ? 'Save' : 'Add'} onClose={onClose} error={problem}
      onSave={async () => { const message = await onSave(form); setProblem(message); return message == null; }}>
      {!item && (
        <div className="sp-card">
          <CardDropdownRow label="Start from" value={preset} options={[{ value: '', label: 'Blank' }, ...STABLING_PRESETS.map((p) => ({ value: p.label, label: p.label }))]} onChange={startFrom} />
        </div>
      )}
      <SheetField label="Name">
        <input maxLength={200} placeholder="e.g. Weekend stabling" value={form.title} onChange={(event) => change({ title: event.target.value })} />
      </SheetField>
      <SheetField label="Price (£)">
        <NumberField decimal min={0} step="0.01" placeholder="0.00" value={form.price} onChange={(event) => change({ price: event.target.value })} />
      </SheetField>
      <div className="cs-sheet-row">
        <span id="stock-label">Stock</span>
        <span className="sp-stepper" role="group" aria-labelledby="stock-label">
          <button type="button" aria-label="Less stock" disabled={!form.soldOut && form.stock === 0} onClick={() => change({ stock: Math.max(0, form.stock - 1), soldOut: false })}><Minus aria-hidden="true" className="h-4 w-4" /></button>
          <output aria-live="polite">{stockLabel}</output>
          <button type="button" aria-label="More stock" onClick={() => change({ stock: form.soldOut ? 1 : form.stock + 1, soldOut: false })}><Plus aria-hidden="true" className="h-4 w-4" /></button>
        </span>
      </div>
      <div className="sp-card">
        <CardDropdownRow label="Category" value={String(form.category)} options={CATEGORY_CHOICES.map((c) => ({ value: String(c.value), label: c.label }))}
          onChange={(value) => change({ category: Number(value) as CommerceItemCategory })} />
      </div>
      <SheetField label="Description">
        <textarea rows={3} maxLength={4000} placeholder="What buyers get" value={form.description} onChange={(event) => change({ description: event.target.value })} />
      </SheetField>
      <SheetField label="Image link (optional)">
        <input type="url" placeholder="https://…" value={form.imageUrl} onChange={(event) => change({ imageUrl: event.target.value })} />
      </SheetField>
    </FormSheet>
  );
}
