import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Star, Shield, Save, LogIn, Phone, Download, UserPlus } from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { DeclarationForm, SavedRider, Team } from '../../types';
import { toCsv, downloadCsv, safeFilename } from '../../lib/csv';
import { RiderPrivacyFields } from '../../components/RiderPrivacyFields';

interface RiderDraft {
  savedRiderId?: number | null;
  fullName: string;
  horseName: string;
  isCaptain: boolean;
  isReserve: boolean;
  isGuestRider: boolean;
  useInitialOnly: boolean;
  noFilming: boolean;
}

const blankRider = (isCaptain = false): RiderDraft => ({
  fullName: '', horseName: '', isCaptain, isReserve: false, isGuestRider: false, useInitialOnly: false, noFilming: false,
});

interface DecFormDraft {
  teamId: number;
  riders: RiderDraft[];
  notes: string;
  trainerPhone: string;
  bibDescription?: string;
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
  const { user, hasRole, canOrganise } = useAuth();
  const [forms, setForms] = useState<DeclarationForm[]>([]);
  const persistedDraft = readDecDraft(competition.id);
  const [draftTeam, setDraftTeam] = useState<Team | null>(() => {
    if (!persistedDraft) return null;
    return competition.teams.find((t) => t.id === persistedDraft.teamId) ?? null;
  });
  const [riders, setRiders] = useState<RiderDraft[]>(persistedDraft?.riders ?? []);
  const [notes, setNotes] = useState(persistedDraft?.notes ?? '');
  const [trainerPhone, setTrainerPhone] = useState(persistedDraft?.trainerPhone ?? '');
  const [bibDescription, setBibDescription] = useState(persistedDraft?.bibDescription ?? '');
  const [saveRoster, setSaveRoster] = useState(true);
  const [saved, setSaved] = useState<SavedRider[]>([]);
  const [busy, setBusy] = useState(false);

  // Auto-save the in-progress dec form so a reload doesn't wipe it.
  useEffect(() => {
    if (!draftTeam) return;
    const draft: DecFormDraft = { teamId: draftTeam.id, riders, notes, trainerPhone, bibDescription };
    try { localStorage.setItem(decDraftKey(competition.id), JSON.stringify(draft)); } catch { /* quota */ }
  }, [competition.id, draftTeam, riders, notes, trainerPhone, bibDescription]);

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

  // Trainers submit for the teams they coach, and a club's Team Manager for any team of their club.
  // Admins and people who organise this competition can submit for any team. The API enforces the same rule.
  const myTeams = useMemo(() => {
    if (hasRole('Admin') || canOrganise(competition)) return competition.teams;
    if (!user) return [];
    const manager = hasRole('Manager') && user.clubId != null;
    return competition.teams.filter((t) => t.trainerUserId === user.id || (manager && t.clubId === user.clubId));
  }, [competition, hasRole, canOrganise, user]);

