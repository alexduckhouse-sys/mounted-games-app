import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import type { Club, CompetitionSummary } from '../../types';
import { competitionDateText } from '../../lib/competitionDates';
import { STAGE_LABEL, stageAction, stageCounts, stageOf, type Stage } from '../../lib/adminStage';
import { bibAccent, bibLabel } from '../../lib/bib';
import { TrainerRequestsSection } from '../admin/TrainerRequestsSection';
import { EmailOptInExportSection } from '../admin/EmailOptInExportSection';
import { MoreMenu, PartHead, type MenuItem } from '../admin/LaptopParts';

interface IpBlock { id: number; ipAddress: string; reason?: string | null; createdAt: string }

const STAGE_CLASS: Record<Stage, string> = {
  draft: 'bg-[rgb(var(--mg-done-bg))] text-[rgb(var(--mg-body))]',
  entries: 'bg-[rgb(var(--mg-ok)/0.14)] text-[rgb(var(--mg-ok))]',
  format: 'bg-[rgb(var(--mg-late-bg))] text-[rgb(var(--mg-late-ink))]',
  ready: 'bg-[rgb(var(--mg-tint))] text-[rgb(var(--mg-heading))]',
  live: 'bg-[rgb(var(--mg-live-row))] text-[rgb(var(--mg-elim))]',
  finished: 'bg-[rgb(var(--mg-done-bg))] text-[rgb(var(--mg-body))]',
};

const ROW_GRID = 'grid items-center gap-x-4 sm:grid-cols-[minmax(0,1fr)_120px_64px_192px]';

