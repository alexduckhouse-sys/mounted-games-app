import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, Minus, Plus, X } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { CardDropdownRow } from '../../components/CardDropdownRow';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { confirmDialog } from '../../components/ConfirmDialog';
import { LazyImage } from '../../components/LazyImage';
import { NumberField } from '../../components/NumberField';
import { useDockAction } from '../../components/TickerContext';
import { useLanguage, useT } from '../../i18n/LanguageContext';
import type { Translate } from '../../i18n/translate';
import { initialsOf } from '../../lib/profile';
import { optionInputsFrom, optionsBody, optionsFromText, optionsProblem } from '../../lib/shopOptions';
import type { CatalogueItemOptionInput } from '../../types';
import { Chip, FormSheet, SheetField, type ChipTone } from '../clubShop/ui';
import { LoadError } from './commerceUi';
import { errorMessage, pounds } from './commerceFormat';
import type { CatalogueItem, CommerceItemCategory, CommerceListingStatus, CompetitionChoice, CompetitionChoicePage, CompetitionListing } from './types';
import '../../components/sitePages.css';
import '../clubShop/clubShop.css';
import './commerce.css';

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
  /** What the buyer is asked for with this item ("Stable number"), and the example shown in the box. */
  detailPrompt: string;
  detailHint: string;
  /** The item's options (sizes). Existing ones keep their id so their sales stay with them. */
  options: CatalogueItemOptionInput[];
  /** Options typed but not added yet; they are added on save too. */
  optionText: string;
}

const EMPTY_FORM: ItemForm = { title: '', description: '', price: '', category: 0, stock: 0, soldOut: false, imageUrl: '', detailPrompt: '', detailHint: '', options: [], optionText: '' };
const PICKER_PAGE_SIZE = 50;
const MAX_PICKER_PAGES = 10_000;

/** The category names the seller picks from. */
const CATEGORY_VALUES: CommerceItemCategory[] = [0, 1, 2, 3];
const categoryName = (t: Translate, category: CommerceItemCategory) => t(
  category === 0 ? 'site.seller.cat.merchandise' : category === 1 ? 'site.seller.cat.tickets' : category === 2 ? 'site.seller.cat.camping' : 'site.seller.cat.other',
);

/** The word and colour for one event's listing of an item. */
const LISTING_TONE: Record<CommerceListingStatus, ChipTone> = { 0: 'warn', 1: 'good', 2: 'bad', 3: 'grey' };
const listingText = (t: Translate, status: CommerceListingStatus) => t(
  status === 0 ? 'site.seller.status.waiting' : status === 1 ? 'site.seller.status.onSale' : status === 2 ? 'site.seller.status.declined' : 'site.seller.status.withdrawn',
);

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

const eventDate = (iso: string, locale: string) => new Date(iso).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });

/** One-line summary of where an item is on offer. Colour is only used when something needs attention. */
function itemSummary(t: Translate, item: CatalogueItem, listings: CompetitionListing[]): { text: string; tone: 'amber' | 'red' | null } {
  if (!item.isActive) return { text: t('site.seller.archived'), tone: null };
  if (listings.length === 0) return { text: t('site.seller.notOfferedAnywhere'), tone: null };
  const waiting = listings.filter((listing) => listing.status === 0).length;
  const declined = listings.filter((listing) => listing.status === 2).length;
  const live = listings.filter((listing) => listing.status === 0 || listing.status === 1).length;
  if (waiting > 0) return { text: t('site.seller.eventsWaiting', { count: live, waiting }), tone: 'amber' };
  if (declined > 0 && live === 0) return { text: t('site.seller.declinedAt', { count: declined }), tone: 'red' };
  return { text: live === 0 ? t('site.seller.notOfferedAnywhere') : t('site.seller.eventCount', { count: live }), tone: null };
}

const stockText = (t: Translate, item: CatalogueItem) => (item.stockQuantity == null ? t('site.seller.noLimit') : item.stockQuantity === 0 ? t('site.seller.soldOut') : t('site.seller.left', { count: item.stockQuantity }));

