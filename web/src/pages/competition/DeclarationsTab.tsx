import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Star, Shield, Save, LogIn, Phone, Download } from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { DeclarationForm, SavedRider, Team } from '../../types';
import { toCsv, downloadCsv, safeFilename } from '../../lib/csv';

interface RiderDraft {
  savedRiderId?: number | null;
  fullName: string;
  horseName: string;
  bibColour: string;
  isCaptain: boolean;
  isReserve: boolean;
}

const BIB_COLOURS = ['Red', 'Yellow', 'Blue', 'Green', 'White'];

function bibSwatch(name?: string | null): string {
  switch ((name ?? '').toLowerCase()) {
    case 'red': return '#dc2626';
    case 'yellow': return '#facc15';
    case 'blue': return '#2563eb';
    case 'green': return '#16a34a';
    case 'white': return '#f8fafc';
    case 'black': return '#1f2937';
    case 'orange': return '#f97316';
    case 'pink': return '#ec4899';
    case 'purple': return '#9333ea';
    default: return '#94a3b8';
  }
}

interface DecFormDraft {
  teamId: number;
  riders: RiderDraft[];
  notes: string;
  trainerPhone: string;
}

function decDraftKey(competitionId: number): string {
  return `mg.draft.decform:${competitionId}`;
}
function readDecDraft(competitionId: number): DecFormDraft | null {
  try {
    const raw = localStorage.getItem(decDraftKey(competitionId));
    if (!raw) return null;
    const v = JSON.parse(raw) as DecFormDraft;
    return typeof v.teamId === 'number' && Array.isArray(v.riders) ? v : null;
  } catch { return null; }
}

