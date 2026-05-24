import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings, Trophy, Users2, Sparkles, Shield, Plus, Trash2, Pencil, BookOpen } from 'lucide-react';
import { api } from '../api';
import type { Club, CompetitionSummary } from '../types';
import { bibAccent, bibLabel } from '../lib/bib';

interface IpBlock { id: number; ipAddress: string; reason?: string | null; createdAt: string }

export function AdminPage() {
  const [comps, setComps] = useState<CompetitionSummary[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [blocks, setBlocks] = useState<IpBlock[]>([]);
  const [newIp, setNewIp] = useState('');
  const [newReason, setNewReason] = useState('');
  const [myIp, setMyIp] = useState<string | null>(null);
  const [blockBusy, setBlockBusy] = useState(false);

  function load() {
    api.get<CompetitionSummary[]>('/competitions', { params: { includeArchived: true } }).then((r) => setComps(r.data));
    api.get<Club[]>('/clubs').then((r) => setClubs(r.data));
    api.get<IpBlock[]>('/ip-blocks').then((r) => setBlocks(r.data)).catch(() => setBlocks([]));
    api.get<{ ip: string }>('/ip-blocks/mine').then((r) => setMyIp(r.data.ip)).catch(() => setMyIp(null));
  }
  useEffect(load, []);

  async function addBlock() {
    const ip = newIp.trim();
    if (!ip) return;
    setBlockBusy(true);
    try {
      await api.post('/ip-blocks', { ipAddress: ip, reason: newReason.trim() || null });
      setNewIp(''); setNewReason('');
      load();
    } finally {
      setBlockBusy(false);
    }
  }

  async function removeBlock(id: number) {
    await api.delete(`/ip-blocks/${id}`);
    load();
  }

  const iAmBlocked = useMemo(() => myIp != null && blocks.some((b) => b.ipAddress === myIp), [myIp, blocks]);

  const clubsByRegion = useMemo(() => {
    const m = new Map<string, Club[]>();
    for (const c of clubs) {
      const k = c.region ?? '—';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [clubs]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="w-6 h-6 text-brand-600" /> Admin
        </h1>
        <div className="flex gap-2 flex-wrap">
          <Link to="/admin/rules" className="btn-ghost">
            <BookOpen className="w-4 h-4" /> Race rules
          </Link>
          <Link to="/admin/competitions/new" className="btn-primary">
            <Sparkles className="w-4 h-4" /> Create competition
          </Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Trophy className="w-5 h-5 text-brand-600" /> All competitions
          </h2>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {comps.length === 0 && (
              <li className="py-2 text-sm text-slate-500">No competitions yet.</li>
            )}
            {comps.map((c) => (
              <li key={c.id} className="py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium truncate">{c.name}</p>
                  <p className="text-xs text-slate-500 truncate">{new Date(c.startDate).toLocaleDateString()} · {c.location}</p>
                </div>
                <span className="pill bg-slate-100 text-slate-700 shrink-0">{c.teamCount} teams</span>
                <Link
                  to={`/admin/competitions/${c.id}`}
                  className="btn-ghost !py-1 !px-2 text-xs shrink-0"
                  title="Edit competition"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Users2 className="w-5 h-5 text-brand-600" /> Clubs ({clubs.length})
          </h2>
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {clubsByRegion.map(([region, list]) => (
              <div key={region}>
                <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-1">{region}</div>
                <ul className="grid grid-cols-2 gap-2">
                  {list.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800">
                      <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ background: bibAccent(c.bibColour) }} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        <p className="text-[10px] text-slate-500 truncate">Bibs: {bibLabel(c.bibColour)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Shield className="w-5 h-5 text-rose-600" /> Chat IP blocks
        </h2>
        {myIp && (
          <div className={`rounded-md p-2 text-xs flex items-center gap-2 ${
            iAmBlocked
              ? 'bg-rose-50 dark:bg-rose-900/30 text-rose-800 dark:text-rose-200 border border-rose-300 dark:border-rose-700'
              : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800'
          }`}>
            <Shield className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1">
              Your IP <span className="font-mono">{myIp}</span> is{' '}
              <span className="font-semibold">{iAmBlocked ? 'BLOCKED' : 'NOT blocked'}</span>.
              {iAmBlocked && ' (admin posts still go through.)'}
            </span>
            {iAmBlocked && (
              <button
                onClick={() => {
                  const mine = blocks.find((b) => b.ipAddress === myIp);
                  if (mine) removeBlock(mine.id);
                }}
                className="btn-ghost !py-1 !px-2 text-[11px]"
              >
                Unblock me
              </button>
            )}
          </div>
        )}
        <p className="text-xs text-slate-500 dark:text-slate-300">
          Blocked IPs cannot post in chat. Add one below; click "Unblock" beside an entry to lift it.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            className="input flex-1 min-w-[160px] text-sm"
            placeholder="IP address (e.g. 192.168.1.50)"
            value={newIp}
            onChange={(e) => setNewIp(e.target.value)}
          />
          <input
            className="input flex-1 min-w-[160px] text-sm"
            placeholder="Reason (optional)"
            value={newReason}
            onChange={(e) => setNewReason(e.target.value)}
          />
          {myIp && newIp !== myIp && (
            <button
              type="button"
              onClick={() => setNewIp(myIp)}
              className="btn-ghost !py-1.5 !px-2.5 text-[11px]"
              title="Pre-fill with your own IP"
            >
              Use mine
            </button>
          )}
          <button onClick={addBlock} disabled={blockBusy || !newIp.trim()} className="btn-primary !py-1.5 !px-3 text-xs">
            <Plus className="w-3.5 h-3.5" /> Block
          </button>
        </div>
        {blocks.length === 0 ? (
          <p className="text-xs text-slate-500">No IPs blocked.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {blocks.map((b) => (
              <li key={b.id} className="py-2 flex items-center gap-2">
                <span className="font-mono text-xs text-slate-700 dark:text-slate-100 flex-1 truncate">
                  {b.ipAddress}
                  {b.ipAddress === myIp && <span className="ml-1 text-[10px] text-rose-500 font-semibold">(YOU)</span>}
                </span>
                {b.reason && <span className="text-[11px] text-slate-500 truncate">{b.reason}</span>}
                <span className="text-[10px] text-slate-400">{new Date(b.createdAt).toLocaleDateString()}</span>
                <button
                  onClick={() => removeBlock(b.id)}
                  className="inline-flex items-center gap-1 text-rose-600 hover:text-rose-800 text-[11px] font-semibold"
                  title="Unblock this IP"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Unblock
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
