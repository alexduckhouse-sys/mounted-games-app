import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Chevron, RefineDisclosure, RefineHeader, RefineList, RefineNote, RefinePage, RefineSection, RefineSheet, RefineStatus, type StatusTone } from '../refine/Refine';
import { LoadError } from './commerceUi';
import { CATEGORY_LABEL, errorMessage, pounds } from './commerceFormat';
import type { CatalogueItem, CommerceItemCategory, CommerceListingStatus, CompetitionChoice, CompetitionChoicePage, CompetitionListing } from './types';
import './commerce.css';
import { SelectField } from '../../components/SelectField';

interface ItemForm {
  title: string;
  description: string;
  price: string;
  category: CommerceItemCategory;
  stock: string;
  imageUrl: string;
}

const EMPTY_FORM: ItemForm = { title: '', description: '', price: '', category: 0, stock: '', imageUrl: '' };
const PICKER_PAGE_SIZE = 50;
const MAX_PICKER_PAGES = 10_000;

/** Status word and colour for one event's listing of an item. */
const LISTING_STATUS: Record<CommerceListingStatus, { text: string; tone: StatusTone }> = {
  0: { text: 'Pending', tone: 'warn' },
  1: { text: 'Approved', tone: 'ok' },
  2: { text: 'Declined', tone: 'bad' },
  3: { text: 'Withdrawn', tone: 'mut' },
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
function itemSummary(item: CatalogueItem, listings: CompetitionListing[]) {
  if (!item.isActive) return { text: 'Archived', tone: 'mut' as StatusTone };
  if (listings.length === 0) return { text: 'Draft · not offered', tone: 'mut' as StatusTone };
  const pending = listings.filter((listing) => listing.status === 0).length;
  const declined = listings.filter((listing) => listing.status === 2).length;
  const live = listings.filter((listing) => listing.status === 0 || listing.status === 1).length;
  if (pending > 0) return { text: `${countText(live, 'event')} · ${pending} pending`, tone: 'warn' as StatusTone };
  if (declined > 0 && live === 0) return { text: `Declined at ${countText(declined, 'event')}`, tone: 'bad' as StatusTone };
  return { text: live === 0 ? 'Not offered' : countText(live, 'event'), tone: 'mut' as StatusTone };
}

export function SellerCataloguePage() {
  const { user } = useAuth();
  return <SellerCatalogueContent key={user?.id ?? 'signed-out'} />;
}

function SellerCatalogueContent() {
  const { user } = useAuth();
  const [items, setItems] = useState<CatalogueItem[] | null>(null);
  const [listings, setListings] = useState<CompetitionListing[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionChoice[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [sheet, setSheet] = useState<'add' | 'edit' | 'more' | null>(null);
  const [form, setForm] = useState<ItemForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

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
        setError(errorMessage(requestError, 'Couldn’t load your catalogue.'));
      });
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const listingsByItem = useMemo(() => {
    const grouped = new Map<number, CompetitionListing[]>();
    for (const listing of listings) grouped.set(listing.catalogueItemId, [...(grouped.get(listing.catalogueItemId) ?? []), listing]);
    return grouped;
  }, [listings]);

  const active = items?.find((item) => item.id === activeId) ?? null;

  /** Runs a write, then reloads. Returns whether it worked, so callers can close sheets or move on. */
  async function run<T>(action: () => Promise<T>, failure: string): Promise<{ ok: true; value: T } | { ok: false }> {
    setBusy(true);
    setError(null);
    try {
      const value = await action();
      await load();
      return { ok: true, value };
    } catch (requestError) {
      setError(errorMessage(requestError, failure));
      return { ok: false };
    } finally {
      setBusy(false);
    }
  }

  function openAdd() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setSheet('add');
  }

  function openEdit(item: CatalogueItem) {
    setForm({
      title: item.title,
      description: item.description,
      price: (item.priceMinor / 100).toFixed(2),
      category: item.category,
      stock: item.stockQuantity?.toString() ?? '',
      imageUrl: item.imageUrl ?? '',
    });
    setFormError(null);
    setSheet('edit');
  }

  /** Saves the form as a new item or as changes to the open one. Returns the saved item, or null if the form was invalid or the call failed. */
  async function save(): Promise<CatalogueItem | null> {
    const price = Number(form.price);
    const stock = form.stock.trim() === '' ? null : Number(form.stock);
    if (!form.title.trim() || !form.description.trim() || form.price.trim() === '' || !Number.isFinite(price) || price < 0 ||
      (stock !== null && (!Number.isInteger(stock) || stock < 0))) {
      setFormError('Add a name and description, then check the price and stock.');
      return null;
    }
    setFormError(null);
    const editing = sheet === 'edit' ? active : null;
    const body = {
      title: form.title.trim(),
      description: form.description.trim(),
      priceMinor: Math.round(price * 100),
      stockQuantity: stock,
      category: form.category,
      imageUrl: form.imageUrl.trim() || null,
      isActive: editing?.isActive ?? true,
      expectedVersion: editing?.version,
    };
    const result = await run(async () => {
      if (editing) return (await api.put<CatalogueItem>(`/commerce/catalogue/${editing.id}`, body)).data;
      return (await api.post<CatalogueItem>('/commerce/catalogue', body)).data;
    }, 'Couldn’t save the item.');
    if (!result.ok) return null;
    setSheet(null);
    return result.value ?? editing;
  }

  async function saveDraft(event: FormEvent) {
    event.preventDefault();
    await save();
  }

  async function saveAndChoose() {
    const saved = await save();
    if (saved?.id != null) setActiveId(saved.id);
  }

  if (!user) return <RefinePage><p className="rf-note py-6">Sign in to manage your event catalogue.</p></RefinePage>;

  if (active) {
    const itemListings = listingsByItem.get(active.id) ?? [];
    const offered = new Set(itemListings.filter((listing) => listing.status === 0 || listing.status === 1).map((listing) => listing.competitionId));
    const others = competitions.filter((competition) => !offered.has(competition.id));
    const nameOf = (id: number) => competitions.find((competition) => competition.id === id);
    return (
      <RefinePage>
        <RefineHeader
          onBack={() => setActiveId(null)}
          backLabel="Back to catalogue"
          context="Catalogue"
          actions={<button type="button" className="rf-ib" aria-label="More actions for this item" onClick={() => setSheet('more')}><MoreHorizontal className="h-5 w-5" aria-hidden="true" /></button>}
          title={active.title}
        />
        {error && <LoadError message={error} onRetry={() => void load()} />}
        <div className="mt-3">
          <RefineList label="Item details">
            <li>
              <button type="button" className="rf-row" onClick={() => openEdit(active)}>
                <span className="rf-grow">
                  <span className="rf-t1">{pounds(active.priceMinor)} · {CATEGORY_LABEL[active.category]}</span>
                  <span className="rf-t2">{active.stockQuantity == null ? 'Unlimited stock' : `${active.stockQuantity} available`}{!active.isActive && ' · Archived'}</span>
                </span>
                <span className="rf-st" style={{ color: 'rgb(var(--mg-heading))' }}>Edit</span>
              </button>
            </li>
          </RefineList>
        </div>

        <RefineSection title="Events for this item" />
        {itemListings.length === 0 ? <RefineNote>Not offered anywhere yet. Pick an event below.</RefineNote> : (
          <RefineList label="Events for this item">
            {itemListings.map((listing) => {
              const status = LISTING_STATUS[listing.status];
              const event = nameOf(listing.competitionId);
              const detail = event ? eventDate(event.startDate) : '';
              const row = (
                <>
                  <span className="rf-grow"><span className="rf-t1">{event?.name ?? `Event #${listing.competitionId}`}</span>{detail && <span className="rf-t2">{detail}</span>}</span>
                  <RefineStatus tone={status.tone}>{status.text}</RefineStatus>
                </>
              );
              if (listing.status === 2 && listing.reviewNote) {
                return (
                  <li key={listing.id}>
                    <details>
                      <summary className="rf-row">{row}<Chevron down /></summary>
                      <p className="rf-note px-4 pt-0">Organiser: “{listing.reviewNote}”</p>
                    </details>
                  </li>
                );
              }
              return (
                <li key={listing.id} className="rf-row">
                  {row}
                  {listing.status === 0 && <button type="button" className="rf-btn" disabled={busy} onClick={() => { if (window.confirm('Withdraw this listing?')) void run(() => api.delete(`/commerce/listings/${listing.id}`), 'Couldn’t withdraw the listing.'); }}>Withdraw</button>}
                </li>
              );
            })}
          </RefineList>
        )}

        {active.isActive && (
          <div className="mt-3 rf-list">
            <RefineDisclosure title="Offer at another event" defaultOpen={itemListings.length === 0}>
              {others.length === 0 ? <p className="rf-note px-4">There are no other upcoming events to choose from.</p> : (
                <ul className="m-0 list-none p-0">
                  {others.map((competition) => (
                    <li key={competition.id} className="rf-row" style={{ borderTop: '1px solid rgb(var(--mg-rule-soft))' }}>
                      <span className="rf-grow"><span className="rf-t1">{competition.name}</span><span className="rf-t2">{eventDate(competition.startDate)}</span></span>
                      <button type="button" className="rf-btn" disabled={busy} aria-label={`Request ${competition.name}`} onClick={() => void run(() => api.post(`/commerce/competitions/${competition.id}/listings`, { catalogueItemId: active.id }), 'Couldn’t send this item for approval.')}>Request</button>
                    </li>
                  ))}
                </ul>
              )}
            </RefineDisclosure>
          </div>
        )}
        <RefineNote>Each organiser approves items for their own event. Changing the price sends approved events back to pending.</RefineNote>

        {sheet === 'more' && (
          <RefineSheet title="This item" onClose={() => setSheet(null)}>
            <div className="flex flex-col gap-2">
              <button type="button" className="rf-btn rf-wide" onClick={() => openEdit(active)}>Edit details</button>
              {active.isActive
                ? <button type="button" className="rf-btn rf-wide" aria-label={`Archive ${active.title}`} disabled={busy} onClick={() => { if (!window.confirm(`Archive ${active.title}?`)) return; void run(() => api.delete(`/commerce/catalogue/${active.id}`), 'Couldn’t archive the item.').then((result) => { if (result.ok) setSheet(null); }); }}>Archive item</button>
                : <button type="button" className="rf-btn rf-wide" disabled={busy} onClick={() => void run(() => api.put(`/commerce/catalogue/${active.id}`, { title: active.title, description: active.description, priceMinor: active.priceMinor, stockQuantity: active.stockQuantity, category: active.category, imageUrl: active.imageUrl, isActive: true, expectedVersion: active.version }), 'Couldn’t restore the item. Refresh the catalogue and try again.').then((result) => { if (result.ok) setSheet(null); })}>Restore item</button>}
            </div>
          </RefineSheet>
        )}
        {sheet === 'edit' && <ItemSheet title="Edit item" form={form} setForm={setForm} busy={busy} error={formError ?? error} onClose={() => setSheet(null)} onSubmit={saveDraft} primaryLabel="Save changes" />}
      </RefinePage>
    );
  }

  return (
    <RefinePage>
      <RefineHeader
        context="Selling at events"
        actions={<button type="button" className="rf-btn" onClick={openAdd}>+ Add item</button>}
        title="Catalogue"
      />
      {error && <LoadError message={error} onRetry={() => void load()} />}
      <RefineNote>Items you can offer at any event. Each organiser approves them for their own event.</RefineNote>
      {items == null && !error && <p className="rf-note" role="status">Loading your catalogue…</p>}
      {items?.length === 0 && <p className="rf-note">Your catalogue is empty. Add an item once, then reuse it at future events.</p>}
      {items && items.length > 0 && (
        <RefineList label="Catalogue items">
          {items.map((item) => {
            const summary = itemSummary(item, listingsByItem.get(item.id) ?? []);
            return (
              <li key={item.id}>
                <button type="button" className="rf-row" aria-label={item.title} onClick={() => setActiveId(item.id)} style={item.isActive ? undefined : { opacity: 0.65 }}>
                  <span className="rf-grow"><span className="rf-t1">{item.title}</span><span className={`rf-t2 ${summary.tone === 'mut' ? '' : `rf-${summary.tone}`}`}>{summary.text}</span></span>
                  <span className="rf-price">{pounds(item.priceMinor)}</span>
                  <Chevron />
                </button>
              </li>
            );
          })}
        </RefineList>
      )}
      <RefineNote>Orders for your items appear under <Link to="/me/orders">Orders</Link>.</RefineNote>

      {sheet === 'add' && (
        <ItemSheet
          title="Add item"
          form={form}
          setForm={setForm}
          busy={busy}
          error={formError ?? error}
          onClose={() => setSheet(null)}
          onSubmit={saveDraft}
          primaryLabel="Save draft"
          onChoose={() => void saveAndChoose()}
        />
      )}
    </RefinePage>
  );
}

