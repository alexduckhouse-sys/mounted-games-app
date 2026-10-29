import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingBag, Plus, Flag, Trash2, MessageCircle, Lock, X, Image as ImageIcon, Check, ChevronRight, SlidersHorizontal, ArrowUp } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { usePageWidth } from '../components/pageWidthState';
import { usePageHeader } from '../components/CompactPageBarContext';
import { LazyImage } from '../components/LazyImage';
import { logoSrc } from '../lib/sponsors';
import { RoundSearch } from '../components/RoundSearch';
import { Sheet } from '../components/Sheet';
import { useDockAction } from '../components/TickerContext';
import '../components/sitePages.css';
import '../components/eventPages.css';
import '../components/filterKit.css';
import { NO_SHOP_FILTERS, POSTED_OPTIONS, PRICE_BANDS, countShopFilters, matchesShopFilters, shopFilterChips, type ShopFilters } from '../lib/shopFilters';
import { NumberField } from '../components/NumberField';
import { priceLabel } from '../lib/money';
import type { CompetitionSummary, ShopComment, ShopPost } from '../types';
import { confirmDialog } from '../components/ConfirmDialog';
import { Notice } from '../components/Notice';
import { useToast } from '../components/Toast';
import { useT } from '../i18n/LanguageContext';
import { tr } from '../i18n/translate';

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return tr('site.shop.justNow');
  if (m < 60) return tr('site.shop.minAgo', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return tr('site.shop.hAgo', { count: h });
  const d = Math.floor(h / 24);
  if (d === 1) return tr('site.shop.yesterday');
  if (d < 7) return tr('site.shop.daysAgo', { count: d });
  return d < 14 ? tr('site.shop.lastWeek') : tr('site.shop.weeksAgo', { count: Math.floor(d / 7) });
}

/**
 * The shop: tack and kit listed by other Pony Clubbers, and a link to each event's own shop
 * (merchandise and add-ons, collected at the event). The same listings also appear inside each event's shop.
 */
