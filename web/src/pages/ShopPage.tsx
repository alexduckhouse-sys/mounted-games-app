import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag, Plus, Flag, Trash2, MessageCircle, Lock, X, Send, Image as ImageIcon, Check, ChevronRight } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { usePageWidth } from '../components/pageWidthState';
import { usePageHeader } from '../components/CompactPageBarContext';
import { LazyImage } from '../components/LazyImage';
import { RoundSearch } from '../components/RoundSearch';
import '../components/sitePages.css';
import { NumberField } from '../components/NumberField';
import { priceLabel } from '../lib/money';
import type { CompetitionSummary, ShopComment, ShopPost } from '../types';
import { confirmDialog } from '../components/ConfirmDialog';

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  return d < 14 ? 'Last week' : `${Math.floor(d / 7)} weeks ago`;
}

/**
 * The shop: tack and kit listed by other Pony Clubbers, and a link to each event's own shop
 * (merchandise and add-ons, collected at the event). The same listings also appear inside each event's shop.
 */
export function ShopPage() {
  usePageWidth('wide');
  const [tab, setTab] = useState<'tack' | 'events'>('tack');
  const [query, setQuery] = useState('');
  usePageHeader({ title: 'Shop', plain: true });
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3.5 pb-2 lg:max-w-3xl">
      <div className="mg-band mg-band-header flex flex-col gap-2 pb-3 pt-0">
        <div className="mg-navy-switch self-start" role="group" aria-label="Shop sections">
          <button type="button" aria-pressed={tab === 'tack'} onClick={() => setTab('tack')}>Tack and kit</button>
          <button type="button" aria-pressed={tab === 'events'} onClick={() => setTab('events')}>Event shops</button>
        </div>
        <RoundSearch band label="Search the shop" placeholder={tab === 'tack' ? 'Saddle, bending poles, 13.2…' : 'Event name'} value={query} onChange={setQuery} />
      </div>
      {tab === 'tack' ? <ShopClassifieds query={query} floatingSell intro="" /> : <EventShopLinks query={query} />}
    </div>
  );
}

