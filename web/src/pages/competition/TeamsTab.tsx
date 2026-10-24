import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Users, Plus, Save, ClipboardList, Ban, Star, Flag } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useFavourites } from '../../hooks/useFavourites';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { Club, DeclarationForm, Team } from '../../types';
import { displaySectionName } from '../../lib/section';
import { SelectField } from '../../components/SelectField';
import { PageGrid } from '../../components/PageGrid';
import { usePageWidth } from '../../components/pageWidthState';
import { useIsDesktop } from '../../hooks/useMediaQuery';

export function TeamsTab() {
  usePageWidth('wide');
  const desktop = useIsDesktop();
  const { competition, reload } = useCompetition();
  const { favourites, error: favouriteError, toggle } = useFavourites();
  const followed = new Set(favourites.filter((item) => item.competitionId === competition.id).map((item) => item.teamId));
  const { user, hasRole, canEdit, canOrganise } = useAuth();
  const mayAssignTrainers = canEdit() || canOrganise(competition);
  const [sectionId, setSectionId] = useState<number | 'all'>('all');
  const [clubs, setClubs] = useState<Club[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [decFormTeamIds, setDecFormTeamIds] = useState<Set<number>>(new Set());
  // Riders flagged for breaking an organiser's limit, per team. The API only sends the count to staff and the submitter.
  const [flagged, setFlagged] = useState<Map<number, number>>(new Map());

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
      .then((r) => {
        setDecFormTeamIds(new Set(r.data.map((f) => f.teamId)));
        setFlagged(new Map(r.data.filter((f) => (f.flagCount ?? 0) > 0).map((f) => [f.teamId, f.flagCount ?? 0])));
      })
      .catch(() => { setDecFormTeamIds(new Set()); setFlagged(new Map()); });
  }, [competition.id, hasRole]);

  // A new team starts on the competition's first section and the trainer's own club. These
  // defaults fill the zero placeholders on the way out rather than being copied into state.
  const form = {
    ...draft,
    competitionSectionId: draft.competitionSectionId || competition.sections[0]?.id || 0,
    clubId: draft.clubId || user?.clubId || 0,
  };

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
    if (!form.clubId || !form.competitionSectionId) return;
    setBusy(true);
    try {
      await api.post(`/competitions/${competition.id}/teams`, {
        competitionSectionId: form.competitionSectionId,
        clubId: form.clubId,
        suffix: form.suffix.trim() || 'A',
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

  const addButton = canCreate && (
    <button onClick={() => setShowForm((s) => !s)} className="btn-primary !py-2">
      <Plus className="w-4 h-4" /> {showForm ? 'Close' : 'Add custom team'}
    </button>
  );
  const sectionRail = (
    <nav aria-label="Sections" className="flex flex-col gap-3">
      <div className="mg-card overflow-hidden">
        <h2 className="mg-display border-b-2 border-[rgb(var(--mg-heading))] px-3 py-2 text-[15px] font-bold uppercase tracking-[0.05em] text-[rgb(var(--mg-heading))]">Sections</h2>
        <ul className="m-0 list-none p-0">
          {([['all', 'All sections', competition.teams.length], ...competition.sections.map((sec) => [sec.id, sec.displayName, competition.teams.filter((t) => t.competitionSectionId === sec.id).length])] as [number | 'all', string, number][]).map(([id, label, count]) => (
            <li key={id} className="border-b border-[rgb(var(--mg-rule-soft))] last:border-b-0">
              <button type="button" aria-pressed={sectionId === id} onClick={() => setSectionId(id)}
                className={`flex min-h-11 w-full items-center gap-2 px-3 text-left text-[15px] ${sectionId === id ? 'bg-[rgb(var(--mg-tint))] font-bold text-[rgb(var(--mg-heading))]' : 'font-medium text-[rgb(var(--mg-ink))] hover:bg-[rgb(var(--mg-subtle))]'}`}>
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <span className="shrink-0 text-xs text-[rgb(var(--mg-muted))]">{count}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {addButton}
    </nav>
  );
  const teamBlocks = (
    <>
      {showForm && canCreate && (
        <form onSubmit={submit} className="card p-5 grid sm:grid-cols-12 gap-3">
          <label className="sm:col-span-5">
            <span className="text-xs text-slate-500">Section</span>
            <SelectField
              className="input mt-1"
              value={form.competitionSectionId}
              onChange={(e) => setDraft({ ...form, competitionSectionId: parseInt(e.target.value, 10) })}
              required
            >
              {competition.sections.map((s) => (
                <option key={s.id} value={s.id}>{s.displayName}</option>
              ))}
            </SelectField>
          </label>
          <label className="sm:col-span-5">
            <span className="text-xs text-slate-500">Club</span>
            <SelectField
              className="input mt-1"
              value={form.clubId}
              onChange={(e) => setDraft({ ...form, clubId: parseInt(e.target.value, 10) })}
              required
            >
              <option value={0}>Choose a club</option>
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </SelectField>
          </label>
          <label className="sm:col-span-2">
            <span className="text-xs text-slate-500">Suffix</span>
            <input
              className="input mt-1 uppercase" maxLength={4}
              value={form.suffix}
              onChange={(e) => setDraft({ ...form, suffix: e.target.value })}
              required
            />
          </label>
          <div className="sm:col-span-12 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" disabled={busy || !form.clubId} className="btn-primary">
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
                    t.isHorsConcours || t.isWithdrawn ? 'opacity-70' : ''
                  }`}>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate flex items-center gap-1.5">
                      {t.displayName}
                      {hasDec && (
                        <span title="Dec form submitted" className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200 text-[9px] font-semibold">
                          <ClipboardList className="w-2.5 h-2.5" /> DEC
                        </span>
                      )}
                      {flagged.has(t.id) && (
                        <span title="A dec form answer is outside the limits set for this event" className="mg-flag inline-flex items-center gap-0.5 !rounded-full !px-1.5 !py-0.5 !text-[9px]">
                          <Flag className="w-2.5 h-2.5" aria-hidden="true" /> {flagged.get(t.id)} flagged
                        </span>
                      )}
                      {t.isWithdrawn && (
                        <span title="Withdrawn from the rest of the event" className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 text-[9px] font-semibold">
                          Withdrawn
                        </span>
                      )}
                      {t.isHorsConcours && (
                        <span title="Hors Concours: competes without scoring" className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-100 text-[9px] font-semibold">
                          <Ban className="w-2.5 h-2.5" /> HC
                        </span>
                      )}
                    </div>
                    {mayAssignTrainers ? (
                      <TrainerPicker competitionId={competition.id} team={t} onSaved={reload} />
                    ) : (
                      <div className="text-[10px] text-slate-400 truncate">
                        {t.trainerName ?? 'No trainer assigned'}
                      </div>
                    )}
                  </div>
                  <button className="btn-ghost min-h-11 min-w-11 !px-2" aria-pressed={followed.has(t.id)} aria-label={`${followed.has(t.id) ? 'Unfollow' : 'Follow'} ${t.displayName}`} onClick={() => toggle({ competitionId: competition.id, teamId: t.id })}>
                    <Star aria-hidden="true" className={`h-5 w-5 ${followed.has(t.id) ? 'fill-current' : ''}`} />
                  </button>
                  {canEdit() && (
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

    </>
  );

  return (
    <div className="space-y-4">
      <Link className="mg-btn mg-btn-secondary" to="../following"><Star className="h-4 w-4" />View followed teams</Link>
      {favouriteError && <p role="alert" className="mg-notice">{favouriteError}</p>}
      {desktop ? (
        <PageGrid variant="left" aside={sectionRail}>
          <div className="space-y-4">
            {teamBlocks}
          </div>
        </PageGrid>
      ) : (
        <>
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
          {canCreate && <span className="ml-auto">{addButton}</span>}
        </div>


          {teamBlocks}
        </>
      )}
    </div>
  );
}

/** Lets an organiser put one of the team's club trainers in charge of it. */
function TrainerPicker({ competitionId, team, onSaved }: { competitionId: number; team: Team; onSaved: () => void }) {
  const [trainers, setTrainers] = useState<{ userId: string; fullName: string }[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    api.get<{ userId: string; fullName: string }[]>(`/clubs/${team.clubId}/trainers`)
      .then((r) => setTrainers(r.data))
      .catch(() => setTrainers([]));
  }, [team.clubId]);
  // The current trainer stays selectable even if they belong to another club.
  const options = team.trainerUserId && !trainers.some((t) => t.userId === team.trainerUserId)
    ? [{ userId: team.trainerUserId, fullName: team.trainerName ?? 'Current trainer' }, ...trainers]
    : trainers;
  async function change(trainerUserId: string) {
    setError(false);
    try {
      await api.put(`/competitions/${competitionId}/teams/${team.id}`, { trainerUserId });
      onSaved();
    } catch { setError(true); }
  }
  return (
    <label className="block text-[10px] text-slate-400">
      <span className="sr-only">Trainer for {team.displayName}</span>
      <SelectField
        className="input !min-h-0 !py-0.5 text-[11px]"
        aria-label={`Trainer for ${team.displayName}`}
        value={team.trainerUserId ?? ''}
        onChange={(e) => void change(e.target.value)}
      >
        <option value="">No trainer assigned</option>
        {options.map((t) => <option key={t.userId} value={t.userId}>{t.fullName}</option>)}
      </SelectField>
      {error && <span role="alert" className="text-rose-600"> Could not change the trainer.</span>}
    </label>
  );
}