export function ShopPage() {
  const t = useT();
  usePageWidth('wide');
  const [tab, setTab] = useState<'tack' | 'events'>('tack');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ShopFilters>(NO_SHOP_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);
  usePageHeader({ title: t('site.shop.title'), plain: true });
  const filterCount = countShopFilters(filters);
  const chips = shopFilterChips(filters);
  const clearFilter = (key: keyof ShopFilters) => setFilters((current) => ({ ...current, [key]: NO_SHOP_FILTERS[key] }));
  // The sheet sits outside the spaced column: a sibling margin would otherwise pull the dialog to the top of the screen.
  return (
    <>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-3.5 pb-2 lg:max-w-3xl">
        <div className="mg-band mg-band-header flex flex-col gap-2 pb-3 pt-3">
          <div className="mg-navy-switch w-full [&>*]:flex-1 [&>*]:justify-center" role="group" aria-label={t('site.shop.sections')}>
            <button type="button" aria-pressed={tab === 'tack'} onClick={() => setTab('tack')}>{t('site.shop.tackAndKit')}</button>
            <button type="button" aria-pressed={tab === 'events'} onClick={() => setTab('events')}>{t('site.shop.eventShops')}</button>
          </div>
          <div className="fk-find fk-band">
            <RoundSearch band label={t('site.shop.search')} placeholder={tab === 'tack' ? t('site.shop.searchTack') : t('site.shop.searchEvent')} value={query} onChange={setQuery} />
            {tab === 'tack' && (
              <button type="button" className="fk-fbtn" aria-haspopup="dialog" aria-label={filterCount ? t('site.shop.filterSet', { count: filterCount }) : t('site.shop.filter')} onClick={() => setSheetOpen(true)}>
                <SlidersHorizontal aria-hidden="true" className="h-5 w-5" />
                {filterCount > 0 && <span className="fk-count" aria-hidden="true">{filterCount}</span>}
              </button>
            )}
          </div>
        </div>
        {tab === 'tack' && chips.length > 0 && (
          <div className="fk-chips" role="group" aria-label={t('site.shop.filtersSet')}>
            {chips.map((chip) => (
              <button key={chip.key} type="button" className="fk-chip" aria-label={t('site.shop.removeChip', { label: chip.label })} onClick={() => clearFilter(chip.key)}>{chip.label}<X aria-hidden="true" size={15} strokeWidth={2.2} /></button>
            ))}
          </div>
        )}
        {tab === 'tack' ? <ShopClassifieds query={query} filters={filters} floatingSell intro="" /> : <EventShopLinks query={query} />}
      </div>
      {sheetOpen && tab === 'tack' && (
        <Sheet title={t('site.shop.filter')} className="fk-sheet" onClose={() => setSheetOpen(false)}>
          {({ close }) => (
            <>
              <div className="fk-group" role="group" aria-label={t('site.shop.price')}>
                <span className="fk-label" aria-hidden="true">{t('site.shop.price')}</span>
                <div className="fk-pills">
                  {PRICE_BANDS.map((band) => (
                    <button key={band.value} type="button" className="fk-pill" aria-pressed={filters.price === band.value} onClick={() => setFilters((current) => ({ ...current, price: band.value }))}>{band.label}</button>
                  ))}
                </div>
              </div>
              <div className="fk-group" role="group" aria-label={t('site.shop.posted')}>
                <span className="fk-label" aria-hidden="true">{t('site.shop.posted')}</span>
                <div className="fk-pills">
                  {POSTED_OPTIONS.map((option) => (
                    <button key={option.value} type="button" className="fk-pill" aria-pressed={filters.posted === option.value} onClick={() => setFilters((current) => ({ ...current, posted: option.value }))}>{option.label}</button>
                  ))}
                </div>
              </div>
              <div className="fk-group" role="group" aria-label={t('site.shop.photo')}>
                <span className="fk-label" aria-hidden="true">{t('site.shop.photo')}</span>
                <div className="fk-pills">
                  <button type="button" className="fk-pill" aria-pressed={filters.photoOnly} onClick={() => setFilters((current) => ({ ...current, photoOnly: !current.photoOnly }))}>{t('site.shop.withPhoto')}</button>
                </div>
              </div>
              <button type="button" className="kit-pill kit-pill-fill fk-show" onClick={() => close()}>{t('common.done')}</button>
            </>
          )}
        </Sheet>
      )}
    </>
  );
}