/** The events that are on or coming up, each with a link to its own shop. */
function EventShopLinks({ query }: { query: string }) {
  const [events, setEvents] = useState<CompetitionSummary[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.get<CompetitionSummary[]>('/competitions')
      .then((r) => { if (!cancelled) setEvents(r.data.filter((c) => !c.isArchived)); })
      .catch(() => { if (!cancelled) setEvents([]); });
    return () => { cancelled = true; };
  }, []);
  const needle = query.trim().toLowerCase();
  const shown = events?.filter((event) => `${event.name} ${event.location ?? ''}`.toLowerCase().includes(needle)) ?? [];
  return (
    <section aria-labelledby="event-shops-title" className="mg-sec">
      <div className="mg-sec-head"><h2 id="event-shops-title">Event shops</h2></div>
      <p className="mg-meta px-0.5">Merchandise and add-ons from the organisers, collected at the event.</p>
      {events === null ? <p role="status" className="mg-meta px-0.5">Loading events…</p>
        : events.length === 0 ? <p className="mg-card p-4">No events to shop for right now.</p>
        : shown.length === 0 ? <p className="mg-card p-4">No event shops match that search.</p>
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
export function ShopClassifieds({ intro = 'Buy, sell or swap tack and equipment with other Pony Clubbers.', query = '', floatingSell = false }: { intro?: string; query?: string; floatingSell?: boolean }) {
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
    api.get<ShopPost[]>('/shop/posts')
      .then((r) => { if (!cancelled) setPosts(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { /* leave the list as it was; the page then shows its empty state */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [version]);

  const isAdmin = canEdit();
  const needle = query.trim().toLowerCase();
  const shown = needle ? posts.filter((p) => `${p.title} ${p.body} ${p.authorName} ${p.ponyClubName ?? ''}`.toLowerCase().includes(needle)) : posts;
  const buttonClass = floatingSell ? 'sp-pill sp-pill-fill' : 'mg-btn mg-btn-primary !min-h-11 !px-3 !text-sm';
  const sell = user ? (
    <button type="button" onClick={() => setComposerOpen((v) => !v)} aria-expanded={composerOpen} className={buttonClass}>
      {composerOpen ? <X className="h-[18px] w-[18px]" aria-hidden="true" /> : <Plus className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />}{composerOpen ? 'Cancel' : floatingSell ? 'Sell something' : 'New post'}
    </button>
  ) : (
    <Link to="/login" className={buttonClass}>
      <Plus className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />{floatingSell ? 'Sell something' : 'Sign in to post'}
    </Link>
  );

  return (
    <div className="flex flex-col gap-3">
      {(intro || !floatingSell) && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="mg-meta flex-1">{intro}</p>
          {!floatingSell && sell}
        </div>
      )}

      {composerOpen && user && (
        <PostComposer onPosted={() => { setComposerOpen(false); load(); }} defaultName={user.fullName} />
      )}

      {loading ? (
        <p role="status" className="mg-meta px-0.5">Loading posts…</p>
      ) : posts.length === 0 ? (
        <div className="mg-card p-6 text-center">
          <ShoppingBag className="mx-auto mb-2 h-8 w-8 text-[rgb(var(--mg-faint))]" aria-hidden="true" />
          <p className="mg-meta">Nothing for sale yet. Be the first to post!</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="mg-card p-4">Nothing matches that search.</p>
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
      {floatingSell && <div className="sp-sell-bar">{sell}</div>}
    </div>
  );
}

function PostComposer({ onPosted, defaultName }: { onPosted: () => void; defaultName: string }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [price, setPrice] = useState('');
  const [contact, setContact] = useState('');
  const [name, setName] = useState(defaultName);
  const [ponyClub, setPonyClub] = useState('');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageErr, setImageErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pickImage(file: File) {
    setImageErr(null);
    if (file.size > 2_000_000) {
      setImageErr('Image is too big. Pick one under 2 MB.');
      return;
    }
    // Resize client-side to keep base64 manageable.
    const dataUrl = await resizeToDataUrl(file, 800);
    if (dataUrl.length > 700_000) {
      setImageErr('Compressed image is still too large. Try a smaller photo.');
      return;
    }
    setImageBase64(dataUrl);
  }

  async function submit() {
    if (!title.trim() || !body.trim() || !name.trim()) {
      setErr('Title, description and your name are all required.');
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
      setErr(typeof msg === 'string' ? msg : msg?.message ?? 'Could not post.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 space-y-2 border-l-4 border-brand-500">
      <h2 className="font-semibold text-sm">New shop post</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs font-semibold">Title</span>
          <input className="input mt-1 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What are you selling?" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold">Price (£, optional)</span>
          <NumberField decimal min={0} step="0.01" className="input mt-1 text-sm" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="25.00" />
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-semibold">Description</span>
        <textarea rows={3} className="input mt-1 text-sm" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Condition, size, photos, where you'd meet to hand over…" />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs font-semibold">Your name</span>
          <input className="input mt-1 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold">Pony Club (optional)</span>
          <input className="input mt-1 text-sm" value={ponyClub} onChange={(e) => setPonyClub(e.target.value)} />
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-semibold">Contact info (optional)</span>
        <input className="input mt-1 text-sm" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Phone, email, 'DM here'" />
      </label>
      <div>
        <span className="text-xs font-semibold flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> Image (optional)</span>
        <input
          type="file"
          accept="image/*"
          className="block mt-1 text-xs"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) pickImage(f); }}
        />
        {imageBase64 && (
          <div className="mt-2 relative inline-block">
            <img src={imageBase64} alt="preview" className="max-h-32 rounded-md border border-slate-200 dark:border-slate-700" />
            <button onClick={() => setImageBase64(null)} className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full p-0.5">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        {imageErr && <p className="text-xs text-amber-700 dark:text-amber-200 mt-1">{imageErr}</p>}
      </div>
      {err && <p className="text-xs text-rose-700 dark:text-rose-300">{err}</p>}
      <div className="flex justify-end">
        <button onClick={submit} disabled={busy} className="btn-primary !py-1.5 !px-3 text-sm">
          <Check className="w-3.5 h-3.5" /> {busy ? 'Posting…' : 'Post'}
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
  const [showComments, setShowComments] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reported, setReported] = useState(false);
  const [sendingReport, setSendingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const ownPost = currentUserId != null && post.authorUserId === currentUserId;

  async function remove() {
    if (!(await confirmDialog({ title: 'Remove this post?', message: 'Remove this post?', confirmLabel: 'Remove post', destructive: true }))) return;
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
    } catch {
      setReportError('Could not send the report. Try again.');
    } finally {
      setSendingReport(false);
    }
  }

  const where = [post.authorName, post.ponyClubName].filter(Boolean).join(' · ');
  return (
    <li className={`sp-listing ${post.isDeleted ? 'opacity-60' : ''}`.trim()}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="sp-listing-head">
        {post.imageBase64
          ? <LazyImage src={post.imageBase64} alt="" className="sp-thumb" compact />
          : <span role="img" aria-label={`No photo: ${post.title}`} className="sp-thumb"><ImageIcon className="h-[22px] w-[22px]" aria-hidden="true" /></span>}
        <span className="sp-grow !gap-1">
          <strong className="text-[17px] font-semibold leading-tight">{post.title}</strong>
          <span className="sp-t2 truncate">{where}</span>
          <span className="sp-t2 !text-[12.5px]">{timeAgo(post.createdAt)}{post.isDeleted ? ' · Removed' : ''}</span>
        </span>
        <span className="sp-price">{post.priceMinor != null ? priceLabel(post.priceMinor) : ''}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-subtle))] px-3 py-3">
          {post.imageBase64 && <LazyImage src={post.imageBase64} alt={post.title} className="max-h-60 w-full rounded-md object-cover" />}
          <p className="whitespace-pre-wrap text-sm">{post.body}</p>
          {post.contactInfo && <p className="mg-meta">Contact: {post.contactInfo}</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => setShowComments((v) => !v)} className="mg-small-btn gap-1.5">
              <MessageCircle className="h-4 w-4" aria-hidden="true" /> {showComments ? 'Hide' : 'Comments'}
              {post.commentCount > 0 && <span className="text-[rgb(var(--mg-muted))]">{post.commentCount}</span>}
            </button>
            <div className="ml-auto" />
            {!post.isDeleted && !ownPost && !reported && (
              <button type="button" onClick={() => { setReporting((v) => !v); setReportError(null); }} disabled={sendingReport} className="mg-small-btn gap-1.5"><Flag className="h-4 w-4" aria-hidden="true" /> Report</button>
            )}
            {(isAdmin || ownPost) && !post.isDeleted && (
              <button onClick={remove} className="mg-small-btn gap-1.5 !text-[rgb(var(--mg-elim))]" aria-label="Remove post"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
            )}
          </div>
          {reporting && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <input
                type="text"
                aria-label="Why are you reporting this post? (optional)"
                placeholder="Reason (optional)"
                maxLength={1000}
                disabled={sendingReport}
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                className="input min-w-[180px] flex-1 text-sm"
              />
              <button type="button" disabled={sendingReport} onClick={() => { void submitReport(); }} className="mg-small-btn">{sendingReport ? 'Sending…' : 'Send report'}</button>
              <button type="button" disabled={sendingReport} onClick={() => { setReporting(false); setReportReason(''); setReportError(null); }} className="mg-small-btn">Cancel</button>
              {reportError && <p role="alert" className="mg-notice w-full">{reportError}</p>}
            </div>
          )}
          {reported && <p role="status" className="mg-meta">Reported. An admin will review.</p>}
          {showComments && <CommentThread postId={post.id} postAuthorId={post.authorUserId ?? null} currentUserId={currentUserId} />}
        </div>
      )}
    </li>
  );
}

function CommentThread({ postId, postAuthorId }: {
  postId: number; postAuthorId: string | null; currentUserId: string | null;
}) {
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
          <li className="text-[11px] text-slate-500 italic">No comments yet.</li>
        )}
        {comments.map((c) => (
          <li key={c.id} className={`text-xs ${c.isPrivate ? 'bg-amber-50 dark:bg-amber-900/30 px-2 py-1 rounded-md' : ''}`}>
            <span className="font-semibold">{c.authorName}</span>
            {c.isPrivate && <Lock className="inline w-2.5 h-2.5 ml-1 text-amber-600" />}
            <span className="text-slate-400 text-[9px] ml-1">{timeAgo(c.createdAt)}</span>
            <p className="text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
      </ul>
      {user ? (
        <div className="flex gap-1">
          <input
            className="input !py-1 text-xs flex-1"
            placeholder={isPrivate ? 'Private message to the seller…' : 'Add a public comment…'}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
          <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer px-1">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
            DM
          </label>
          <button onClick={submit} disabled={busy || !body.trim()} className="btn-primary !py-1 !px-2 text-xs">
            <Send className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <Link to="/login" className="text-xs text-brand-600 dark:text-brand-300 hover:underline">
          Sign in to comment
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
