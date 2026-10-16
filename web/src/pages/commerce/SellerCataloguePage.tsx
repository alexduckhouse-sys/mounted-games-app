import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Archive, Edit3, PackagePlus, RotateCcw, Send, X } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { LoadError, PageHeader, StatusPill } from './commerceUi';
import { CATEGORY_LABEL, LISTING_LABEL, errorMessage, pounds } from './commerceFormat';
import type { CatalogueItem, CommerceItemCategory, CompetitionChoice, CompetitionChoicePage, CompetitionListing } from './types';

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
  const [selectedCompetition, setSelectedCompetition] = useState<number | ''>('');
  const [editing, setEditing] = useState<CatalogueItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
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
      setSelectedCompetition((current) =>
        competitionChoices.some((choice) => choice.id === current) ? current : competitionChoices[0]?.id || '');
      })
      .catch((requestError: unknown) => {
      setError(errorMessage(requestError, 'Couldn’t load your catalogue.'));
      });
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  function beginAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function beginEdit(item: CatalogueItem) {
    setEditing(item);
    setForm({
      title: item.title,
      description: item.description,
      price: (item.priceMinor / 100).toFixed(2),
      category: item.category,
      stock: item.stockQuantity?.toString() ?? '',
      imageUrl: item.imageUrl ?? '',
    });
    setFormOpen(true);
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
      setFormOpen(false);
      setEditing(null);
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError, 'Couldn’t save the item.'));
    } finally {
      setBusy(false);
    }
  }

  async function submit(item: CatalogueItem) {
    if (!selectedCompetition) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/commerce/competitions/${selectedCompetition}/listings`, { catalogueItemId: item.id });
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

  return (
    <div className="skin mx-auto flex w-full max-w-3xl flex-col gap-5 pb-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1"><PageHeader title="Seller catalogue">Keep your items here, then send them to the events where you want to sell them.</PageHeader></div>
        <button type="button" className="mg-btn mg-btn-primary" onClick={beginAdd}><PackagePlus className="h-5 w-5" /> Add item</button>
      </div>

      {error && <LoadError message={error} onRetry={() => void load()} />}

      {formOpen && (
        <form className="mg-card flex flex-col gap-4 border-2 !border-[rgb(var(--mg-heading))] p-4" onSubmit={(event) => void save(event)}>
          <div className="flex items-center gap-2">
            <h2 className="mg-h2 flex-1">{editing ? 'Edit item' : 'Add an item'}</h2>
            <button type="button" className="mg-icon-btn" aria-label="Close item form" onClick={() => setFormOpen(false)}><X className="h-5 w-5" /></button>
          </div>
          <label className="flex flex-col gap-1 text-sm font-semibold">Title<input required maxLength={200} className="input min-h-11" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">Description<textarea required maxLength={4000} rows={4} className="input" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">Price in GBP<input required inputMode="decimal" className="input min-h-11" placeholder="12.00" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label>
            <label className="flex flex-col gap-1 text-sm font-semibold">Category<select className="input min-h-11" value={form.category} onChange={(event) => setForm({ ...form, category: Number(event.target.value) as CommerceItemCategory })}>{([0, 1, 2, 3] as CommerceItemCategory[]).map((category) => <option key={category} value={category}>{CATEGORY_LABEL[category]}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-sm font-semibold">Stock <span className="font-normal text-[rgb(var(--mg-muted))]">Leave blank for unlimited</span><input inputMode="numeric" min="0" className="input min-h-11" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} /></label>
          </div>
          <label className="flex flex-col gap-1 text-sm font-semibold">Image URL <span className="font-normal text-[rgb(var(--mg-muted))]">Optional HTTPS link</span><input type="url" className="input min-h-11" placeholder="https://…" value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} /></label>
          <button className="mg-btn mg-btn-primary self-start" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add to catalogue'}</button>
        </form>
      )}

      <section className="mg-card flex flex-col gap-3 p-4" aria-labelledby="event-picker-title">
        <h2 id="event-picker-title" className="mg-h2">Choose an event</h2>
        <p className="mg-meta">Items need organiser approval before they appear in an event shop.</p>
        <label className="mg-field">
          <span className="sr-only">Competition</span>
          <select value={selectedCompetition} onChange={(event) => setSelectedCompetition(Number(event.target.value))}>
            {competitions.length === 0 && <option value="">No upcoming competitions</option>}
            {competitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}
          </select>
        </label>
      </section>

      {items == null && !error && <p className="mg-card p-4" role="status">Loading your catalogue…</p>}
      {items?.length === 0 && <p className="mg-card p-5">Your catalogue is empty. Add an item once, then reuse it at future events.</p>}
      {items && items.length > 0 && (
        <section className="mg-card mg-list" aria-label="Catalogue items">
          {items.map((item) => {
            const itemListings = listingsByItem.get(item.id) ?? [];
            const chosenListing = itemListings.find((listing) => listing.competitionId === selectedCompetition);
            return (
              <article key={item.id} className={`flex flex-col gap-3 p-4 ${item.isActive ? '' : 'opacity-60'}`}>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><h2 className="mg-h2">{item.title}</h2>{!item.isActive && <StatusPill>Archived</StatusPill>}</div>
                    <p className="mt-1 text-sm text-[rgb(var(--mg-body))]">{item.description}</p>
                    <p className="mt-1 text-sm font-bold text-[rgb(var(--mg-heading))]">{pounds(item.priceMinor)} · {CATEGORY_LABEL[item.category]} · {item.stockQuantity == null ? 'Unlimited stock' : `${item.stockQuantity} available`}</p>
                  </div>
                  <button type="button" className="mg-icon-btn" aria-label={`Edit ${item.title}`} onClick={() => beginEdit(item)}><Edit3 className="h-4 w-4" /></button>
                  {item.isActive && <button type="button" className="mg-icon-btn" aria-label={`Archive ${item.title}`} disabled={busy} onClick={() => void archive(item.id)}><Archive className="h-4 w-4" /></button>}
                  {!item.isActive && <button type="button" className="mg-btn mg-btn-secondary" disabled={busy} onClick={() => void reactivate(item)}><RotateCcw className="h-4 w-4" /> Restore item</button>}
                </div>
                {itemListings.length > 0 && (
                  <ul className="flex flex-wrap gap-2" aria-label="Event listing status">
                    {itemListings.map((listing) => <li key={listing.id}><StatusPill tone={listing.status === 1 ? 'good' : listing.status === 0 ? 'warn' : 'neutral'}>{competitions.find((competition) => competition.id === listing.competitionId)?.name ?? `Event ${listing.competitionId}`}: {LISTING_LABEL[listing.status]}</StatusPill></li>)}
                  </ul>
                )}
                {item.isActive && selectedCompetition && (
                  <div className="flex flex-wrap gap-2">
                    {!chosenListing || chosenListing.status === 2 || chosenListing.status === 3 ? (
                      <button type="button" className="mg-btn mg-btn-primary" disabled={busy} onClick={() => void submit(item)}><Send className="h-4 w-4" /> Request approval</button>
                    ) : chosenListing.status === 0 ? (
                      <button type="button" className="mg-btn mg-btn-secondary" disabled={busy} onClick={() => void withdraw(chosenListing.id)}>Withdraw request</button>
                    ) : <StatusPill tone="good">Listed in this event</StatusPill>}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