/** Everything that used to live at /admin: competitions, trainer requests, blocked addresses, the email export, rules and clubs. */
export function SiteAdmin() {
  const { canEdit, hasRole } = useAuth();
  const navigate = useNavigate();
  const [comps, setComps] = useState<CompetitionSummary[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [blocks, setBlocks] = useState<IpBlock[]>([]);
  const [newIp, setNewIp] = useState('');
  const [newReason, setNewReason] = useState('');
  const [myIp, setMyIp] = useState<string | null>(null);
  const [blockBusy, setBlockBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);

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

  async function setLocked(c: CompetitionSummary, locked: boolean) {
    try {
      await api.post(`/competitions/${c.id}/signups-locked`, { locked });
      setNotice(`Signups ${locked ? 'locked' : 'opened again'} for ${c.name}.`);
    } catch {
      setNotice(`Couldn’t ${locked ? 'lock' : 'open'} signups for ${c.name}. Try again.`);
    }
  }

  async function deleteComp(c: CompetitionSummary) {
    const prompt = `Delete "${c.name}" forever?\n\n` +
      `This wipes ${c.teamCount} team${c.teamCount === 1 ? '' : 's'}, ` +
      `${c.sectionCount} age group${c.sectionCount === 1 ? '' : 's'}, ` +
      `${c.sessionCount} session${c.sessionCount === 1 ? '' : 's'}, ` +
      `every heat, race, result, dec form and chat message.\n\n` +
      `There is no undo. Type the comp name to confirm.`;
    const typed = window.prompt(prompt);
    if (typed == null) return;
    if (typed.trim() !== c.name) {
      alert('Name did not match — nothing deleted.');
      return;
    }
    try {
      await api.delete(`/competitions/${c.id}`);
      // Wipe any local wizard draft for this comp so it doesn't reappear on /admin/competitions/:id.
      try { window.localStorage.removeItem(`competitionEditor:edit:${c.id}`); } catch { /* ignore */ }
      load();
    } catch {
      alert('Delete failed. Check the API logs.');
    }
  }

  const iAmBlocked = useMemo(() => myIp != null && blocks.some((b) => b.ipAddress === myIp), [myIp, blocks]);
  const rows = useMemo(() => comps.map((c) => ({ c, stage: stageOf(c, now) })), [comps, now]);

  const clubsByRegion = useMemo(() => {
    const m = new Map<string, Club[]>();
    for (const c of clubs) {
      const k = c.region ?? '—';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [clubs]);

  function menuFor(c: CompetitionSummary): MenuItem[] {
    return [
      { label: 'Edit details', onSelect: () => navigate(`/admin/competitions/${c.id}`) },
      { label: 'Lock signups', onSelect: () => void setLocked(c, true) },
      { label: 'Open signups again', onSelect: () => void setLocked(c, false) },
      ...(canEdit() ? [{ label: 'Delete competition', onSelect: () => void deleteComp(c), danger: true }] : []),
    ];
  }

  return (
    <div id="site-admin" className="skin flex w-full scroll-mt-4 flex-col gap-9">
      <div className="flex flex-wrap items-end gap-4">
        <h2 className="mg-display flex-1 text-[34px] font-bold leading-none text-[rgb(var(--mg-heading))]">Site admin</h2>
        <Link to="/admin/rules" className="mg-btn mg-btn-secondary !min-h-[50px] !rounded-[10px] !px-4 !text-base"><BookOpen className="h-[18px] w-[18px]" aria-hidden="true" /> Rules library</Link>
      </div>

      <section aria-labelledby="ad-comps" className="flex flex-col gap-[18px]">
        <PartHead id="ad-comps" title="Competitions" meta={rows.length ? stageCounts(rows.map((r) => r.stage)) : undefined} />
        {notice && <p role="status" className="mg-notice">{notice}</p>}
        <div className="mg-card overflow-visible">
          <div aria-hidden="true" className={`${ROW_GRID} hidden border-b border-[rgb(var(--mg-rule-soft))] py-2.5 pl-4 pr-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--mg-muted))] sm:grid`}>
            <span>Competition</span><span>Stage</span><span className="text-right">Entries</span><span />
          </div>
          {rows.length === 0 && <p className="px-4 py-3 text-sm text-[rgb(var(--mg-muted))]">No competitions yet.</p>}
          <ul>
            {rows.map(({ c, stage }, i) => {
              const action = stageAction(stage, c.id);
              return (
                <li key={c.id} className={`${ROW_GRID} min-h-[68px] grid-cols-[minmax(0,1fr)_auto] gap-y-2 py-2 pl-4 pr-3 ${i ? 'border-t border-[rgb(var(--mg-rule-soft))]' : ''}`}>
                  <span className="flex min-w-0 flex-col gap-[3px]">
                    <strong className="truncate text-base font-semibold">{c.name}</strong>
                    <span className="truncate text-[13px] text-[rgb(var(--mg-muted))]">{[competitionDateText(c.startDate, c.endDate), c.location].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className={`justify-self-start whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold max-sm:order-3 ${STAGE_CLASS[stage]}`}>{STAGE_LABEL[stage]}</span>
                  <span className="mg-display text-right text-xl font-bold tabular-nums max-sm:order-4" aria-label={`${c.teamCount} entries`}>{c.teamCount}</span>
                  <span className="flex items-center justify-end gap-2 max-sm:order-2">
                    <Link to={action.to} className="inline-flex min-h-11 w-[132px] items-center justify-center rounded-[10px] border-[1.5px] border-[rgb(var(--mg-control))] px-3.5 text-sm font-semibold !text-[rgb(var(--mg-ink))] hover:border-[rgb(var(--mg-heading))]">{action.label}<span className="sr-only">: {c.name}</span></Link>
                    <MoreMenu label={`More for ${c.name}`} items={menuFor(c)} />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {hasRole('Admin') && <TrainerRequestsSection />}

      <section aria-labelledby="ad-ips" className="flex flex-col gap-[18px]">
        <PartHead id="ad-ips" title="Blocked addresses" />
        {myIp && (
          <div className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm ${iAmBlocked ? 'bg-[rgb(var(--mg-live-row))] text-[rgb(var(--mg-elim))]' : 'bg-[rgb(var(--mg-tint))] text-[rgb(var(--mg-heading))]'}`}>
            <span className="flex-1">
              Your IP <span className="font-mono">{myIp}</span> is <strong>{iAmBlocked ? 'BLOCKED' : 'NOT blocked'}</strong>.
              {iAmBlocked && ' (admin posts still go through.)'}
            </span>
            {iAmBlocked && (
              <button type="button" onClick={() => { const mine = blocks.find((b) => b.ipAddress === myIp); if (mine) removeBlock(mine.id); }} className="mg-small-btn">Unblock me</button>
            )}
          </div>
        )}
        <div className="grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_132px]">
          <label className="flex flex-col gap-2 text-base font-medium">IP address
            <span className="mg-field !min-h-12"><input placeholder="192.168.1.50" value={newIp} onChange={(e) => setNewIp(e.target.value)} /></span>
          </label>
          <label className="flex flex-col gap-2 text-base font-medium">Reason (optional)
            <span className="mg-field !min-h-12"><input value={newReason} onChange={(e) => setNewReason(e.target.value)} /></span>
          </label>
          <button type="button" onClick={addBlock} disabled={blockBusy || !newIp.trim()} className="mg-btn mg-btn-secondary !min-h-12 !rounded-[10px] !text-base">Block</button>
        </div>
        {myIp && newIp !== myIp && (
          <button type="button" onClick={() => setNewIp(myIp)} className="mg-small-btn self-start">Use my address</button>
        )}
        {blocks.length === 0 ? (
          <p className="text-sm text-[rgb(var(--mg-muted))]">No addresses blocked. Blocked addresses can’t post in chat.</p>
        ) : (
          <ul className="mg-card mg-list">
            {blocks.map((b) => (
              <li key={b.id} className="grid min-h-14 items-center gap-x-4 gap-y-1 py-1 pl-4 pr-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_132px]">
                <strong className="truncate font-mono text-[15px] font-semibold">
                  {b.ipAddress}
                  {b.ipAddress === myIp && <span className="ml-1.5 text-[10px] font-bold text-[rgb(var(--mg-elim))]">(YOU)</span>}
                </strong>
                <span className="text-sm text-[rgb(var(--mg-muted))]">{b.reason ?? ''}{b.reason ? ' · ' : ''}{new Date(b.createdAt).toLocaleDateString('en-GB')}</span>
                <button type="button" onClick={() => removeBlock(b.id)} className="mg-btn mg-btn-secondary !min-h-11 !rounded-[10px] !text-sm" aria-label={`Unblock ${b.ipAddress}`}>Unblock</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {hasRole('Admin') && <EmailOptInExportSection />}

      <section aria-labelledby="ad-clubs" className="flex flex-col gap-[18px]">
        <PartHead id="ad-clubs" title="Clubs" meta={clubs.length} />
        <div className="mg-card space-y-3 p-4">
          {clubsByRegion.length === 0 && <p className="text-sm text-[rgb(var(--mg-muted))]">No clubs yet.</p>}
          {clubsByRegion.map(([region, list]) => (
            <div key={region}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--mg-muted))]">{region}</div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {list.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 rounded-lg bg-[rgb(var(--mg-subtle))] p-2">
                    <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: bibAccent(c.bibColour) }} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <p className="truncate text-xs text-[rgb(var(--mg-muted))]">Bibs: {bibLabel(c.bibColour)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