/** The events that are on or coming up, each with a link to its own shop. */
function EventShopLinks({ query }: { query: string }) {
  const t = useT();
  const [events, setEvents] = useState<CompetitionSummary[] | null>(null);
  // Only events with something on sale get a row; if the list of those can't be fetched, every live event is shown.
  const [withItems, setWithItems] = useState<Set<number> | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    api.get<CompetitionSummary[]>('/competitions')
      .then((r) => { if (!cancelled) setEvents(r.data.filter((c) => !c.isArchived)); })
      .catch(() => { if (!cancelled) setEvents([]); });
    api.get<number[]>('/commerce/competitions/with-items')
      .then((r) => { if (!cancelled) setWithItems(Array.isArray(r.data) ? new Set(r.data) : null); })
      .catch(() => { if (!cancelled) setWithItems(null); });
    return () => { cancelled = true; };
  }, []);
  const stocked = events && withItems !== undefined ? (withItems ? events.filter((event) => withItems.has(event.id)) : events) : null;
  const needle = query.trim().toLowerCase();
  const shown = stocked?.filter((event) => `${event.name} ${event.location ?? ''}`.toLowerCase().includes(needle)) ?? [];
  return (
    <section aria-labelledby="event-shops-title" className="mg-sec">
      <div className="mg-sec-head"><h2 id="event-shops-title">{t('site.shop.eventShops')}</h2></div>
      <p className="mg-meta px-0.5">{t('site.shop.eventIntro')}</p>
      {stocked === null ? <p role="status" className="mg-meta px-0.5">{t('site.shop.loadingEvents')}</p>
        : events?.length === 0 ? <p className="mg-card p-4">{t('site.shop.noEvents')}</p>
        : stocked.length === 0 ? <p className="mg-card p-4">{t('site.shop.noEventShops')}</p>
        : shown.length === 0 ? <p className="mg-card p-4">{t('site.shop.noEventMatch')}</p>
        : <ul className="mg-lines mg-lines-grid">
          {shown.map((event) => (
            <li key={event.id}>
              <Link to={`/competitions/${event.id}/shop`} className="mg-line grid-cols-[minmax(0,1fr)_14px] !min-h-14">
                <span className="flex min-w-0 flex-col gap-0.5"><strong className="mg-line-title">{event.name}</strong>{event.location && <span className="mg-line-sub">{event.location}</span>}</span>
                <ChevronRight className="h-3.5 w-3.5 text-[rgb(var(--mg-faint))]" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>}
    </section>
  );
}

/**
 * Buy, sell or swap tack and equipment. Used on the main shop page (searchable, with a Sell something button
 * pinned above the tabs) and inside each event's shop.
 */
export function ShopClassifieds({ intro, query = '', filters = NO_SHOP_FILTERS, floatingSell = false }: { intro?: string; query?: string; filters?: ShopFilters; floatingSell?: boolean }) {
  const t = useT();
  const { user, canEdit } = useAuth();
  const [posts, setPosts] = useState<ShopPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  // Bumping the version re-runs the fetch below; the initial load happens on mount.
  const [version, setVersion] = useState(0);
  function load() {
    setLoading(true);
    setVersion((v) => v + 1);
  }
  useEffect(() => {
    let cancelled = false;
    api.get<ShopPost[]>('/shop/posts', { params: { imageMode: 'urls' } })
      .then((r) => { if (!cancelled) setPosts(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { /* leave the list as it was; the page then shows its empty state */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [version]);

  const isAdmin = canEdit();
  const needle = query.trim().toLowerCase();
  const filtering = countShopFilters(filters) > 0;
  const shown = posts.filter((p) => (!needle || `${p.title} ${p.body} ${p.authorName} ${p.ponyClubName ?? ''}`.toLowerCase().includes(needle)) && matchesShopFilters(p, filters));
  const navigate = useNavigate();
  // "Sell something" is the round + beside the ticker dock; the new post opens in a sheet over the list.
  const docked = useDockAction(floatingSell ? { label: t('site.shop.sell'), icon: 'plus', onClick: () => (user ? setComposerOpen(true) : navigate('/login')) } : null);
  const inSheet = floatingSell && docked;
  const buttonClass = floatingSell ? 'sp-pill sp-pill-fill' : 'mg-btn mg-btn-primary !min-h-11 !px-3 !text-sm';
  const sell = user ? (
    <button type="button" onClick={() => setComposerOpen((v) => !v)} aria-expanded={composerOpen} className={buttonClass}>
      {composerOpen ? <X className="h-[18px] w-[18px]" aria-hidden="true" /> : <Plus className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />}{composerOpen ? t('common.cancel') : floatingSell ? t('site.shop.sell') : t('site.shop.newPost')}
    </button>
  ) : (
    <Link to="/login" className={buttonClass}>
      <Plus className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />{floatingSell ? t('site.shop.sell') : t('site.shop.signInToPost')}
    </Link>
  );

  return (
    <div className="flex flex-col gap-3">
      {(intro !== '' || !floatingSell) && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="mg-meta flex-1">{intro ?? t('site.shop.intro')}</p>
          {!floatingSell && sell}
        </div>
      )}

      {composerOpen && user && !inSheet && (
        <PostComposer onPosted={() => { setComposerOpen(false); load(); }} defaultName={user.fullName} />
      )}
      {composerOpen && user && inSheet && (
        <Sheet title={t('site.shop.newShopPost')} onClose={() => setComposerOpen(false)}>
          {({ close }) => <PostComposer bare onPosted={() => close(() => { setComposerOpen(false); load(); })} defaultName={user.fullName} />}
        </Sheet>
      )}

      {loading ? (
        <p role="status" className="mg-meta px-0.5">{t('site.shop.loadingPosts')}</p>
      ) : posts.length === 0 ? (
        <div className="mg-card p-6 text-center">
          <ShoppingBag className="mx-auto mb-2 h-8 w-8 text-[rgb(var(--mg-faint))]" aria-hidden="true" />
          <p className="mg-meta">{t('site.shop.empty')}</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="mg-card p-4">{filtering ? t('site.shop.noMatchFilters') : t('site.shop.noMatch')}</p>
      ) : (
        <ul className="sp-listings">
          {shown.map((p) => (
            <PostRow
              key={p.id}
              post={p}
              open={openId === p.id}
              onToggle={() => setOpenId(openId === p.id ? null : p.id)}
              isAdmin={isAdmin}
              currentUserId={user?.id ?? null}
              onChanged={load}
            />
          ))}
        </ul>
      )}
      {floatingSell && !docked && <div className="sp-sell-bar">{sell}</div>}
    </div>
  );
}

function PostComposer({ onPosted, defaultName, bare = false }: { onPosted: () => void; defaultName: string; bare?: boolean }) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [price, setPrice] = useState('');
  const [contact, setContact] = useState('');
  const [name, setName] = useState(defaultName);
  const [ponyClub, setPonyClub] = useState('');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageErr, setImageErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; retry: boolean } | null>(null);

  async function pickImage(file: File) {
    setImageErr(null);
    if (file.size > 2_000_000) {
      setImageErr(t('site.shop.imageTooBig'));
      return;
    }
    // Resize client-side to keep base64 manageable.
    const dataUrl = await resizeToDataUrl(file, 800);
    if (dataUrl.length > 700_000) {
      setImageErr(t('site.shop.imageStillBig'));
      return;
    }
    setImageBase64(dataUrl);
  }

  async function submit() {
    if (!title.trim() || !body.trim() || !name.trim()) {
      setErr({ text: t('site.shop.required'), retry: false });
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const priceMinor = price.trim() ? Math.round(parseFloat(price) * 100) : null;
      await api.post('/shop/posts', {
        title: title.trim(),
        body: body.trim(),
        priceMinor: priceMinor != null && Number.isFinite(priceMinor) ? priceMinor : null,
        contactInfo: contact.trim() || null,
        authorName: name.trim(),
        ponyClubName: ponyClub.trim() || null,
        imageBase64,
      });
      onPosted();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } | string } }).response?.data;
      setErr({ text: typeof msg === 'string' ? msg : msg?.message ?? t('site.shop.postFailed'), retry: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={bare ? 'space-y-2' : 'card p-4 space-y-2 border-l-4 border-brand-500'}>
      {!bare && <h2 className="font-semibold text-sm">{t('site.shop.newShopPost')}</h2>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs font-semibold">{t('site.shop.fieldTitle')}</span>
          <input className="input mt-1 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('site.shop.titlePlaceholder')} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold">{t('site.shop.fieldPrice')}</span>
          <NumberField decimal min={0} step="0.01" className="input mt-1 text-sm" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="25.00" />
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-semibold">{t('site.shop.fieldDescription')}</span>
        <textarea rows={3} className="input mt-1 text-sm" value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('site.shop.descriptionPlaceholder')} />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs font-semibold">{t('site.shop.fieldName')}</span>
          <input className="input mt-1 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold">{t('site.shop.fieldPonyClub')}</span>
          <input className="input mt-1 text-sm" value={ponyClub} onChange={(e) => setPonyClub(e.target.value)} />
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-semibold">{t('site.shop.fieldContact')}</span>
        <input className="input mt-1 text-sm" value={contact} onChange={(e) => setContact(e.target.value)} placeholder={t('site.shop.contactPlaceholder')} />
      </label>
      <div>
        <span className="text-xs font-semibold flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> {t('site.shop.fieldImage')}</span>
        <input
          type="file"
          accept="image/*"
          aria-label={t('site.shop.photo')}
          className="block mt-1 text-xs"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) pickImage(f); }}
        />
        {imageBase64 && (
          <div className="mt-2 relative inline-block">
            <img src={imageBase64} alt={t('site.shop.preview')} className="max-h-32 rounded-md border border-slate-200 dark:border-slate-700" />
            <button type="button" onClick={() => setImageBase64(null)} aria-label={t('site.shop.removePhoto')} className="sp-photo-x">
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {imageErr && <div className="mt-1"><Notice>{imageErr}</Notice></div>}
      </div>
      {err && <Notice actionLabel={err.retry ? t('common.tryAgain') : undefined} onAction={err.retry ? () => { void submit(); } : undefined} actionDisabled={busy}>{err.text}</Notice>}
      <div className="flex justify-end">
        <button onClick={submit} disabled={busy} className="btn-primary !py-1.5 !px-3 text-sm">
          <Check className="w-3.5 h-3.5" /> {busy ? t('site.shop.posting') : t('site.shop.post')}
        </button>
      </div>
    </div>
  );
}

function PostRow({
  post, open, onToggle, isAdmin, currentUserId, onChanged,
}: {
  post: ShopPost;
  open: boolean;
  onToggle: () => void;
  isAdmin: boolean;
  currentUserId: string | null;
  onChanged: () => void;
}) {
  const t = useT();
  const [showComments, setShowComments] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reported, setReported] = useState(false);
  const toast = useToast();
  const [sendingReport, setSendingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const ownPost = currentUserId != null && post.authorUserId === currentUserId;

  async function remove() {
    if (!(await confirmDialog({ title: t('site.shop.removeTitle'), message: t('site.shop.removeMessage'), confirmLabel: t('site.shop.removeLabel'), destructive: true }))) return;
    await api.delete(`/shop/posts/${post.id}`);
    onChanged();
  }
  async function submitReport() {
    if (sendingReport) return;
    setSendingReport(true);
    setReportError(null);
    try {
      await api.post(`/shop/posts/${post.id}/report`, { reason: reportReason.trim() || null });
      setReporting(false);
      setReportReason('');
      setReported(true);
      toast.show(t('site.shop.reported'));
    } catch {
      setReportError(t('site.shop.reportFailed'));
    } finally {
      setSendingReport(false);
    }
  }

  const where = [post.authorName, post.ponyClubName].filter(Boolean).join(' · ');
  return (
    <li className={`sp-listing ${post.isDeleted ? 'opacity-60' : ''}`.trim()}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="sp-listing-head">
        {post.imageBase64
          ? <LazyImage src={logoSrc(post.imageBase64, import.meta.env.VITE_API_BASE)} alt="" className="sp-thumb" compact />
          : <span role="img" aria-label={t('site.shop.noPhoto', { title: post.title })} className="sp-thumb"><ImageIcon className="h-[22px] w-[22px]" aria-hidden="true" /></span>}
        <span className="sp-grow !gap-1">
          <strong className="text-[17px] font-semibold leading-tight">{post.title}</strong>
          <span className="sp-t2 truncate">{where}</span>
          <span className="sp-t2 !text-[12.5px]">{timeAgo(post.createdAt)}{post.isDeleted ? ` · ${t('site.shop.removed')}` : ''}</span>
        </span>
        <span className="sp-price">{post.priceMinor != null ? priceLabel(post.priceMinor) : ''}</span>
      </button>
      {open && (
        <div className="mg-reveal space-y-2 border-t border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-subtle))] px-3 py-3">
          {post.imageBase64 && <LazyImage src={logoSrc(post.imageBase64, import.meta.env.VITE_API_BASE)} alt={post.title} className="max-h-60 w-full rounded-md object-cover" />}
          <p className="whitespace-pre-wrap text-sm">{post.body}</p>
          {post.contactInfo && <p className="mg-meta">{t('site.shop.contact', { info: post.contactInfo })}</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => setShowComments((v) => !v)} className="mg-small-btn gap-1.5">
              <MessageCircle className="h-4 w-4" aria-hidden="true" /> {showComments ? t('site.shop.hide') : t('site.shop.comments')}
              {post.commentCount > 0 && <span className="text-[rgb(var(--mg-muted))]">{post.commentCount}</span>}
            </button>
            <div className="ml-auto" />
            {!post.isDeleted && !ownPost && !reported && (
              <button type="button" onClick={() => { setReporting((v) => !v); setReportError(null); }} disabled={sendingReport} className="mg-small-btn gap-1.5"><Flag className="h-4 w-4" aria-hidden="true" /> {t('site.shop.report')}</button>
            )}
            {(isAdmin || ownPost) && !post.isDeleted && (
              <button onClick={remove} className="mg-small-btn gap-1.5 !text-[rgb(var(--mg-elim))]" aria-label={t('site.shop.removeLabel')}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
            )}
          </div>
          {reporting && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <input
                type="text"
                aria-label={t('site.shop.reportWhy')}
                placeholder={t('site.shop.reasonPlaceholder')}
                maxLength={1000}
                disabled={sendingReport}
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                className="input min-w-[180px] flex-1 text-sm"
              />
              <button type="button" disabled={sendingReport} onClick={() => { void submitReport(); }} className="mg-small-btn">{sendingReport ? t('site.shop.sending') : t('site.shop.sendReport')}</button>
              <button type="button" disabled={sendingReport} onClick={() => { setReporting(false); setReportReason(''); setReportError(null); }} className="mg-small-btn">{t('common.cancel')}</button>
              {reportError && <div className="w-full"><Notice actionLabel={t('common.tryAgain')} onAction={() => { void submitReport(); }} actionDisabled={sendingReport}>{reportError}</Notice></div>}
            </div>
          )}
          {toast.node}
          {showComments && <CommentThread postId={post.id} postAuthorId={post.authorUserId ?? null} currentUserId={currentUserId} />}
        </div>
      )}
    </li>
  );
}

function CommentThread({ postId, postAuthorId }: {
  postId: number; postAuthorId: string | null; currentUserId: string | null;
}) {
  const t = useT();
  const [comments, setComments] = useState<ShopComment[]>([]);
  const [body, setBody] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);

  function load() {
    api.get<ShopComment[]>(`/shop/posts/${postId}/comments`).then((r) => setComments(r.data)).catch(() => {});
  }
  useEffect(load, [postId]);

  const { user } = useAuth();

  async function submit() {
    if (!body.trim() || !user) return;
    setBusy(true);
    try {
      await api.post(`/shop/posts/${postId}/comments`, {
        body: body.trim(),
        authorName: user.fullName,
        isPrivate,
        toUserId: isPrivate ? postAuthorId : null,
      });
      setBody('');
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-700/60">
      <ul className="space-y-1.5 max-h-48 overflow-auto">
        {comments.length === 0 && (
          <li className="text-[11px] text-slate-500 italic">{t('site.shop.noComments')}</li>
        )}
        {comments.map((c) => (
          <li key={c.id} className={`text-xs ${c.isPrivate ? 'bg-[rgb(var(--mg-info-bg))] px-2 py-1 rounded-md' : ''}`}>
            <span className="font-semibold">{c.authorName}</span>
            {c.isPrivate && <Lock className="inline w-2.5 h-2.5 ml-1 text-[rgb(var(--mg-info-ink))]" />}
            <span className="ml-1.5 text-[11px] font-normal text-[rgb(var(--mg-faint))]">{timeAgo(c.createdAt)}</span>
            <p className="text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
      </ul>
      {user ? (
        <div className="flex items-center gap-1.5">
          <input
            className="input min-h-11 min-w-0 flex-1 !rounded-full !px-4 !text-base"
            aria-label={isPrivate ? t('site.shop.privateLabel') : t('site.shop.publicLabel')}
            placeholder={isPrivate ? t('site.shop.privatePlaceholder') : t('site.shop.publicPlaceholder')}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
          <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-1 px-1 text-xs text-[rgb(var(--mg-muted))]">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
            {t('site.shop.dm')}
          </label>
          <button type="button" onClick={submit} disabled={busy || !body.trim()} aria-label={t('site.shop.sendComment')} className="ev-send">
            <ArrowUp aria-hidden="true" className="h-5 w-5" strokeWidth={2.4} />
          </button>
        </div>
      ) : (
        <Link to="/login" className="text-xs text-brand-600 dark:text-brand-300 hover:underline">
          {t('site.shop.signInToComment')}
        </Link>
      )}
    </div>
  );
}

/** Read a File, draw to a canvas at max-side `maxPx`, return a JPEG data URL. */
async function resizeToDataUrl(file: File, maxPx: number): Promise<string> {
  const img = document.createElement('img');
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image-load-failed'));
      img.src = url;
    });
    const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
