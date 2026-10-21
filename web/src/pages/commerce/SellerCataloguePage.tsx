import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Archive, ArrowLeft, CalendarRange, Edit3, PackagePlus, RotateCcw, Send } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { LazyImage } from '../../components/LazyImage';
import { LoadError, StatusPill } from './commerceUi';
import { CATEGORY_LABEL, LISTING_LABEL, errorMessage, pounds } from './commerceFormat';
import type { CatalogueItem, CommerceItemCategory, CompetitionChoice, CompetitionChoicePage, CompetitionListing } from './types';
import './commerce.css';

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

export function SellerCataloguePage() {
  const { user } = useAuth();
  return <SellerCatalogueContent key={user?.id ?? 'signed-out'} />;
}

function SellerCatalogueContent() {
  const { user } = useAuth();
  const [items, setItems] = useState<CatalogueItem[] | null>(null);
  const [listings, setListings] = useState<CompetitionListing[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionChoice[]>([]);
  const [view, setView] = useState<'catalogue' | 'form' | 'events'>('catalogue');
  const [activeItem, setActiveItem] = useState<CatalogueItem | null>(null);
  const [editing, setEditing] = useState<CatalogueItem | null>(null);
  const [form, setForm] = useState<ItemForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  function beginAdd() {
    setEditing(null);
    setActiveItem(null);
    setForm(EMPTY_FORM);
    setView('form');
  }

  function beginEdit(item: CatalogueItem) {
    setEditing(item);
    setActiveItem(item);
    setForm({
      title: item.title,
      description: item.description,
      price: (item.priceMinor / 100).toFixed(2),
      category: item.category,
      stock: item.stockQuantity?.toString() ?? '',
      imageUrl: item.imageUrl ?? '',
    });
    setView('form');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const price = Number(form.price);
    const stock = form.stock.trim() === '' ? null : Number(form.stock);
    if (!form.title.trim() || !form.description.trim() || !Number.isFinite(price) || price < 0 ||
      (stock !== null && (!Number.isInteger(stock) || stock < 0))) {
      setError('Add a title and description, then check the price and stock.');
      return;
    }
    setBusy(true);
    setError(null);
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
    try {
      if (editing) await api.put(`/commerce/catalogue/${editing.id}`, body);
      else await api.post('/commerce/catalogue', body);
      setView('catalogue');
      setEditing(null);
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError, 'Couldn’t save the item.'));
    } finally {
      setBusy(false);
    }
  }

  async function submit(item: CatalogueItem, competitionId: number) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/commerce/competitions/${competitionId}/listings`, { catalogueItemId: item.id });
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError, 'Couldn’t send this item for approval.'));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(listingId: number) {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/commerce/listings/${listingId}`);
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError, 'Couldn’t withdraw the listing.'));
    } finally {
      setBusy(false);
    }
  }

  async function archive(itemId: number) {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/commerce/catalogue/${itemId}`);
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError, 'Couldn’t archive the item.'));
    } finally {
      setBusy(false);
    }
  }

  async function reactivate(item: CatalogueItem) {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/commerce/catalogue/${item.id}`, {
        title: item.title,
        description: item.description,
        priceMinor: item.priceMinor,
        stockQuantity: item.stockQuantity,
        category: item.category,
        imageUrl: item.imageUrl,
        isActive: true,
        expectedVersion: item.version,
      });
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError, 'Couldn’t restore the item. Refresh the catalogue and try again.'));
    } finally {
      setBusy(false);
    }
  }

  const listingsByItem = useMemo(() => {
    const grouped = new Map<number, CompetitionListing[]>();
    for (const listing of listings) grouped.set(listing.catalogueItemId, [...(grouped.get(listing.catalogueItemId) ?? []), listing]);
    return grouped;
  }, [listings]);

  if (!user) {
    return <div className="skin mg-card p-5">Sign in to manage your event catalogue.</div>;
  }

  if (view === 'form') {
    return (
      <div className="skin commerce-page mx-auto w-full max-w-3xl pb-6">
        <button type="button" className="commerce-back" disabled={busy} onClick={() => setView('catalogue')}><ArrowLeft className="h-4 w-4" /> Back to catalogue</button>
        <header className="commerce-title-block">
          <p className="mg-eyebrow">Your catalogue</p>
          <h1 className="mg-h1">{editing ? `Edit ${editing.title}` : 'Add an item'}</h1>
          <p className="mg-lede">Save the details once, then choose which events should offer it.</p>
        </header>
        {error && <LoadError message={error} onRetry={() => void load()} />}
        <form className="flex flex-col gap-4" onSubmit={(event) => void save(event)}>
          <label className="flex flex-col gap-1 text-sm font-semibold">Title<input required maxLength={200} className="input min-h-11" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">Description<textarea required maxLength={4000} rows={4} className="input" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">Price in GBP<input required inputMode="decimal" className="input min-h-11" placeholder="12.00" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label>
            <label className="flex flex-col gap-1 text-sm font-semibold">Category<select className="input min-h-11" value={form.category} onChange={(event) => setForm({ ...form, category: Number(event.target.value) as CommerceItemCategory })}>{([0, 1, 2, 3] as CommerceItemCategory[]).map((category) => <option key={category} value={category}>{CATEGORY_LABEL[category]}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-sm font-semibold">Stock <span className="font-normal text-[rgb(var(--mg-muted))]">Blank means unlimited</span><input inputMode="numeric" min="0" className="input min-h-11" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} /></label>
          </div>
          <label className="flex flex-col gap-1 text-sm font-semibold">Image URL <span className="font-normal text-[rgb(var(--mg-muted))]">Optional HTTPS link</span><input type="url" className="input min-h-11" placeholder="https://…" value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} /></label>
          <div className="commerce-inline-actions">
            <button className="mg-btn mg-btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add to catalogue'}</button>
            <button type="button" className="mg-btn mg-btn-secondary" disabled={busy} onClick={() => setView('catalogue')}>Cancel</button>
          </div>
        </form>
      </div>
    );
  }

  if (view === 'events' && activeItem) {
    const itemListings = listingsByItem.get(activeItem.id) ?? [];
    return (
      <div className="skin commerce-page mx-auto w-full max-w-3xl pb-6">
        <button type="button" className="commerce-back" onClick={() => setView('catalogue')}><ArrowLeft className="h-4 w-4" /> Back to catalogue</button>
        <header className="commerce-title-block">
          <p className="mg-eyebrow">Offer at events</p>
          <h1 className="mg-h1">{activeItem.title}</h1>
          <p className="mg-lede">Choose an event. Its organiser must approve the item before it appears in the shop.</p>
        </header>
        {error && <LoadError message={error} onRetry={() => void load()} />}
        <div className="commerce-item-strip">
          <div><strong>{pounds(activeItem.priceMinor)}</strong><span>{CATEGORY_LABEL[activeItem.category]}</span></div>
          <span>{activeItem.stockQuantity == null ? 'Unlimited stock' : `${activeItem.stockQuantity} available`}</span>
        </div>
        {competitions.length === 0 ? <p className="mg-card p-5">There are no upcoming events to choose from.</p> : (
          <section className="commerce-rows" aria-label={`Events for ${activeItem.title}`}>
            {competitions.map((competition) => {
              const listing = itemListings.find((entry) => entry.competitionId === competition.id);
              const canRequest = !listing || listing.status === 2 || listing.status === 3;
              return (
                <article key={competition.id} className="commerce-event-row">
                  <div className="min-w-0 flex-1">
                    <h2 className="commerce-row-title">{competition.name}</h2>
                    <p className="mg-meta">{new Date(competition.startDate).toLocaleDateString()}</p>
                  </div>
                  {listing && <StatusPill tone={listing.status === 1 ? 'good' : listing.status === 0 ? 'warn' : 'neutral'}>{LISTING_LABEL[listing.status]}</StatusPill>}
                  {canRequest ? (
                    <button type="button" className="commerce-compact-button commerce-compact-button--primary" disabled={busy || !activeItem.isActive} onClick={() => void submit(activeItem, competition.id)}><Send className="h-4 w-4" /> Request</button>
                  ) : listing.status === 0 ? (
                    <button type="button" className="commerce-compact-button" disabled={busy} onClick={() => void withdraw(listing.id)}>Withdraw</button>
                  ) : null}
                </article>
              );
            })}
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="skin commerce-page mx-auto w-full max-w-3xl pb-6">
      <div className="flex flex-wrap items-start gap-3">
        <header className="commerce-title-block min-w-0 flex-1"><p className="mg-eyebrow">Selling at events</p><h1 className="mg-h1">Your catalogue</h1><p className="mg-lede">Add an item once, then offer it at any upcoming event.</p></header>
        <button type="button" className="mg-btn mg-btn-primary" onClick={beginAdd}><PackagePlus className="h-5 w-5" /> Add item</button>
      </div>

      {error && <LoadError message={error} onRetry={() => void load()} />}

      {items == null && !error && <p className="mg-card p-4" role="status">Loading your catalogue…</p>}
      {items?.length === 0 && <p className="mg-card p-5">Your catalogue is empty. Add an item once, then reuse it at future events.</p>}
      {items && items.length > 0 && (
        <section className="commerce-rows" aria-label="Catalogue items">
          {items.map((item) => {
            const itemListings = listingsByItem.get(item.id) ?? [];
            return (
              <article key={item.id} className={`commerce-catalogue-row ${item.isActive ? '' : 'opacity-60'}`}>
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  {item.imageUrl ? <LazyImage className="commerce-catalogue-image" src={item.imageUrl} alt="" compact /> : <div className="commerce-catalogue-image commerce-product-image--empty" aria-hidden="true"><PackagePlus className="h-5 w-5" /></div>}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><h2 className="mg-h2">{item.title}</h2>{!item.isActive && <StatusPill>Archived</StatusPill>}</div>
                    <p className="commerce-row-description">{item.description}</p>
                    <p className="mt-1 text-sm font-bold text-[rgb(var(--mg-heading))]">{pounds(item.priceMinor)} <span className="font-normal text-[rgb(var(--mg-muted))]">· {CATEGORY_LABEL[item.category]} · {item.stockQuantity == null ? 'Unlimited' : `${item.stockQuantity} left`}</span></p>
                </div>
                </div>
                <div className="commerce-inline-actions">
                  {item.isActive && <button type="button" className="commerce-compact-button commerce-compact-button--primary" onClick={() => { setActiveItem(item); setView('events'); }}><CalendarRange className="h-4 w-4" /> Events{itemListings.length > 0 ? ` (${itemListings.length})` : ''}</button>}
                  <button type="button" className="commerce-compact-button" aria-label={`Edit ${item.title}`} onClick={() => beginEdit(item)}><Edit3 className="h-4 w-4" /> Edit</button>
                  {item.isActive ? <button type="button" className="commerce-compact-button" aria-label={`Archive ${item.title}`} disabled={busy} onClick={() => void archive(item.id)}><Archive className="h-4 w-4" /> Archive</button>
                    : <button type="button" className="commerce-compact-button" disabled={busy} onClick={() => void reactivate(item)}><RotateCcw className="h-4 w-4" /> Restore</button>}
                  </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
