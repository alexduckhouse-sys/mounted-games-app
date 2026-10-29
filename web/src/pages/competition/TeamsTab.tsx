import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { FollowStar } from '../../components/FollowStar';
import { Plus, Save, Search, X, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useFavourites } from '../../hooks/useFavourites';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { Club, DeclarationForm, Session, Team } from '../../types';
import { parseBibAndFlag } from '../../lib/bib';
import { displaySectionName } from '../../lib/section';
import { Notice } from '../../components/Notice';
import { Sheet } from '../../components/Sheet';
import { useDockAction } from '../../components/TickerContext';
import { SelectField } from '../../components/SelectField';
import { PageGrid } from '../../components/PageGrid';
import { usePageWidth } from '../../components/pageWidthState';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { useT } from '../../i18n/LanguageContext';
import '../../components/filterKit.css';
import './teams.css';
import { clubToShow } from '../../lib/teamNames';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { AgeGroupFilterButton, AgeGroupFilterSheet } from '../../components/AgeGroupFilter';

export function TeamsTab() {
  usePageWidth('wide');
  const t = useT();
  const desktop = useIsDesktop();
  const { competition, reload } = useCompetition();
  const { favourites, error: favouriteError, toggle } = useFavourites();
  const followed = new Set(favourites.filter((item) => item.competitionId === competition.id).map((item) => item.teamId));
  const { user, hasRole, canEdit, canOrganise } = useAuth();
  const mayAssignTrainers = canEdit() || canOrganise(competition);
  const [sectionId, setSectionId] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
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
  const [createError, setCreateError] = useState<string | null>(null);

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
    const query = search.trim().toLowerCase();
    const inSection = sectionId === 'all'
      ? competition.teams
      : competition.teams.filter((team) => team.competitionSectionId === sectionId);
    const filter = query
      ? inSection.filter((team) => `${team.displayName} ${team.clubName ?? ''}`.toLowerCase().includes(query))
      : inSection;
    const map = new Map<string, Team[]>();
    for (const team of filter) {
      const key = team.sectionName;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(team);
    }
    return Array.from(map.entries());
  }, [competition.teams, sectionId, search]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clubText = form.clubName.trim();
    const customName = form.teamName.trim();
    if ((!form.clubId && !clubText && !customName) || !form.competitionSectionId) return;
    const matchedClub = clubText
      ? clubs.find((c) => c.name.trim().toLowerCase() === clubText.toLowerCase())
      : undefined;
    setBusy(true);
    setCreateError(null);
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
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setCreateError(msg || "Couldn't create the team. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  const canCreate = hasRole('Trainer') || hasRole('Admin') || hasRole('Manager') || canOrganise(competition);

  // The team count sits apart from the event name, so a long name is cut short before the count is.
  const inAgeGroup = sectionId === 'all' ? competition.teams.length : competition.teams.filter((team) => team.competitionSectionId === sectionId).length;
  usePageHeader({
    title: t('teams.team.teams'),
    subtitle: competition.name,
    subtitleTail: t('teams.following.teamCount', { count: inAgeGroup }),
  });

  // Organisers add a team from the + beside the ticker dock; the form opens in a sheet.
  // Spectators get the age-group filter there instead (phones only: wider screens have the rail).
  const dockedFilter = !canCreate && !desktop;
  const docked = useDockAction(
    canCreate ? { label: t('teams.list.addCustom'), icon: 'plus', onClick: () => setShowForm(true) }
      : dockedFilter ? { label: t('teams.list.ageGroup'), icon: 'filters', count: sectionId === 'all' ? 0 : 1, onClick: () => setSheetOpen(true) } : null,
  );
  const addButton = canCreate && !docked && (
    <button onClick={() => setShowForm((s) => !s)} className="mg-btn mg-btn-primary !min-h-10 !px-3.5 !py-2 text-sm">
      <Plus className="h-4 w-4" /> {showForm ? t('common.close') : t('teams.list.addCustom')}
    </button>
  );
  const sectionRail = (
    <nav aria-label={t('teams.list.sections')} className="tm-rail">
      <div>
        <h2 className="fl-heading">{t('teams.list.sections')}</h2>
        <ul className="fl-list m-0 list-none p-0">
          {([['all', t('teams.list.allSections'), competition.teams.length], ...competition.sections.map((sec) => [sec.id, sec.displayName, competition.teams.filter((team) => team.competitionSectionId === sec.id).length])] as [number | 'all', string, number][]).map(([id, label, count]) => (
            <li key={id}>
              <button type="button" aria-pressed={sectionId === id} onClick={() => setSectionId(id)} className="fl-row">
                <span>{label}</span>
                <span>{count}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {addButton}
    </nav>
  );
  const addForm = (inSheet: boolean) => (
    <form onSubmit={submit} className={inSheet ? 'grid gap-3' : 'mg-card grid gap-3 p-4 sm:grid-cols-12'}>
      <label className="sm:col-span-3">
        <span className="text-xs font-semibold text-[rgb(var(--mg-muted))]">{t('teams.list.section')}</span>
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
        <span className="text-xs font-semibold text-[rgb(var(--mg-muted))]">{t('teams.list.club')}</span>
        <SelectField
          className="input mt-1"
          value={form.clubId}
          onChange={(e) => setDraft({ ...form, clubId: parseInt(e.target.value, 10), clubName: '' })}
        >
          <option value={0}>{t('teams.list.chooseClub')}</option>
          {clubs.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </SelectField>
      </label>
      <label className="sm:col-span-2">
        <span className="text-xs text-slate-500">{t('teams.list.newClub')}</span>
        <input
          className="input mt-1"
          list="mg-clubs-datalist"
          placeholder={t('teams.list.newClubPlaceholder')}
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
        <span className="text-xs text-slate-500">{t('teams.list.teamName')}</span>
        <input
          className="input mt-1"
          placeholder={t('teams.list.teamNamePlaceholder')}
          value={form.teamName}
          onChange={(e) => setDraft({ ...form, teamName: e.target.value })}
        />
      </label>
      <label className="sm:col-span-2">
        <span className="text-xs text-slate-500">{t('teams.list.suffix')}</span>
        <input
          className="input mt-1 uppercase" maxLength={4}
          placeholder={t('teams.list.suffixPlaceholder')}
          value={form.suffix}
          onChange={(e) => setDraft({ ...form, suffix: e.target.value, suffixTouched: true })}
        />
      </label>
      <div className="flex justify-end gap-2 sm:col-span-12">
        {createError && <div className="mr-auto"><Notice>{createError}</Notice></div>}
        <button type="button" className="mg-btn mg-btn-secondary !min-h-10 !px-3.5 text-sm" onClick={() => setShowForm(false)}>{t('common.cancel')}</button>
        <button type="submit" disabled={busy || (!form.clubId && !form.clubName.trim() && !form.teamName.trim())} className="mg-btn mg-btn-primary !min-h-10 !px-3.5 text-sm">
          <Save className="h-4 w-4" /> {busy ? t('teams.list.creating') : t('teams.list.create')}
        </button>
      </div>
    </form>
  );
  const teamBlocks = (
    <>
      {showForm && canCreate && !docked && addForm(false)}

      {grouped.map(([section, sectionTeams]) => (
        <section key={section} aria-label={displaySectionName(section)} className="tm-group">
          <h2 className="fl-heading">
            {displaySectionName(section)}
            <span>{teamsInGroup(t('teams.following.teamCount', { count: sectionTeams.length }), arenaOf(competition.sessions, sectionTeams[0]?.competitionSectionId))}</span>
          </h2>
          <ul className="fl-list m-0 list-none p-0">
            {sectionTeams.map((team) => {
              const parsedBib = parseBibAndFlag(team.bibDescription);
              const on = followed.has(team.id);
              // The club (only when the team's name doesn't already say it), then anything that changes how the team
              // rides here, all in the same quiet line. No line at all when there is nothing to add.
              const notes = [
                clubToShow(team.displayName, team.clubName) || null,
                team.isWithdrawn ? <span key="out" title={t('teams.list.withdrawnTitle')}>{t('teams.withdrawn')}</span> : null,
                team.isHorsConcours ? <span key="hc" title={t('teams.list.hcTitle')}>{t('teams.team.horsConcoursLower')}</span> : null,
                decFormTeamIds.has(team.id) ? <span key="dec">{t('teams.list.decTitle')}</span> : null,
                flagged.has(team.id) ? <span key="flag" className="tm-flagged" title={t('teams.list.flaggedTitle')}>{t('teams.list.flagged', { count: flagged.get(team.id) ?? 0 })}</span> : null,
              ].filter(Boolean);
              return (
                <li key={team.id} className={`fl-row tm-row${on ? ' tm-on' : ''}${team.isHorsConcours || team.isWithdrawn ? ' tm-out' : ''}`}>
                  <div className="fl-grow">
                    <Link to={`/competitions/${competition.id}/teams/${team.id}`} className="tm-link fl-title">
                      {parsedBib.flag && <img src={`/flags/${parsedBib.flag}.png`} alt="" className="tm-flag" />}
                      {team.displayName}
                    </Link>
                    {notes.length > 0 && <span className="fl-sub">{notes.flatMap((note, index) => (index ? [' · ', note] : [note]))}</span>}
                    {mayAssignTrainers && <div className="tm-over"><TrainerPicker competitionId={competition.id} team={team} onSaved={reload} /></div>}
                  </div>
                  {canEdit() && (
                    <button
                      onClick={async () => {
                        await api.put(`/competitions/${competition.id}/teams/${team.id}`, {
                          isHorsConcours: !team.isHorsConcours,
                        });
                        reload();
                      }}
                      title={team.isHorsConcours ? t('teams.list.markScoring') : t('teams.list.markHc')}
                      className={`mg-small-btn tm-over !min-h-11 !px-2.5 !text-[13px] ${
                        team.isHorsConcours ? '!text-[rgb(var(--mg-ok))]' : '!text-[rgb(var(--mg-muted))]'
                      }`}
                    >
                      {team.isHorsConcours ? t('teams.list.unmarkHcShort') : t('teams.list.markHcShort')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="tm-star tm-over"
                    aria-pressed={on}
                    aria-label={t(on ? 'teams.unfollow' : 'teams.follow', { name: team.displayName })}
                    onClick={() => toggle({ competitionId: competition.id, teamId: team.id })}
                  >
                    <FollowStar on={on} className="h-[22px] w-[22px]" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {grouped.length === 0 && search.trim() && <p className="fl-sub m-0">{t('teams.list.noMatch', { query: search.trim() })}</p>}

    </>
  );

  const searchField = (
    <label className="flex h-[46px] items-center gap-2.5 rounded-full border-[1.5px] border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))] px-4 text-[rgb(var(--mg-muted))] focus-within:border-[rgb(var(--mg-heading))]">
      <Search aria-hidden="true" className="h-[18px] w-[18px] shrink-0" strokeWidth={2.2} />
      <input
        type="search"
        aria-label={t('teams.list.find')}
        placeholder={t('teams.list.findPlaceholder')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="h-full min-w-0 flex-1 border-0 bg-transparent text-base text-[rgb(var(--mg-ink))] outline-none placeholder:text-[rgb(var(--mg-faint))]"
      />
    </label>
  );
  const sectionLabel = sectionId === 'all' ? '' : displaySectionName(competition.sections.find((sec) => sec.id === sectionId)?.displayName ?? '');
  const filterLabel = t('teams.list.ageGroup');
  const searchBar = desktop ? searchField : (
    <div className="fk-find">
      {searchField}
      {!(docked && dockedFilter) && <AgeGroupFilterButton label={filterLabel} active={!!sectionLabel} onClick={() => setSheetOpen(true)} />}
    </div>
  );
  const shownCount = (id: number | 'all') => (id === 'all' ? competition.teams : competition.teams.filter((team) => team.competitionSectionId === id)).length;

  // The sheets sit outside the page column, so its gap never lands on the dialog.
  return (
    <>
    <div className="mg-flat tm">
      {searchBar}
      {favouriteError && <Notice>{favouriteError}</Notice>}
      {desktop ? (
        <PageGrid variant="left" aside={sectionRail}>
          <div className="tm-group">
            {teamBlocks}
          </div>
        </PageGrid>
      ) : (
        <>
          {sectionLabel && (
            <div className="fk-chips">
              <button type="button" className="fk-chip" aria-label={`Remove ${sectionLabel}`} onClick={() => setSectionId('all')}>
                {sectionLabel}<X aria-hidden="true" size={15} strokeWidth={2.2} />
              </button>
            </div>
          )}
          {addButton && <div>{addButton}</div>}
          {teamBlocks}
        </>
      )}
    </div>
      {showForm && canCreate && docked && <Sheet title={t('teams.list.addCustom')} onClose={() => setShowForm(false)}>{addForm(true)}</Sheet>}
      {sheetOpen && !desktop && (
        <AgeGroupFilterSheet
          title={filterLabel}
          value={sectionId}
          shown={grouped.reduce((sum, [, list]) => sum + list.length, 0)}
          options={[{ id: 'all' as const, label: t('teams.list.allAgeGroups'), teams: shownCount('all') }, ...competition.sections.map((sec) => ({ id: sec.id, label: displaySectionName(sec.displayName), teams: shownCount(sec.id) }))]}
          onChange={setSectionId}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </>
  );
}

/** "7 teams · Main Arena": how many teams ride in an age group, and where when every session of it is in one arena. */
function teamsInGroup(counted: string, arena: string): string {
  return [counted, arena].filter(Boolean).join(' · ');
}

/** The one arena an age group's sessions use, or '' when it has none named or more than one. */
function arenaOf(sessions: Session[], sectionId: number | null | undefined): string {
  if (sectionId == null) return '';
  const arenas = new Set(sessions.filter((session) => session.competitionSectionId === sectionId && !session.isBreak).map((session) => session.arenaName?.trim()).filter((name): name is string => !!name));
  return arenas.size === 1 ? [...arenas][0] : '';
}

/** Lets an organiser put one of the team's club trainers in charge of it. */
function TrainerPicker({ competitionId, team, onSaved }: { competitionId: number; team: Team; onSaved: () => void }) {
  const t = useT();
  const [trainers, setTrainers] = useState<{ userId: string; fullName: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  // The club's trainers are fetched only when the organiser opens this picker, not for every team on the page.
  useEffect(() => {
    if (!open) return;
    api.get<{ userId: string; fullName: string }[]>(`/clubs/${team.clubId}/trainers`)
      .then((r) => setTrainers(r.data))
      .catch(() => setTrainers([]));
  }, [open, team.clubId]);
  // The current trainer stays selectable even if they belong to another club.
  const options = team.trainerUserId && !trainers.some((trainer) => trainer.userId === team.trainerUserId)
    ? [{ userId: team.trainerUserId, fullName: team.trainerName ?? t('teams.list.currentTrainer') }, ...trainers]
    : trainers;
  async function change(trainerUserId: string) {
    setError(false);
    try {
      await api.put(`/competitions/${competitionId}/teams/${team.id}`, { trainerUserId });
      onSaved();
    } catch { setError(true); }
  }
  if (!open) {
    return (
      <button type="button" className="relative inline-flex min-h-11 items-center gap-1 text-left text-[13px] text-[rgb(var(--mg-muted))] after:absolute after:-inset-x-1 after:inset-y-0 after:content-['']"
        aria-label={t('teams.list.changeTrainer', { name: team.displayName })} onClick={() => setOpen(true)}>
        <span className="truncate">{team.trainerName ?? t('teams.list.noTrainer')}</span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      </button>
    );
  }
  return (
    <label className="block text-[10px] text-[rgb(var(--mg-muted))]">
      <span className="sr-only">{t('teams.list.trainerFor', { name: team.displayName })}</span>
      <SelectField
        className="input !min-h-0 !py-0.5 text-[11px]"
        aria-label={t('teams.list.trainerFor', { name: team.displayName })}
        value={team.trainerUserId ?? ''}
        onChange={(e) => void change(e.target.value)}
      >
        <option value="">{t('teams.list.noTrainer')}</option>
        {options.map((trainer) => <option key={trainer.userId} value={trainer.userId}>{trainer.fullName}</option>)}
      </SelectField>
      {error && <Notice className="mt-1">{t('teams.list.trainerError')}</Notice>}
    </label>
  );
}
