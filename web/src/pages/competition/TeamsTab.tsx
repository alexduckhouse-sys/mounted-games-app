import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Users, Plus, Save, ClipboardList, Ban, Star, Flag } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useFavourites } from '../../hooks/useFavourites';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { Club, DeclarationForm, Team } from '../../types';
import { bibAccent, bibLabel, parseBibAndFlag } from '../../lib/bib';
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
    clubName: '',
    teamName: '',
    suffix: 'A',
    suffixTouched: false,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.get<Club[]>('/clubs').then((r) => setClubs(r.data)).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!hasRole('Admin') && !hasRole('Trainer') && !hasRole('Manager') && !canOrganise(competition)) return;
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: competition.id } })
      .then((r) => {
        setDecFormTeamIds(new Set(r.data.map((f) => f.teamId)));
        setFlagged(new Map(r.data.filter((f) => (f.flagCount ?? 0) > 0).map((f) => [f.teamId, f.flagCount ?? 0])));
      })
      .catch(() => { setDecFormTeamIds(new Set()); setFlagged(new Map()); });
  }, [competition, hasRole, canOrganise]);

  // A new team starts on the competition's first section and the trainer's own club.
  const effectiveSuffix = draft.suffixTouched
    ? draft.suffix
    : draft.teamName.trim()
      ? ''
      : draft.suffix;
  const form = {
    ...draft,
    competitionSectionId: draft.competitionSectionId || competition.sections[0]?.id || competition.teams[0]?.competitionSectionId || 0,
    clubId: draft.clubId || user?.clubId || clubs[0]?.id || 0,
    suffix: effectiveSuffix,
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
    const clubText = form.clubName.trim();
    const customName = form.teamName.trim();
    if ((!form.clubId && !clubText && !customName) || !form.competitionSectionId) return;
    const matchedClub = clubText
      ? clubs.find((c) => c.name.trim().toLowerCase() === clubText.toLowerCase())
      : undefined;
    setBusy(true);
    try {
      await api.post(`/competitions/${competition.id}/teams`, {
        competitionSectionId: form.competitionSectionId,
        clubId: clubText ? (matchedClub?.id ?? 0) : form.clubId,
        clubName: clubText || null,
        name: customName || null,
        suffix: form.suffix.trim(),
        bibColour: null,
        trainerUserId: null,
      });
      setShowForm(false);
      setDraft({ competitionSectionId: 0, clubId: 0, clubName: '', teamName: '', suffix: 'A', suffixTouched: false });
      reload();
    } finally {
      setBusy(false);
    }
  }

  const canCreate = hasRole('Trainer') || hasRole('Admin') || hasRole('Manager') || canOrganise(competition);

  const addButton = canCreate && (
    <button onClick={() => setShowForm((s) => !s)} className="mg-btn mg-btn-primary !min-h-10 !px-3.5 !py-2 text-sm">
      <Plus className="h-4 w-4" /> {showForm ? 'Close' : 'Add custom team'}
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
        <form onSubmit={submit} className="mg-card grid gap-3 p-4 sm:grid-cols-12">
          <label className="sm:col-span-3">
            <span className="text-xs font-semibold text-[rgb(var(--mg-muted))]">Section</span>
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
          <label className="sm:col-span-3">
            <span className="text-xs font-semibold text-[rgb(var(--mg-muted))]">Club</span>
            <SelectField
              className="input mt-1"
              value={form.clubId}
              onChange={(e) => setDraft({ ...form, clubId: parseInt(e.target.value, 10), clubName: '' })}
            >
              <option value={0}>Choose a club</option>
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </SelectField>
          </label>
          <label className="sm:col-span-2">
            <span className="text-xs text-slate-500">New club / branch (optional)</span>
            <input
              className="input mt-1"
              list="mg-clubs-datalist"
              placeholder="e.g. Stockport PC"
              value={form.clubName}
              onChange={(e) => setDraft({ ...form, clubName: e.target.value })}
            />
            <datalist id="mg-clubs-datalist">
              {clubs.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </label>
          <label className="sm:col-span-2">
            <span className="text-xs text-slate-500">Team name</span>
            <input
              className="input mt-1"
              placeholder="e.g. Welsh Dragons (optional)"
              value={form.teamName}
              onChange={(e) => setDraft({ ...form, teamName: e.target.value })}
            />
          </label>
          <label className="sm:col-span-2">
            <span className="text-xs text-slate-500">Suffix (optional)</span>
            <input
              className="input mt-1 uppercase" maxLength={4}
              placeholder="e.g. A"
              value={form.suffix}
              onChange={(e) => setDraft({ ...form, suffix: e.target.value, suffixTouched: true })}
            />
          </label>
          <div className="flex justify-end gap-2 sm:col-span-12">
            <button type="button" className="mg-btn mg-btn-secondary !min-h-10 !px-3.5 text-sm" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" disabled={busy || (!form.clubId && !form.clubName.trim() && !form.teamName.trim())} className="mg-btn mg-btn-primary !min-h-10 !px-3.5 text-sm">
              <Save className="h-4 w-4" /> {busy ? 'Creating…' : 'Create team'}
            </button>
          </div>
        </form>
      )}

      {grouped.map(([section, teams]) => (
        <div key={section} className="mg-card p-3 sm:p-4">
          <h3 className="mg-display mb-2 flex items-center gap-2 text-base font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">
            <Users className="h-4 w-4 text-[rgb(var(--mg-heading))]" /> {displaySectionName(section)}
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((t) => {
              const hasDec = decFormTeamIds.has(t.id);
              const parsedBib = parseBibAndFlag(t.bibDescription);
              return (
                <div key={t.id}
                  className={`flex items-center gap-2 rounded-lg border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-subtle))] p-2.5 text-[rgb(var(--mg-ink))] ${
                    t.isHorsConcours || t.isWithdrawn ? 'opacity-70' : ''
                  }`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate text-sm font-semibold">
                      {parsedBib.flag && <img src={`/flags/${parsedBib.flag}.png`} alt="" className="h-3.5 w-5 shrink-0 rounded-[2px] object-cover" />}
                      <Link to={`/competitions/${competition.id}/teams/${t.id}`} className="truncate text-[rgb(var(--mg-heading))] hover:underline">
                        {t.displayName}
                      </Link>
                      {hasDec && (
                        <span title="Dec form submitted" className="mg-tag mg-tag-ok inline-flex items-center gap-0.5 !rounded-full !px-1.5 !py-0.5 !text-[9px]">
                          <ClipboardList className="h-2.5 w-2.5" /> DEC
                        </span>
                      )}
                      {flagged.has(t.id) && (
                        <span title="A dec form answer is outside the limits set for this event" className="mg-flag inline-flex items-center gap-0.5 !rounded-full !px-1.5 !py-0.5 !text-[9px]">
                          <Flag className="h-2.5 w-2.5" aria-hidden="true" /> {flagged.get(t.id)} flagged
                        </span>
                      )}
                      {t.isWithdrawn && (
                        <span title="Withdrawn from the rest of the event" className="mg-tag mg-tag-late inline-flex items-center gap-0.5 !rounded-full !px-1.5 !py-0.5 !text-[9px]">
                          Withdrawn
                        </span>
                      )}
                      {t.isHorsConcours && (
                        <span title="Hors Concours: competes without scoring" className="mg-tag inline-flex items-center gap-0.5 !rounded-full !px-1.5 !py-0.5 !text-[9px]">
                          <Ban className="h-2.5 w-2.5" /> HC
                        </span>
                      )}
                    </div>
                    {parsedBib.bib && (
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[rgb(var(--mg-body))]">
                        <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/15" style={{ background: bibAccent(t.bibDescription) }} />
                        <span className="truncate">{bibLabel(t.bibDescription)}</span>
                      </div>
                    )}
                    {mayAssignTrainers ? (
                      <TrainerPicker competitionId={competition.id} team={t} onSaved={reload} />
                    ) : (
                      <div className="truncate text-[10px] text-[rgb(var(--mg-muted))]">
                        {t.trainerName ?? 'No trainer assigned'}
                      </div>
                    )}
                  </div>
                  <button className="mg-icon-btn" aria-pressed={followed.has(t.id)} aria-label={`${followed.has(t.id) ? 'Unfollow' : 'Follow'} ${t.displayName}`} onClick={() => toggle({ competitionId: competition.id, teamId: t.id })}>
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
                      className={`mg-small-btn !min-h-9 !px-2 !text-[10px] ${
                        t.isHorsConcours ? '!text-[rgb(var(--mg-ok))]' : '!text-[rgb(var(--mg-muted))]'
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
    <div className="space-y-3 pt-2">
      <Link className="mg-btn mg-btn-secondary" to="../following"><Star className="h-4 w-4" />View followed teams</Link>
      {favouriteError && <p role="alert" className="mg-notice">{favouriteError}</p>}
      {desktop ? (
        <PageGrid variant="left" aside={sectionRail}>
          <div className="space-y-3">
            {teamBlocks}
          </div>
        </PageGrid>
      ) : (
        <>
        <div className="mg-card flex flex-wrap items-center gap-2 p-2.5">
          <div className="mg-chips flex-1">
            <button
              type="button"
              aria-pressed={sectionId === 'all'}
              onClick={() => setSectionId('all')}
              className="mg-chip !min-h-9 !px-3 !text-sm"
            >
              All sections
            </button>
            {competition.sections.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={sectionId === s.id}
                onClick={() => setSectionId(s.id)}
                className="mg-chip !min-h-9 !px-3 !text-sm"
              >
                {s.displayName}
              </button>
            ))}
          </div>
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
    <label className="block text-[10px] text-[rgb(var(--mg-muted))]">
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
      {error && <span role="alert" className="text-[rgb(var(--mg-elim))]"> Could not change the trainer.</span>}
    </label>
  );
}