export function SellerCataloguePage() {
  const { user } = useAuth();
  return <SellerCatalogueContent key={user?.id ?? 'signed-out'} />;
}

function SellerCatalogueContent() {
  const t = useT();
  const { locale } = useLanguage();
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
    ? { title: active.title, plain: true, backTo: '/me/catalogue', backLabel: t('site.seller.backList') }
    : { title: t('site.seller.title'), plain: true, backTo: '/me', backLabel: t('site.seller.backProfile') });

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
        setError(errorMessage(requestError, t('site.seller.loadFailed')));
      });
  }, [user, t]);

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
      return t('site.seller.fillIn');
    }
    const options = optionsFromText(form.optionText, form.options);
    const optionIssue = optionsProblem(options);
    if (optionIssue) return optionIssue;
    const body = {
      title: form.title.trim(),
      description: form.description.trim(),
      priceMinor: Math.round(price * 100),
      stockQuantity: form.soldOut ? 0 : form.stock === 0 ? null : form.stock,
      category: form.category,
      imageUrl: form.imageUrl.trim() || null,
      detailPrompt: form.detailPrompt.trim() || null,
      // A hint with no question has nowhere to show.
      detailHint: form.detailPrompt.trim() ? form.detailHint.trim() || null : null,
      options: optionsBody(options),
      isActive: editing?.isActive ?? true,
      expectedVersion: editing?.version,
    };
    const result = await run(async () => {
      if (editing) return (await api.put<CatalogueItem>(`/commerce/catalogue/${editing.id}`, body)).data;
      return (await api.post<CatalogueItem>('/commerce/catalogue', body)).data;
    }, t('site.seller.saveFailed'));
    if (!result.ok) return result.message;
    // A new item opens on its own page, ready to be offered at an event.
    if (!editing && result.value?.id != null) setParams({ item: String(result.value.id) });
    return null;
  }

  async function withdraw(listing: CompetitionListing) {
    if (!(await confirmDialog({ title: t('site.seller.withdrawTitle'), message: t('site.seller.withdrawMessage'), confirmLabel: t('site.seller.withdrawConfirm'), destructive: true }))) return;
    await run(() => api.delete(`/commerce/listings/${listing.id}`), t('site.seller.withdrawFailed'));
  }

  async function offer(item: CatalogueItem, competition: CompetitionChoice) {
    await run(() => api.post(`/commerce/competitions/${competition.id}/listings`, { catalogueItemId: item.id }), t('site.seller.offerFailed', { name: competition.name }));
  }

  async function archive(item: CatalogueItem) {
    if (!(await confirmDialog({ title: t('site.seller.archiveTitle'), message: t('site.seller.archiveMessage', { title: item.title }), confirmLabel: t('site.seller.archiveConfirm'), destructive: true }))) return;
    await run(() => api.delete(`/commerce/catalogue/${item.id}`), t('site.seller.archiveFailed'));
  }

  async function restore(item: CatalogueItem) {
    await run(() => api.put(`/commerce/catalogue/${item.id}`, {
      title: item.title, description: item.description, priceMinor: item.priceMinor, stockQuantity: item.stockQuantity,
      category: item.category, imageUrl: item.imageUrl, detailPrompt: item.detailPrompt ?? null, detailHint: item.detailHint ?? null, isActive: true, expectedVersion: item.version,
    }), t('site.seller.restoreFailed'));
  }

  // "Add an item" is the round + beside the ticker dock; without a dock the old bar stays under the list.
  const docked = useDockAction(user && activeId == null ? { label: t('site.seller.addItem'), icon: 'plus', onClick: () => setSheet('add') } : null);

  if (!user) return <div className="skin cs-page"><p className="sp-note">{t('site.seller.signIn')}</p></div>;

  const problem = error && <div className="cs-gap"><LoadError message={error} onRetry={() => void load()} /></div>;

  if (activeId != null && items == null && !error) return <div className="skin cs-page"><p className="sp-note" role="status">{t('site.seller.loading')}</p></div>;

  if (active) {
    const itemListings = listingsByItem.get(active.id) ?? [];
    const withListing = new Set(itemListings.map((listing) => listing.competitionId));
    const notOffered = competitions.filter((competition) => !withListing.has(competition.id));
    const nameOf = (id: number) => competitions.find((competition) => competition.id === id);
    return (
      <div className="skin cs-page">
        <h1 className="sr-only">{active.title}</h1>
        {problem}
        <h2 className="sp-sec">{t('site.seller.details')}</h2>
        <div className="sp-card">
          <div className="sp-row"><span className="sp-t1 sp-grow">{t('site.seller.price')}</span><span className="sp-val">{pounds(active.priceMinor)}</span></div>
          <div className="sp-row"><span className="sp-t1 sp-grow">{t('site.seller.category')}</span><span className="sp-val">{categoryName(t, active.category)}</span></div>
          <div className="sp-row"><span className="sp-t1 sp-grow">{t('site.seller.stock')}</span><span className="sp-val">{stockText(t, active)}</span></div>
          {(active.options?.length ?? 0) > 0 && (
            <div className="sp-row"><span className="sp-t1 sp-grow">{t('site.seller.options')}</span><span className="sp-val">{active.options?.map((option) => option.label).join(', ')}</span></div>
          )}
          <button type="button" className="sp-add cs-addbar cs-addbar-plain" disabled={busy} onClick={() => setSheet('edit')}>{t('site.seller.editDetails')}</button>
        </div>

        <h2 className="sp-sec">{t('site.seller.events')}</h2>
        <div className="sp-card">
          {itemListings.map((listing) => {
            const event = nameOf(listing.competitionId);
            const eventName = event?.name ?? t('site.seller.eventN', { id: listing.competitionId });
            return (
              <div key={listing.id} className="cs-row cs-row-wrap">
                <span className="sp-grow"><span className="sp-t1">{eventName}</span>{event && <span className="sp-t2">{eventDate(event.startDate, locale)}</span>}</span>
                <Chip tone={LISTING_TONE[listing.status]}>{listingText(t, listing.status)}</Chip>
                {listing.status === 0 && (
                  <button type="button" className="kit-redtext cs-redtext-s" disabled={busy} aria-label={t('site.seller.withdrawFrom', { name: eventName })} onClick={() => { void withdraw(listing); }}>{t('site.seller.withdraw')}</button>
                )}
                {active.isActive && (listing.status === 2 || listing.status === 3) && event && (
                  <button type="button" className="kit-pill cs-pill-s" disabled={busy} aria-label={t('site.seller.offerAt', { name: eventName })} onClick={() => { void offer(active, event); }}>{t('site.seller.offerHere')}</button>
                )}
                {listing.status === 2 && listing.reviewNote && <span className="sp-t2 cs-note-red">{t('site.seller.organiserNote', { note: listing.reviewNote })}</span>}
              </div>
            );
          })}
          {notOffered.map((competition) => (
            <div key={competition.id} className="cs-row cs-row-wrap">
              <span className="sp-grow"><span className="sp-t1">{competition.name}</span><span className="sp-t2">{eventDate(competition.startDate, locale)}</span></span>
              <Chip tone="grey">{t('site.seller.notOffered')}</Chip>
              {active.isActive && (
                <button type="button" className="kit-pill cs-pill-s" disabled={busy} aria-label={t('site.seller.offerAt', { name: competition.name })} onClick={() => { void offer(active, competition); }}>{t('site.seller.offerHere')}</button>
              )}
            </div>
          ))}
          {itemListings.length === 0 && notOffered.length === 0 && <p className="cs-row sp-t2 m-0">{t('site.seller.noUpcoming')}</p>}
        </div>

        <div className="kit-acts cs-gap">
          {active.isActive
            ? <button type="button" className="kit-redtext" disabled={busy} onClick={() => { void archive(active); }}>{t('site.seller.archive')}</button>
            : <button type="button" className="kit-redtext" disabled={busy} onClick={() => { void restore(active); }}>{t('site.seller.bringBack')}</button>}
        </div>

        {sheet === 'edit' && <ItemSheet item={active} onSave={(form) => save(form, active)} onClose={() => setSheet(null)} />}
      </div>
    );
  }

  return (
    <div className="skin cs-page">
      <h1 className="sr-only">{t('site.seller.title')}</h1>
      {problem}
      {items == null && !error && <p className="sp-note" role="status">{t('site.seller.loadingItems')}</p>}
      {items && (
        <>
          <h2 className="sp-sec">{t('site.seller.yourItems')} <small>{items.length}</small></h2>
          <div className="sp-card">
            {items.map((item) => {
              const summary = itemSummary(t, item, listingsByItem.get(item.id) ?? []);
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
            {!docked && <button type="button" className="sp-add cs-addbar" onClick={() => setSheet('add')}><Plus aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={2.75} />{t('site.seller.addItem')}</button>}
          </div>
        </>
      )}
      {sheet === 'add' && <ItemSheet item={null} onSave={(form) => save(form, null)} onClose={() => setSheet(null)} />}
    </div>
  );
}

const STABLING_PRESETS: { id: string; category: CommerceItemCategory; defaultPrice: string }[] = [
  { id: 'stabling', category: 2, defaultPrice: '65.00' },
  { id: 'electric', category: 2, defaultPrice: '45.00' },
  { id: 'shavings', category: 2, defaultPrice: '10.00' },
  { id: 'haylage', category: 2, defaultPrice: '12.00' },
];
const PRESET_TEXT = {
  stabling: ['site.seller.preset.stabling', 'site.seller.preset.stablingText'],
  electric: ['site.seller.preset.electric', 'site.seller.preset.electricText'],
  shavings: ['site.seller.preset.shavings', 'site.seller.preset.shavingsText'],
  haylage: ['site.seller.preset.haylage', 'site.seller.preset.haylageText'],
} as const;

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
    detailPrompt: item.detailPrompt ?? '',
    detailHint: item.detailHint ?? '',
    options: optionInputsFrom(item.options),
    optionText: '',
  };
}