interface ItemSheetProps {
  title: string;
  form: ItemForm;
  setForm: (form: ItemForm) => void;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  primaryLabel: string;
  /** Adding only: save, then go straight to choosing events. */
  onChoose?: () => void;
}

function ItemSheet({ title, form, setForm, busy, error, onClose, onSubmit, primaryLabel, onChoose }: ItemSheetProps) {
  return (
    <RefineSheet title={title} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        <label className="rf-fld">Name<input maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="rf-fld">Price (£)<input inputMode="decimal" placeholder="12.00" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label>
          <label className="rf-fld">Category
            <SelectField value={form.category} onChange={(event) => setForm({ ...form, category: Number(event.target.value) as CommerceItemCategory })}>
              {([0, 1, 2, 3] as CommerceItemCategory[]).map((category) => <option key={category} value={category}>{CATEGORY_LABEL[category]}</option>)}
            </SelectField>
          </label>
        </div>
        <label className="rf-fld">Description<textarea rows={3} maxLength={4000} style={{ padding: 10 }} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <details>
          <summary className="rf-btn rf-btn-text" style={{ justifyContent: 'flex-start', padding: 0, listStyle: 'none' }}>+ Stock and image</summary>
          <div className="mt-2 flex flex-col gap-3">
            <label className="rf-fld">Stock <span className="font-normal">Blank means unlimited</span><input inputMode="numeric" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} /></label>
            <label className="rf-fld">Image link <span className="font-normal">Optional HTTPS link</span><input type="url" placeholder="https://…" value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} /></label>
          </div>
        </details>
        {error && <p role="alert" className="m-0 text-sm font-semibold text-[rgb(var(--mg-elim))]">{error}</p>}
        {onChoose && <p className="rf-note !py-0">You’ll choose events for this item after saving.</p>}
        <div className="rf-actions">
          <button type="submit" className={`rf-btn ${onChoose ? '' : 'rf-btn-primary rf-grow'}`} disabled={busy}>{busy ? 'Saving…' : primaryLabel}</button>
          {onChoose && <button type="button" className="rf-btn rf-btn-primary rf-grow" disabled={busy} onClick={onChoose}>Save and choose events</button>}
        </div>
      </form>
    </RefineSheet>
  );
}