export function DeclarationsTab() {
  const { competition } = useCompetition();
  const { user, hasRole } = useAuth();
  const [forms, setForms] = useState<DeclarationForm[]>([]);
  const persistedDraft = readDecDraft(competition.id);
  const [draftTeam, setDraftTeam] = useState<Team | null>(() => {
    if (!persistedDraft) return null;
    return competition.teams.find((t) => t.id === persistedDraft.teamId) ?? null;
  });
  const [riders, setRiders] = useState<RiderDraft[]>(persistedDraft?.riders ?? []);
  const [notes, setNotes] = useState(persistedDraft?.notes ?? '');
  const [trainerPhone, setTrainerPhone] = useState(persistedDraft?.trainerPhone ?? '');
  const [saveRoster, setSaveRoster] = useState(true);
  const [saved, setSaved] = useState<SavedRider[]>([]);
  const [busy, setBusy] = useState(false);

  // Auto-save the in-progress dec form so a reload doesn't wipe it.
  useEffect(() => {
    if (!draftTeam) return;
    const draft: DecFormDraft = { teamId: draftTeam.id, riders, notes, trainerPhone };
    try { localStorage.setItem(decDraftKey(competition.id), JSON.stringify(draft)); } catch { /* quota */ }
  }, [competition.id, draftTeam, riders, notes, trainerPhone]);

  // If we restored a draft on mount, also re-fetch the team's saved riders so
  // the rider-picker is populated.
  useEffect(() => {
    if (persistedDraft && draftTeam) {
      api.get<SavedRider[]>(`/clubs/${draftTeam.clubId}/saved-riders`)
        .then((r) => setSaved(r.data))
        .catch(() => setSaved([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);

  // Trainers can submit for any team that's either assigned to them or unassigned.
  // (Teams claimed by a different trainer stay hidden so two trainers don't fight over a roster.)
  const myTeams = useMemo(() => {
    if (hasRole('Admin')) return competition.teams;
    if (!user) return [];
    return competition.teams.filter((t) => t.trainerUserId == null || t.trainerUserId === user.id);
  }, [competition.teams, hasRole, user]);

  useEffect(() => {
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: competition.id } })
      .then((r) => setForms(r.data));
  }, [competition.id]);

  function startNew(team: Team) {
    setDraftTeam(team);
    setRiders([{ fullName: '', horseName: '', bibColour: 'Red', isCaptain: true, isReserve: false }]);
    setNotes('');
    // Pre-fill phone from prior submission by this trainer if any
    const prior = forms.find((f) => f.submittedByUserId === user?.id && f.submittedByPhone);
    setTrainerPhone(prior?.submittedByPhone ?? '');
    api.get<SavedRider[]>(`/clubs/${team.clubId}/saved-riders`)
      .then((r) => setSaved(r.data))
      .catch(() => setSaved([]));
  }

  function addRider() {
    const nextBib = BIB_COLOURS[riders.length % BIB_COLOURS.length];
    setRiders((r) => [...r, { fullName: '', horseName: '', bibColour: nextBib, isCaptain: false, isReserve: false }]);
  }

  function updateRider(i: number, patch: Partial<RiderDraft>) {
    setRiders((r) => r.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  }

  function removeRider(i: number) {
    setRiders((r) => r.filter((_, idx) => idx !== i));
  }

  function pickSaved(i: number, savedRiderId: number) {
    const sr = saved.find((s) => s.id === savedRiderId);
    if (!sr) return;
    updateRider(i, {
      savedRiderId: sr.id,
      fullName: sr.fullName,
      horseName: sr.horseName ?? '',
    });
  }

  async function submit() {
    if (!draftTeam) return;
    setBusy(true);
    try {
      const { data } = await api.post<DeclarationForm>('/declaration-forms', {
        teamId: draftTeam.id,
        notes: notes || null,
        saveToRoster: saveRoster,
        trainerPhone: trainerPhone.trim() || null,
        riders: riders
          .filter((r) => r.fullName.trim())
          .map((r, i) => ({
            savedRiderId: r.savedRiderId ?? null,
            fullName: r.fullName.trim(),
            horseName: r.horseName.trim() || null,
            bibColour: r.bibColour.trim() || null,
            isCaptain: r.isCaptain,
            isReserve: r.isReserve,
            orderIndex: i,
            dateOfBirth: null,
          })),
      });
      setForms((cur) => [data, ...cur]);
      setDraftTeam(null);
      setRiders([]);
      setNotes('');
      try { localStorage.removeItem(decDraftKey(competition.id)); } catch { /* ignore */ }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    await api.delete(`/declaration-forms/${id}`);
    setForms((cur) => cur.filter((f) => f.id !== id));
  }

  function exportCsv() {
    const header = ['Team', 'Captain', 'Reserve', 'Rider', 'DOB', 'Horse', 'Bib', 'Submitted by', 'Phone', 'Submitted at', 'Notes'];
    const rows: ReadonlyArray<string>[] = [];
    for (const f of forms) {
      const riders = f.riders.slice().sort((a, b) => a.orderIndex - b.orderIndex);
      for (const r of riders) {
        rows.push([
          f.teamName,
          r.isCaptain ? 'yes' : '',
          r.isReserve ? 'yes' : '',
          r.fullName,
          r.dateOfBirth ? new Date(r.dateOfBirth).toLocaleDateString() : '',
          r.horseName ?? '',
          r.bibColour ?? '',
          f.submittedByName ?? '',
          f.submittedByPhone ?? '',
          new Date(f.submittedAt).toLocaleString(),
          f.notes ?? '',
        ]);
      }
    }
    downloadCsv(`${safeFilename(competition.name)}-dec-forms.csv`, toCsv(header, rows));
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={exportCsv}
          disabled={forms.length === 0}
          className="btn-ghost !py-1.5 !px-2.5 text-xs"
          title="Download all submitted dec forms as CSV"
        >
          <Download className="w-3.5 h-3.5" /> Export CSV ({forms.length})
        </button>
      </div>
      <div className="card p-3">
        {!user ? (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-brand-50 dark:bg-brand-900/30 text-xs">
            <LogIn className="w-4 h-4 text-brand-600 dark:text-brand-300 shrink-0" />
            <span className="flex-1">Sign in as a trainer to submit declaration forms for your teams.</span>
            <Link to="/login" className="btn-primary !py-1.5 !px-2.5 text-xs">Sign in</Link>
          </div>
        ) : myTeams.length === 0 ? (
          <p className="text-slate-500 dark:text-slate-300 text-xs">You have no teams in this competition.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {myTeams.map((t) => (
              <button key={t.id} onClick={() => startNew(t)} className="btn-ghost !py-1.5 !px-2.5 text-xs">
                <Plus className="w-3.5 h-3.5" /> New for {t.displayName}
              </button>
            ))}
          </div>
        )}
      </div>

      {draftTeam && (
        <div className="card p-3 sm:p-4">
          <h3 className="font-semibold mb-3 text-sm">New dec form — {draftTeam.displayName}</h3>

          <label className="block mb-3">
            <span className="text-xs text-slate-500 dark:text-slate-300 flex items-center gap-1">
              <Phone className="w-3 h-3" /> Trainer phone (saved to your profile)
            </span>
            <input
              type="tel"
              className="input mt-1 text-sm"
              placeholder="e.g. 07700 900123"
              value={trainerPhone}
              onChange={(e) => setTrainerPhone(e.target.value)}
            />
          </label>

          <div className="space-y-2">
            {riders.map((r, i) => (
              <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                <div className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-2 sm:col-span-1 flex justify-center">
                    <span
                      className="inline-flex w-8 h-8 rounded-full items-center justify-center border-2 text-[10px] font-bold uppercase"
                      style={{
                        background: bibSwatch(r.bibColour),
                        color: ['white', 'yellow'].includes(r.bibColour.toLowerCase()) ? '#111' : '#fff',
                        borderColor: bibSwatch(r.bibColour),
                      }}
                      title={r.bibColour}
                    >
                      {r.bibColour.slice(0, 3)}
                    </span>
                  </div>
                  <select
                    className="input col-span-10 sm:col-span-2 text-sm"
                    value={r.bibColour}
                    onChange={(e) => updateRider(i, { bibColour: e.target.value })}
                  >
                    {BIB_COLOURS.map((b) => <option key={b}>{b}</option>)}
                    {!BIB_COLOURS.includes(r.bibColour) && r.bibColour && (
                      <option value={r.bibColour}>{r.bibColour}</option>
                    )}
                  </select>
                  <select
                    className="input col-span-12 sm:col-span-3 text-sm"
                    value={r.savedRiderId ?? ''}
                    onChange={(e) => e.target.value ? pickSaved(i, parseInt(e.target.value, 10)) : updateRider(i, { savedRiderId: null })}
                  >
                    <option value="">— pick saved —</option>
                    {saved.map((s) => (
                      <option key={s.id} value={s.id}>{s.fullName}{s.horseName ? ` / ${s.horseName}` : ''}</option>
                    ))}
                  </select>
                  <input
                    className="input col-span-12 sm:col-span-3 text-sm" placeholder="Rider name"
                    value={r.fullName}
                    onChange={(e) => updateRider(i, { fullName: e.target.value, savedRiderId: null })}
                  />
                  <input
                    className="input col-span-8 sm:col-span-2 text-sm" placeholder="Horse"
                    value={r.horseName}
                    onChange={(e) => updateRider(i, { horseName: e.target.value })}
                  />
                  <div className="col-span-4 sm:col-span-1 flex justify-end gap-2 items-center">
                    <label title="Captain" className="cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={r.isCaptain}
                        onChange={(e) => updateRider(i, { isCaptain: e.target.checked })} />
                      <Star className={`w-4 h-4 ${r.isCaptain ? 'text-amber-500 fill-amber-500' : 'text-slate-400'}`} />
                    </label>
                    <label title="Reserve" className="cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={r.isReserve}
                        onChange={(e) => updateRider(i, { isReserve: e.target.checked })} />
                      <Shield className={`w-4 h-4 ${r.isReserve ? 'text-sky-500 fill-sky-500' : 'text-slate-400'}`} />
                    </label>
                    <button type="button" onClick={() => removeRider(i)} title="Remove" className="text-rose-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <button onClick={addRider} className="btn-ghost !py-1.5 !px-2.5 text-xs">
              <Plus className="w-3.5 h-3.5" /> Add rider
            </button>
          </div>

          <textarea
            className="input mt-3 text-sm" rows={2} placeholder="Notes (optional)"
            value={notes} onChange={(e) => setNotes(e.target.value)}
          />

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <label className="text-xs flex items-center gap-1.5">
              <input type="checkbox" checked={saveRoster}
                onChange={(e) => setSaveRoster(e.target.checked)} />
              Save new riders to club roster
            </label>
            <div className="ml-auto flex gap-1.5">
              <button
                className="btn-ghost !py-1.5 !px-2.5 text-xs"
                onClick={() => {
                  if (riders.some((r) => r.fullName.trim())
                      && !confirm('Discard the in-progress dec form?')) return;
                  setDraftTeam(null);
                  setRiders([]);
                  setNotes('');
                  try { localStorage.removeItem(decDraftKey(competition.id)); } catch { /* ignore */ }
                }}
              >Cancel</button>
              <button className="btn-primary !py-1.5 !px-2.5 text-xs" onClick={submit} disabled={busy}>
                <Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {forms.length === 0 && (
          <div className="card p-3 text-xs text-slate-500 dark:text-slate-300">No declaration forms submitted yet.</div>
        )}
        {forms.map((f) => <DecFormCard key={f.id} f={f} onDelete={() => remove(f.id)} canDelete={user != null} />)}
      </div>
    </div>
  );
}

interface CardProps { f: DeclarationForm; onDelete: () => void; canDelete: boolean }

function DecFormCard({ f, onDelete, canDelete }: CardProps) {
  return (
    <div className="card p-3">
      <div className="flex items-start gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm truncate">{f.teamName}</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-300">
            Trainer: <span className="font-medium text-slate-700 dark:text-slate-100">{f.submittedByName ?? '—'}</span>
            {f.submittedByPhone && <span className="ml-1 text-slate-500"> · {f.submittedByPhone}</span>}
          </p>
          <p className="text-[10px] text-slate-400">
            Submitted {new Date(f.submittedAt).toLocaleString()}
          </p>
        </div>
        {canDelete && (
          <button onClick={onDelete} className="text-rose-500 hover:text-rose-700" title="Delete">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      <ol className="space-y-1">
        {f.riders.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-xs">
            <span
              className="inline-flex shrink-0 w-7 h-7 rounded-full items-center justify-center border text-[9px] font-bold uppercase"
              style={{
                background: bibSwatch(r.bibColour),
                color: ['white', 'yellow'].includes((r.bibColour ?? '').toLowerCase()) ? '#111' : '#fff',
                borderColor: bibSwatch(r.bibColour),
              }}
              title={r.bibColour ?? ''}
            >
              {(r.bibColour ?? '—').slice(0, 3)}
            </span>
            <span className="font-medium truncate flex-1 text-slate-900 dark:text-slate-50">
              {r.fullName}
              {r.isCaptain && <Star className="inline w-3 h-3 ml-1 text-amber-500 fill-amber-500" />}
              {r.isReserve && <Shield className="inline w-3 h-3 ml-1 text-sky-500 fill-sky-500" />}
            </span>
            <span className="text-slate-500 dark:text-slate-300 truncate">{r.horseName ?? '—'}</span>
          </li>
        ))}
      </ol>
      {f.notes && <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-300 italic">"{f.notes}"</p>}
    </div>
  );
}
