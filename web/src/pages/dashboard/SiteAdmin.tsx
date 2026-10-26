import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, ChevronDown } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import type { Club, CompetitionSummary } from '../../types';
import { confirmDialog } from '../../components/ConfirmDialog';
import { competitionDateText } from '../../lib/competitionDates';
import { STAGE_LABEL, stageAction, stageCounts, stageOf, type Stage } from '../../lib/adminStage';
import { bibAccent, bibLabel } from '../../lib/bib';
import { TrainerRequestsSection } from '../admin/TrainerRequestsSection';
import { EmailOptInExportSection } from '../admin/EmailOptInExportSection';
import { MoreMenu, PartHead, type MenuItem } from '../admin/LaptopParts';

interface IpBlock { id: number; ipAddress: string; reason?: string | null; createdAt: string }
interface AdminUser {
  id: string;
  fullName: string;
  email?: string | null;
  clubId?: number | null;
  clubName?: string | null;
  roles: string[];
  isLockedOut: boolean;
  /** A master admin has locked the account, or an admin has blocked it. */
  isLocked?: boolean;
  isBlocked?: boolean;
  createdAt: string;
}

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
export function SiteAdmin({ hideTrainerRequests = false }: { hideTrainerRequests?: boolean } = {}) {
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
  const [showAllComps, setShowAllComps] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [newClubName, setNewClubName] = useState('');
  const [newClubRegion, setNewClubRegion] = useState('');
  const [editingClubId, setEditingClubId] = useState<number | null>(null);
  const [editingClubName, setEditingClubName] = useState('');
  const now = useMemo(() => new Date(), []);

  function loadUsers(q = userSearch) {
    api
      .get<AdminUser[]>('/admin/users', { params: q.trim() ? { q: q.trim() } : undefined })
      .then((r) => setAdminUsers(Array.isArray(r.data) ? r.data : []))
      .catch(() => setAdminUsers([]));
  }

  async function toggleUserRole(userId: string, role: string, grant: boolean) {
    try {
      await api.post(`/admin/users/${encodeURIComponent(userId)}/roles`, { role, grant });
      loadUsers();
    } catch {
      setNotice('Couldn’t update user role.');
    }
  }

  async function unlockUser(userId: string) {
    try {
      await api.post(`/admin/users/${encodeURIComponent(userId)}/unlock`);
      loadUsers();
    } catch {
      setNotice('Couldn’t unlock user.');
    }
  }

  async function addClub() {
    const name = newClubName.trim();
    if (!name) return;
    try {
      await api.post('/clubs', { name, region: newClubRegion.trim() || 'Custom' });
      setNewClubName('');
      setNewClubRegion('');
      load();
    } catch {
      setNotice('Couldn’t add club.');
    }
  }

  async function saveClubRename(id: number) {
    const name = editingClubName.trim();
    if (!name) return;
    try {
      await api.put(`/clubs/${id}`, { name });
      setEditingClubId(null);
      setEditingClubName('');
      load();
    } catch {
      setNotice('Couldn’t rename club.');
    }
  }

  async function deleteClub(id: number) {
    try {
      await api.delete(`/clubs/${id}`);
      load();
    } catch {
      setNotice('Club is in use and cannot be deleted.');
    }
  }

  function load() {
    api.get<CompetitionSummary[]>('/competitions', { params: { includeArchived: true } }).then((r) => setComps(Array.isArray(r.data) ? r.data : [])).catch(() => setComps([]));
    api.get<Club[]>('/clubs').then((r) => setClubs(Array.isArray(r.data) ? r.data : [])).catch(() => setClubs([]));
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
    const message = `This deletes ${c.teamCount} team${c.teamCount === 1 ? '' : 's'}, ` +
      `${c.sectionCount} age group${c.sectionCount === 1 ? '' : 's'}, ` +
      `${c.sessionCount} session${c.sessionCount === 1 ? '' : 's'}, ` +
      `every heat, race, result, dec form and chat message. There’s no undo.`;
    if (!(await confirmDialog({ title: `Delete ${c.name} for good?`, message, confirmLabel: 'Delete competition', destructive: true, requireText: c.name }))) return;
    try {
      await api.delete(`/competitions/${c.id}`);
      // Wipe any local wizard draft for this comp so it doesn't reappear on /admin/competitions/:id.
      try { window.localStorage.removeItem(`competitionEditor:edit:${c.id}`); } catch { /* ignore */ }
      load();
    } catch {
      setNotice(`Couldn’t delete ${c.name}. Try again.`);
    }
  }

  const iAmBlocked = useMemo(() => myIp != null && blocks.some((b) => b.ipAddress === myIp), [myIp, blocks]);
  const rows = useMemo(() => comps.map((c) => ({ c, stage: stageOf(c, now) })), [comps, now]);
  const visibleRows = showAllComps ? rows : rows.slice(0, 4);
  const hiddenCompCount = Math.max(0, rows.length - 4);

  const clubsByRegion = useMemo(() => {
    const m = new Map<string, Club[]>();
    for (const c of clubs) {
      const k = c.region ?? 'No region';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [clubs]);

  function menuFor(c: CompetitionSummary): MenuItem[] {
    return [
      { label: 'Open competition', onSelect: () => navigate(`/competitions/${c.id}`) },
      { label: 'Edit details', onSelect: () => navigate(`/admin/competitions/${c.id}`) },
      { label: 'On the day & format', onSelect: () => navigate(`/admin/competitions/${c.id}/format`) },
      { label: 'Operations & tools', onSelect: () => navigate(`/competitions/${c.id}/operations`) },
      { label: 'Scorer QR codes', onSelect: () => navigate(`/competitions/${c.id}/operations?tab=scorers`) },
      { label: 'Go live & stream', onSelect: () => navigate(`/competitions/${c.id}/broadcast`) },
      { label: 'Dec forms', onSelect: () => navigate(`/competitions/${c.id}/declarations`) },
      { label: 'Manage event shop', onSelect: () => navigate(`/competitions/${c.id}/shop/manage`) },
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
            {visibleRows.map(({ c, stage }, i) => {
              const action = stageAction(stage, c.id);
              return (
                <li key={c.id} className={`${ROW_GRID} min-h-[68px] grid-cols-[minmax(0,1fr)_auto] gap-y-2 py-2 pl-4 pr-3 ${i ? 'border-t border-[rgb(var(--mg-rule-soft))]' : ''}`}>
                  <span className="flex min-w-0 flex-col gap-[3px] max-sm:col-span-2">
                    <Link to={`/competitions/${c.id}`} className="truncate text-base font-semibold !text-[rgb(var(--mg-ink))] hover:underline">{c.name}</Link>
                    <span className="truncate text-[13px] text-[rgb(var(--mg-muted))]">{[competitionDateText(c.startDate, c.endDate), c.location].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className={`justify-self-start whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ${STAGE_CLASS[stage]}`}>{STAGE_LABEL[stage]}</span>
                  <span className="mg-display text-right text-xl font-bold tabular-nums max-sm:hidden" aria-label={`${c.teamCount} entries`}>{c.teamCount}</span>
                  <span className="flex items-center justify-end gap-2">
                    <Link to={action.to} className="inline-flex min-h-11 items-center justify-center rounded-[10px] border-[1.5px] border-[rgb(var(--mg-control))] px-3.5 text-sm font-semibold !text-[rgb(var(--mg-ink))] hover:border-[rgb(var(--mg-heading))] sm:w-[132px]">{action.label}<span className="sr-only">: {c.name}</span></Link>
                    <MoreMenu label={`More for ${c.name}`} items={menuFor(c)} />
                  </span>
                </li>
              );
            })}
          </ul>
          {hiddenCompCount > 0 && (
            <div className="border-t border-[rgb(var(--mg-rule-soft))] px-4 py-2.5">
              <button
                type="button"
                aria-expanded={showAllComps}
                onClick={() => setShowAllComps((v) => !v)}
                className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[rgb(var(--mg-heading))] hover:underline"
              >
                <span>{showAllComps ? 'Show fewer competitions' : `Show ${hiddenCompCount} more competition${hiddenCompCount === 1 ? '' : 's'}`}</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${showAllComps ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </section>

      {hasRole('Admin') && !hideTrainerRequests && <TrainerRequestsSection />}

      <section aria-labelledby="ad-ips" className="flex flex-col gap-[18px]">
        <PartHead id="ad-ips" title="Blocked addresses" />
        {myIp && (
          <div className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm ${iAmBlocked ? 'bg-[rgb(var(--mg-live-row))] text-[rgb(var(--mg-elim))]' : 'bg-[rgb(var(--mg-tint))] text-[rgb(var(--mg-heading))]'}`}>
            <span className="flex-1">
              Your IP <span className="font-mono">{myIp}</span> is <strong>{iAmBlocked ? 'BLOCKED' : 'NOT blocked'}</strong>.
              {iAmBlocked && ' (admins can still post)'}
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

      {hasRole('Admin') && (
        <section aria-labelledby="ad-users" className="flex flex-col gap-[18px]">
          <PartHead id="ad-users" title="Users" />
          <div className="mg-card space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                aria-label="Search users"
                placeholder="Search by name, email or club…"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="input min-h-10 flex-1 text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  setUsersOpen(true);
                  loadUsers(userSearch);
                }}
                className="mg-btn mg-btn-secondary !min-h-10 !text-sm"
              >
                {usersOpen ? 'Search users' : 'Load users'}
              </button>
            </div>
            {usersOpen && (
              <ul className="divide-y divide-[rgb(var(--mg-rule-soft))]">
                {adminUsers.length === 0 && (
                  <li className="py-2 text-sm text-[rgb(var(--mg-muted))]">No users found.</li>
                )}
                {adminUsers.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{u.fullName}</p>
                      <p className="truncate text-xs text-[rgb(var(--mg-muted))]">
                        {[u.email, u.clubName].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(['Admin', 'Trainer', 'Manager'] as const).map((role) => {
                        const active = u.roles.includes(role);
                        return (
                          <button
                            key={role}
                            type="button"
                            aria-pressed={active}
                            onClick={() => void toggleUserRole(u.id, role, !active)}
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                              active
                                ? 'bg-[rgb(var(--mg-button))] text-white'
                                : 'bg-[rgb(var(--mg-subtle))] text-[rgb(var(--mg-body))]'
                            }`}
                          >
                            {role}
                          </button>
                        );
                      })}
                      {u.isLockedOut && (
                        <button
                          type="button"
                          onClick={() => void unlockUser(u.id)}
                          className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900"
                        >
                          Unlock
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="ad-clubs" className="flex flex-col gap-[18px]">
        <PartHead id="ad-clubs" title="Clubs" meta={clubs.length} />
        <div className="mg-card space-y-3 p-4">
          {hasRole('Admin') && (
            <div className="flex flex-wrap items-center gap-2 border-b border-[rgb(var(--mg-rule-soft))] pb-3">
              <input
                type="text"
                aria-label="New club name"
                placeholder="New club name"
                value={newClubName}
                onChange={(e) => setNewClubName(e.target.value)}
                className="input min-h-10 flex-1 text-sm"
              />
              <input
                type="text"
                aria-label="New club region"
                placeholder="Region (optional)"
                value={newClubRegion}
                onChange={(e) => setNewClubRegion(e.target.value)}
                className="input min-h-10 w-40 text-sm"
              />
              <button
                type="button"
                disabled={!newClubName.trim()}
                onClick={() => void addClub()}
                className="mg-btn mg-btn-secondary !min-h-10 !text-sm"
              >
                Add club
              </button>
            </div>
          )}
          {clubsByRegion.length === 0 && <p className="text-sm text-[rgb(var(--mg-muted))]">No clubs yet.</p>}
          {clubsByRegion.map(([region, list]) => (
            <div key={region}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--mg-muted))]">{region}</div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {list.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 rounded-lg bg-[rgb(var(--mg-subtle))] p-2">
                    <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: bibAccent(c.bibColour) }} />
                    {editingClubId === c.id ? (
                      <div className="flex flex-1 items-center gap-1.5">
                        <input
                          type="text"
                          aria-label={`Edit name for ${c.name}`}
                          value={editingClubName}
                          onChange={(e) => setEditingClubName(e.target.value)}
                          className="input !min-h-8 flex-1 text-xs"
                        />
                        <button type="button" onClick={() => void saveClubRename(c.id)} className="mg-small-btn text-xs">Save</button>
                        <button type="button" onClick={() => setEditingClubId(null)} className="mg-small-btn text-xs">Cancel</button>
                      </div>
                    ) : (
                      <>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{c.name}</p>
                          <p className="truncate text-xs text-[rgb(var(--mg-muted))]">Bibs: {bibLabel(c.bibColour)}</p>
                        </div>
                        {hasRole('Admin') && (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              aria-label={`Rename ${c.name}`}
                              onClick={() => {
                                setEditingClubId(c.id);
                                setEditingClubName(c.name);
                              }}
                              className="mg-small-btn text-xs"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${c.name}`}
                              onClick={() => void deleteClub(c.id)}
                              className="mg-small-btn text-xs text-rose-700"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </>
                    )}
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
