import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Users, Plus, Save, ClipboardList, Ban } from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { Club, DeclarationForm, Team } from '../../types';
import { displaySectionName } from '../../lib/section';

export function TeamsTab() {
  const { competition, reload } = useCompetition();
  const { user, hasRole } = useAuth();
  const [sectionId, setSectionId] = useState<number | 'all'>('all');
  const [clubs, setClubs] = useState<Club[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [decFormTeamIds, setDecFormTeamIds] = useState<Set<number>>(new Set());

  const [draft, setDraft] = useState({
    competitionSectionId: 0,
    clubId: 0,
    suffix: 'A',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.get<Club[]>('/clubs').then((r) => setClubs(r.data)).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!hasRole('Admin') && !hasRole('Trainer')) return;
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: competition.id } })
      .then((r) => setDecFormTeamIds(new Set(r.data.map((f) => f.teamId))))
      .catch(() => setDecFormTeamIds(new Set()));
  }, [competition.id, hasRole]);

  useEffect(() => {
    if (showForm && competition.sections.length > 0) {
      setDraft((d) => ({
        ...d,
        competitionSectionId: d.competitionSectionId || competition.sections[0].id,
      }));
    }
  }, [showForm, competition.sections]);

  useEffect(() => {
    if (showForm && user?.clubId && draft.clubId === 0) {
      setDraft((d) => ({ ...d, clubId: user.clubId! }));
    }
  }, [showForm, user, draft.clubId]);

  const grouped = useMemo(() => {
    const filter = sectionId === 'all'
      ? competition.teams
      : competition.teams.filter((t) => t.competitionSectionId === sectionId);
    const map = new Map<string, Team[]>();
    for (const t of filter) {
      const key = t.sectionName;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries());
  }, [competition.teams, sectionId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft.clubId || !draft.competitionSectionId) return;
    setBusy(true);
    try {
      await api.post(`/competitions/${competition.id}/teams`, {
        competitionSectionId: draft.competitionSectionId,
        clubId: draft.clubId,
        suffix: draft.suffix.trim() || 'A',
        bibColour: null,
        trainerUserId: null,
      });
      setShowForm(false);
      setDraft({ competitionSectionId: 0, clubId: user?.clubId ?? 0, suffix: 'A' });
      reload();
    } finally {
      setBusy(false);
    }
  }

  const canCreate = hasRole('Trainer') || hasRole('Admin');

  return (
    <div className="space-y-4">
      <div className="card p-3 flex flex-wrap gap-2 items-center">
        <button
          onClick={() => setSectionId('all')}
          className={`pill ${sectionId === 'all' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'}`}
        >
          All sections
        </button>
        {competition.sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setSectionId(s.id)}
            className={`pill ${sectionId === s.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'}`}
          >
            {s.displayName}
          </button>
        ))}
        {canCreate && (
          <button onClick={() => setShowForm((s) => !s)} className="btn-primary !py-2 ml-auto">
            <Plus className="w-4 h-4" /> {showForm ? 'Close' : 'Add custom team'}
          </button>
        )}
      </div>

      {showForm && canCreate && (
        <form onSubmit={submit} className="card p-5 grid sm:grid-cols-12 gap-3">
          <label className="sm:col-span-5">
            <span className="text-xs text-slate-500">Section</span>
            <select
              className="input mt-1"
              value={draft.competitionSectionId}
              onChange={(e) => setDraft({ ...draft, competitionSectionId: parseInt(e.target.value, 10) })}
              required
            >
              {competition.sections.map((s) => (
                <option key={s.id} value={s.id}>{s.displayName}</option>
              ))}
            </select>
          </label>
          <label className="sm:col-span-5">
            <span className="text-xs text-slate-500">Club</span>
            <select
              className="input mt-1"
              value={draft.clubId}
              onChange={(e) => setDraft({ ...draft, clubId: parseInt(e.target.value, 10) })}
              required
            >
              <option value={0}>— pick club —</option>
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="sm:col-span-2">
            <span className="text-xs text-slate-500">Suffix</span>
            <input
              className="input mt-1 uppercase" maxLength={4}
              value={draft.suffix}
              onChange={(e) => setDraft({ ...draft, suffix: e.target.value })}
              required
            />
          </label>
          <div className="sm:col-span-12 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" disabled={busy || !draft.clubId} className="btn-primary">
              <Save className="w-4 h-4" /> {busy ? 'Creating…' : 'Create team'}
            </button>
          </div>
        </form>
      )}

      {grouped.map(([section, teams]) => (
        <div key={section} className="card p-3 sm:p-4">
          <h3 className="font-semibold flex items-center gap-2 mb-2 text-sm">
            <Users className="w-4 h-4 text-brand-600" /> {displaySectionName(section)}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {teams.map((t) => {
              const hasDec = decFormTeamIds.has(t.id);
              return (
                <div key={t.id}
                  className={`p-2.5 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-50 flex items-center gap-2 shadow-soft ${
                    t.isHorsConcours ? 'opacity-70' : ''
                  }`}>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate flex items-center gap-1.5">
                      {t.displayName}
                      {hasDec && (
                        <span title="Dec form submitted" className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200 text-[9px] font-semibold">
                          <ClipboardList className="w-2.5 h-2.5" /> DEC
                        </span>
                      )}
                      {t.isHorsConcours && (
                        <span title="Hors Concours — competes but does not score" className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-100 text-[9px] font-semibold">
                          <Ban className="w-2.5 h-2.5" /> HC
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {t.trainerName ?? 'No trainer assigned'}
                    </div>
                  </div>
                  {hasRole('Admin') && (
                    <button
                      onClick={async () => {
                        await api.put(`/competitions/${competition.id}/teams/${t.id}`, {
                          isHorsConcours: !t.isHorsConcours,
                        });
                        reload();
                      }}
                      title={t.isHorsConcours ? 'Mark as scoring' : 'Mark as Hors Concours (no score)'}
                      className={`btn-ghost !py-1 !px-1.5 text-[10px] ${
                        t.isHorsConcours ? 'text-emerald-600' : 'text-slate-500'
                      }`}
                    >
                      {t.isHorsConcours ? 'Unmark HC' : 'Mark HC'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