/** Add an item, or edit one. A new item can start from a stabling preset. */
function ItemSheet({ item, onSave, onClose }: { item: CatalogueItem | null; onSave: (form: ItemForm) => Promise<string | null>; onClose: () => void }) {
  const t = useT();
  const [form, setForm] = useState<ItemForm>(() => formFor(item));
  const [preset, setPreset] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const change = (patch: Partial<ItemForm>) => { setForm((current) => ({ ...current, ...patch })); setProblem(null); };

  function startFrom(id: string) {
    setPreset(id);
    const found = STABLING_PRESETS.find((p) => p.id === id);
    if (found) {
      const [titleKey, textKey] = PRESET_TEXT[found.id as keyof typeof PRESET_TEXT];
      change({ title: t(titleKey), category: found.category, description: t(textKey), price: form.price.trim() || found.defaultPrice });
    }
  }

  function addTyped() {
    if (!form.optionText.trim()) return;
    change({ options: optionsFromText(form.optionText, form.options), optionText: '' });
  }

  const optionsIssue = form.options.length > 0 || form.optionText.trim() ? optionsProblem(optionsFromText(form.optionText, form.options)) : null;

  const stockLabel = form.soldOut ? t('site.seller.soldOut') : form.stock === 0 ? t('site.seller.noLimit') : String(form.stock);
  return (
    <FormSheet title={item ? t('site.seller.editItem') : t('site.seller.addItem')} saveLabel={item ? t('common.save') : t('site.seller.add')} onClose={onClose} error={problem}
      onSave={async () => { const message = await onSave(form); setProblem(message); return message == null; }}>
      {!item && (
        <div className="sp-card">
          <CardDropdownRow label={t('site.seller.startFrom')} value={preset} options={[{ value: '', label: t('site.seller.blank') }, ...STABLING_PRESETS.map((p) => ({ value: p.id, label: t(PRESET_TEXT[p.id as keyof typeof PRESET_TEXT][0]) }))]} onChange={startFrom} />
        </div>
      )}
      <SheetField label={t('site.seller.name')}>
        <input maxLength={200} placeholder={t('site.seller.namePlaceholder')} value={form.title} onChange={(event) => change({ title: event.target.value })} />
      </SheetField>
      <SheetField label={t('site.seller.priceLabel')}>
        <NumberField decimal min={0} step="0.01" placeholder="0.00" value={form.price} onChange={(event) => change({ price: event.target.value })} />
      </SheetField>
      <div className="cs-sheet-row">
        <span id="stock-label">{t('site.seller.stock')}</span>
        <span className="sp-stepper" role="group" aria-labelledby="stock-label">
          <button type="button" aria-label={t('site.seller.lessStock')} disabled={!form.soldOut && form.stock === 0} onClick={() => change({ stock: Math.max(0, form.stock - 1), soldOut: false })}><Minus aria-hidden="true" className="h-4 w-4" /></button>
          <output aria-live="polite">{stockLabel}</output>
          <button type="button" aria-label={t('site.seller.moreStock')} onClick={() => change({ stock: form.soldOut ? 1 : form.stock + 1, soldOut: false })}><Plus aria-hidden="true" className="h-4 w-4" /></button>
        </span>
      </div>
      <div className="sp-card">
        <CardDropdownRow label={t('site.seller.category')} value={String(form.category)} options={CATEGORY_VALUES.map((c) => ({ value: String(c), label: categoryName(t, c) }))}
          onChange={(value) => change({ category: Number(value) as CommerceItemCategory })} />
      </div>
      <SheetField label={t('site.seller.description')}>
        <textarea rows={3} maxLength={4000} placeholder={t('site.seller.descriptionPlaceholder')} value={form.description} onChange={(event) => change({ description: event.target.value })} />
      </SheetField>
      <SheetField label={t('site.seller.askBuyer')} hint={t('site.seller.askBuyerHint')}>
        <input maxLength={60} value={form.detailPrompt} onChange={(event) => change({ detailPrompt: event.target.value })} />
      </SheetField>
      {form.detailPrompt.trim() !== '' && (
        <SheetField label={t('site.seller.hintLabel')}>
          <input maxLength={80} placeholder={t('site.seller.hintPlaceholder')} value={form.detailHint} onChange={(event) => change({ detailHint: event.target.value })} />
        </SheetField>
      )}
      <SheetField label={t('site.seller.optionsLabel')} hint={t('site.seller.optionsHint')}>
        <input maxLength={400} placeholder={t('site.seller.optionsPlaceholder')} value={form.optionText} aria-describedby="option-chips"
          onChange={(event) => change({ optionText: event.target.value })}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTyped(); } }} />
      </SheetField>
      <div className="seller-opt-add">
        <button type="button" className="kit-pill cs-pill-s" disabled={!form.optionText.trim()} onClick={addTyped}>{t('site.seller.addOptions')}</button>
      </div>
      {form.options.length > 0 && (
        <ul id="option-chips" className="seller-opt-chips" aria-label={t('site.seller.optionsFor')}>
          {form.options.map((option, index) => (
            <li key={option.id ?? `new-${index}`} className="seller-opt-chip">
              <span>{option.stockQuantity != null ? t('site.seller.optionLeft', { label: option.label, count: option.stockQuantity }) : option.label}</span>
              <button type="button" aria-label={t('site.seller.removeOption', { label: option.label })} onClick={() => change({ options: form.options.filter((_, i) => i !== index) })}>
                <X aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {optionsIssue && <p role="alert" className="cs-field-error m-0">{optionsIssue}</p>}
      <SheetField label={t('site.seller.imageLink')}>
        <input type="url" placeholder="https://…" value={form.imageUrl} onChange={(event) => change({ imageUrl: event.target.value })} />
      </SheetField>
    </FormSheet>
  );
}
