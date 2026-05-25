import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag, Plus, Flag, Trash2, MessageCircle, Lock, X, Send, Image as ImageIcon, Check } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import type { ShopComment, ShopPost } from '../types';

function priceLabel(p?: number | null): string {
  if (p == null) return '';
  return `£${(p / 100).toFixed(2)}`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function ShopPage() {
  const { user, canEdit } = useAuth();
  const [posts, setPosts] = useState<ShopPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);

  function load() {
    setLoading(true);
    api.get<ShopPost[]>('/shop/posts').then((r) => setPosts(r.data)).finally(() => setLoading(false));
  }
  useEffect(load, []);

  const isAdmin = canEdit();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShoppingBag className="w-6 h-6 text-brand-600" /> Shop
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-300 flex-1">
          Buy, sell or swap tack and equipment with other Pony Clubbers.
        </p>
        {user ? (
          <button onClick={() => setComposerOpen((v) => !v)} className="btn-primary !py-1.5 !px-3 text-sm">
            <Plus className="w-4 h-4" /> {composerOpen ? 'Cancel' : 'New post'}
          </button>
        ) : (
          <Link to="/login" className="btn-primary !py-1.5 !px-3 text-sm">
            <Plus className="w-4 h-4" /> Sign in to post
          </Link>
        )}
      </div>

      {composerOpen && user && (
        <PostComposer onPosted={() => { setComposerOpen(false); load(); }} defaultName={user.fullName} />
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading posts…</p>
      ) : posts.length === 0 ? (
        <div className="card p-6 text-center">
          <ShoppingBag className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-sm text-slate-500 dark:text-slate-300">
            Nothing for sale yet. Be the first to post!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              isAdmin={isAdmin}
              currentUserId={user?.id ?? null}
              onChanged={load}
            />
          ))}
        </div>
      )}
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
      setImageErr('Image too big — pick something under 2 MB.');
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
          <span className="text-xs font-semibold">Price (£) — optional</span>
          <input className="input mt-1 text-sm" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="25.00" />
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

function PostCard({
  post, isAdmin, currentUserId, onChanged,
}: {
  post: ShopPost;
  isAdmin: boolean;
  currentUserId: string | null;
  onChanged: () => void;
}) {
  const [showComments, setShowComments] = useState(false);
  const ownPost = currentUserId != null && post.authorUserId === currentUserId;

  async function remove() {
    if (!confirm('Remove this post?')) return;
    await api.delete(`/shop/posts/${post.id}`);
    onChanged();
  }
  async function report() {
    const reason = window.prompt('Why are you reporting this post? (optional)') ?? '';
    if (reason === null) return;
    await api.post(`/shop/posts/${post.id}/report`, { reason: reason.trim() || null }).catch(() => {});
    alert('Reported. An admin will review.');
  }

  return (
    <article className={`card p-3 space-y-2 flex flex-col ${post.isDeleted ? 'opacity-60 border-rose-200' : ''}`}>
      {post.imageBase64 && (
        <img src={post.imageBase64} alt={post.title} className="rounded-md max-h-40 w-full object-cover" />
      )}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm truncate">{post.title}</h3>
          {post.priceMinor != null && (
            <p className="text-base font-bold text-brand-700 dark:text-brand-200">{priceLabel(post.priceMinor)}</p>
          )}
        </div>
        <span className="text-[10px] text-slate-400 shrink-0">{timeAgo(post.createdAt)}</span>
      </div>
      <p className="text-xs whitespace-pre-wrap text-slate-700 dark:text-slate-200 line-clamp-6">{post.body}</p>
      <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1 flex-wrap">
        <span className="font-semibold">{post.authorName}</span>
        {post.ponyClubName && <span>· {post.ponyClubName}</span>}
        {post.contactInfo && <span className="truncate">· {post.contactInfo}</span>}
      </div>
      <div className="flex items-center gap-1.5 pt-1 border-t border-slate-100 dark:border-slate-700/60">
        <button onClick={() => setShowComments((v) => !v)} className="btn-ghost !py-1 !px-2 text-[11px]">
          <MessageCircle className="w-3 h-3" /> {showComments ? 'Hide' : 'Comments'}
          {post.commentCount > 0 && <span className="ml-1 text-slate-400">{post.commentCount}</span>}
        </button>
        <div className="ml-auto" />
        {!post.isDeleted && !ownPost && (
          <button onClick={report} className="btn-ghost !py-1 !px-2 text-[11px] text-amber-600">
            <Flag className="w-3 h-3" /> Report
          </button>
        )}
        {(isAdmin || ownPost) && !post.isDeleted && (
          <button onClick={remove} className="btn-ghost !py-1 !px-2 text-[11px] text-rose-500">
            <Trash2 className="w-3 h-3" />
          </button>
        )}
        {post.isDeleted && (
          <span className="text-[10px] uppercase tracking-wide font-bold text-rose-500">Removed</span>
        )}
      </div>
      {showComments && <CommentThread postId={post.id} postAuthorId={post.authorUserId ?? null} currentUserId={currentUserId} />}
    </article>
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