  useEffect(() => {
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: competition.id } })
      .then((r) => setForms(r.data));
  }, [competition.id]);

  // A team has one declaration: opening it again edits that form instead of starting a blank one.
  function startNew(team: Team) {
    setDraftTeam(team);
    const existing = forms.find((f) => f.teamId === team.id);
    if (existing) {
      setRiders(existing.riders.slice().sort((a, b) => a.orderIndex - b.orderIndex).map((r) => ({
        savedRiderId: r.savedRiderId ?? null,
        fullName: r.fullName,
        horseName: r.horseName ?? '',
        isCaptain: r.isCaptain,
        isReserve: r.isReserve,
        isGuestRider: r.isGuestRider ?? false,
        useInitialOnly: r.useInitialOnly ?? false,
        noFilming: r.noFilming ?? false,
      })));
      setNotes(existing.notes ?? '');
      setBibDescription(existing.bibDescription ?? team.bibDescription ?? '');
    } else {
      setRiders([blankRider(true)]);
      setNotes('');
      setBibDescription(team.bibDescription ?? '');
    }
    // Pre-fill phone from prior submission by this trainer if any
    const prior = forms.find((f) => f.submittedByUserId === user?.id && f.submittedByPhone);
    setTrainerPhone(prior?.submittedByPhone ?? '');
    api.get<SavedRider[]>(`/clubs/${team.clubId}/saved-riders`)
      .then((r) => setSaved(r.data))
      .catch(() => setSaved([]));
  }

  function addRider(isGuestRider = false) {
    setRiders((r) => [...r, { ...blankRider(), isGuestRider }]);
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
      useInitialOnly: sr.useInitialOnly ?? false,
      noFilming: sr.noFilming ?? false,
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
        bibDescription: bibDescription.trim(),
        riders: riders
          .filter((r) => r.fullName.trim())
          .map((r, i) => ({
            savedRiderId: r.savedRiderId ?? null,
            fullName: r.fullName.trim(),
            horseName: r.horseName.trim() || null,
            isCaptain: r.isCaptain,
            isReserve: r.isReserve,
            isGuestRider: r.isGuestRider,
            useInitialOnly: r.useInitialOnly,
            noFilming: r.noFilming,
            orderIndex: i,
            dateOfBirth: null,
          })),
      });
      setForms((cur) => [data, ...cur.filter((f) => f.teamId !== data.teamId)]);
      setDraftTeam(null);
      setRiders([]);
      setNotes('');
      setBibDescription('');
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
    const header = ['Team', 'Captain', 'Reserve', 'Guest', 'Rider', 'DOB', 'Horse', 'Bibs', 'Submitted by', 'Phone', 'Submitted at', 'Notes'];
    const rows: ReadonlyArray<string>[] = [];
    for (const f of forms) {
      const riders = f.riders.slice().sort((a, b) => a.orderIndex - b.orderIndex);
      for (const r of riders) {
        rows.push([
          f.teamName,
          r.isCaptain ? 'yes' : '',
          r.isReserve ? 'yes' : '',
          r.isGuestRider ? 'yes' : '',
          r.fullName,
          r.dateOfBirth ? new Date(r.dateOfBirth).toLocaleDateString() : '',
          r.horseName ?? '',
          f.bibDescription ?? '',
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
            {myTeams.map((t) => {
              const hasForm = forms.some((f) => f.teamId === t.id);
              return (
                <button key={t.id} onClick={() => startNew(t)} className="btn-ghost !py-1.5 !px-2.5 text-xs">
                  <Plus className="w-3.5 h-3.5" /> {hasForm ? 'Edit' : 'New'} for {t.displayName}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {draftTeam && (
        <div className="card p-3 sm:p-4">
          <h3 className="font-semibold mb-3 text-sm">{forms.some((f) => f.teamId === draftTeam.id) ? 'Edit' : 'New'} dec form — {draftTeam.displayName}</h3>

          <label className="block mb-3">
            <span className="text-xs text-slate-500 dark:text-slate-300">What do the team's bibs look like?</span>
            <input
              className="input mt-1 text-sm"
              maxLength={200}
              placeholder="e.g. Red bibs, numbered 1 to 5"
              value={bibDescription}
              onChange={(e) => setBibDescription(e.target.value)}
            />
          </label>

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
                  <select
                    className="input col-span-12 sm:col-span-3 text-sm"
                    aria-label="Saved rider"
                    value={r.savedRiderId ?? ''}
                    onChange={(e) => e.target.value ? pickSaved(i, parseInt(e.target.value, 10)) : updateRider(i, { savedRiderId: null })}
                  >
                    <option value="">— pick saved —</option>
                    {saved.map((s) => (
                      <option key={s.id} value={s.id}>{s.fullName}{s.horseName ? ` / ${s.horseName}` : ''}</option>
                    ))}
                  </select>
                  <input
                    className="input col-span-12 sm:col-span-4 text-sm" placeholder={r.isGuestRider ? 'Guest rider name' : 'Rider name'}
                    value={r.fullName}
                    onChange={(e) => updateRider(i, { fullName: e.target.value, savedRiderId: null })}
                  />
                  <input
                    className="input col-span-8 sm:col-span-3 text-sm" placeholder="Horse"
                    value={r.horseName}
                    onChange={(e) => updateRider(i, { horseName: e.target.value })}
                  />
                  <div className="col-span-4 sm:col-span-1 flex justify-end gap-2 items-center">
                    <label title="Captain" className="cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={r.isCaptain}
                        onChange={(e) => updateRider(i, { isCaptain: e.target.checked })} />
                      <Star className={`w-4 h-4 ${r.isCaptain ? 'text-amber-500 fill-amber-500' : 'text-slate-400'}`} />
                    </label>
                    <label title="Guest rider" className="cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={r.isGuestRider}
                        onChange={(e) => updateRider(i, { isGuestRider: e.target.checked, savedRiderId: null })} />
                      <UserPlus className={`w-4 h-4 ${r.isGuestRider ? 'text-emerald-600' : 'text-slate-400'}`} />
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
                  <RiderPrivacyFields className="col-span-12" value={r} onChange={(patch) => updateRider(i, patch)} />
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => addRider()} className="btn-ghost !py-1.5 !px-2.5 text-xs">
                <Plus className="w-3.5 h-3.5" /> Add rider
              </button>
              <button onClick={() => addRider(true)} className="btn-ghost !py-1.5 !px-2.5 text-xs">
                <UserPlus className="w-3.5 h-3.5" /> Add guest rider
              </button>
            </div>
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
                  setBibDescription('');
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
      {f.bibDescription && <p className="mb-2 text-[11px] text-slate-600 dark:text-slate-200">Bibs: {f.bibDescription}</p>}
      <ol className="space-y-1">
        {f.riders.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-xs">
            <span className="font-medium truncate flex-1 text-slate-900 dark:text-slate-50">
              {r.fullName}
              {r.isCaptain && <Star className="inline w-3 h-3 ml-1 text-amber-500 fill-amber-500" />}
              {r.isReserve && <Shield className="inline w-3 h-3 ml-1 text-sky-500 fill-sky-500" />}
              {r.isGuestRider && <span className="ml-1.5 rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-bold uppercase text-emerald-800">Guest</span>}
            </span>
            <span className="text-slate-500 dark:text-slate-300 truncate">{r.horseName ?? '—'}</span>
          </li>
        ))}
      </ol>
      {f.notes && <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-300 italic">"{f.notes}"</p>}
    </div>
  );
}
