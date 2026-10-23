import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Download, Flag, LogIn, Shield, Trash2 } from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { DeclarationForm, RiderEntry, Team } from '../../types';
import { toCsv, downloadCsv, safeFilename } from '../../lib/csv';
import { decDraftKey, dobText, heightText, parseDraft, ridersRequired, type DecFormDraft } from '../../lib/decForm';
import { DecFormEditor } from './decform/DecFormEditor';
import { parseConfigResponse, STANDARD_CONFIG, type DecFormConfig } from '../../lib/decFormConfig';

function readDraft(competitionId: number, teamId: number, required: number): DecFormDraft | null {
  try { return parseDraft(localStorage.getItem(decDraftKey(competitionId, teamId)), required); } catch { return null; }
}

export function DeclarationsTab() {
  const { competition } = useCompetition();
  const { user, hasRole, canOrganise } = useAuth();
  const [params] = useSearchParams();
  // null until the forms have come back, so the editor starts from the team's real declaration.
  const [forms, setForms] = useState<DeclarationForm[] | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  // What this competition's dec form asks. Null until it has come back; the standard form if it can't be fetched.
  const [config, setConfig] = useState<DecFormConfig | null>(null);

  // Trainers submit for the teams they coach, and a club's Team Manager for any team of their club.
  // Admins and people who organise this competition can submit for any team. The API enforces the same rule.
  const myTeams = useMemo(() => {
    if (hasRole('Admin') || canOrganise(competition)) return competition.teams;
    if (!user) return [];
    const manager = hasRole('Manager') && user.clubId != null;
    return competition.teams.filter((t) => t.trainerUserId === user.id || (manager && t.clubId === user.clubId));
  }, [competition, hasRole, canOrganise, user]);

  useEffect(() => {
    let cancelled = false;
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: competition.id } })
      .then((r) => { if (!cancelled) setForms(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (!cancelled) setForms([]); });
    return () => { cancelled = true; };
  }, [competition.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let loaded: DecFormConfig = STANDARD_CONFIG;
      try {
        const { data } = await api.get(`/competitions/${competition.id}/dec-form-config`);
        loaded = parseConfigResponse(data)?.config ?? STANDARD_CONFIG;
      } catch { /* the standard form is a safe fallback */ }
      if (!cancelled) setConfig(loaded);
    })();
    return () => { cancelled = true; };
  }, [competition.id]);

  // The link from the profile names the team; otherwise a half-done form comes back, and a lone team opens itself.
  const wanted = Number(params.get('team'));
  const requiredFor = (t: Team) => ridersRequired(competition.sections.find((s) => s.id === t.competitionSectionId)?.format);
  const withDraft = useMemo(
    () => myTeams.find((t) => readDraft(competition.id, t.id, ridersRequired(competition.sections.find((s) => s.id === t.competitionSectionId)?.format)) !== null),
    [competition.id, competition.sections, myTeams],
  );
  const automatic = myTeams.find((t) => t.id === wanted) ?? withDraft ?? (myTeams.length === 1 ? myTeams[0] : undefined);
  const team = myTeams.find((t) => t.id === chosen) ?? automatic;
  const existing = team ? forms?.find((f) => f.teamId === team.id) : undefined;
  // Read when a team is opened, so unfinished work comes back but a form that has since been sent doesn't.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the draft is only looked up when the team changes
  const draft = useMemo(() => (team ? readDraft(competition.id, team.id, requiredFor(team)) : null), [competition.id, team?.id]);
  const priorPhone = forms?.find((f) => f.submittedByUserId === user?.id && f.submittedByPhone)?.submittedByPhone ?? undefined;

  async function remove(id: number) {
    await api.delete(`/declaration-forms/${id}`);
    setForms((cur) => cur?.filter((f) => f.id !== id) ?? cur);
  }

  function saved(form: DeclarationForm) {
    setForms((cur) => [form, ...(cur ?? []).filter((f) => f.teamId !== form.teamId)]);
  }

  function exportCsv() {
    const header = ['Team', 'Rider', 'Reserve', 'Guest', 'DOB', 'Pony', 'Height (hh)', 'Bibs', 'Trainer', 'Phone', 'Submitted by', 'Terms agreed', 'Submitted at', 'Notes'];
    // The answers an organiser added are only in the file when someone gave one (the API only sends them to staff and the submitter).
    const allRiders = (forms ?? []).flatMap((f) => f.riders);
    const customFields = (config ?? STANDARD_CONFIG).customFields;
    const everyColumn: { title: string; value: (r: RiderEntry) => string }[] = [
      { title: 'Birth year', value: (r) => (r.birthYear == null ? '' : String(r.birthYear)) },
      { title: 'Age group', value: (r) => r.ageGroup ?? '' },
      { title: 'Weight (kg)', value: (r) => (r.weightKg == null ? '' : String(r.weightKg)) },
      { title: 'Pony passport or ID', value: (r) => r.ponyPassportNumber ?? '' },
      { title: 'Pony age', value: (r) => (r.ponyAge == null ? '' : String(r.ponyAge)) },
      { title: 'Membership number', value: (r) => r.membershipNumber ?? '' },
      { title: 'Emergency contact', value: (r) => r.emergencyContactName ?? '' },
      { title: 'Emergency phone', value: (r) => r.emergencyContactPhone ?? '' },
      { title: 'Medical notes', value: (r) => r.medicalNotes ?? '' },
      ...customFields.map((c) => ({ title: c.label, value: (r: RiderEntry) => r.customValues?.[c.id] ?? '' })),
      { title: 'Flags', value: (r) => (r.flags ?? []).join(' ') },
    ];
    const extraColumns = everyColumn.filter((c) => allRiders.some((r) => c.value(r) !== ''));
    const rows: ReadonlyArray<string>[] = [];
    for (const f of forms ?? []) {
      const riders = f.riders.slice().sort((a, b) => a.orderIndex - b.orderIndex);
      for (const r of riders) {
        rows.push([
          f.teamName,
          r.fullName,
          r.isReserve ? 'yes' : '',
          r.isGuestRider ? 'yes' : '',
          dobText(r.dateOfBirth),
          r.horseName ?? '',
          heightText(r.ponyHeightHands),
          f.bibDescription ?? '',
          f.trainerName ?? f.submittedByName ?? '',
          f.trainerPhone ?? f.submittedByPhone ?? '',
          f.submittedByName ?? '',
          f.termsAcceptedAt ? new Date(f.termsAcceptedAt).toLocaleString() : '',
          new Date(f.submittedAt).toLocaleString(),
          f.notes ?? '',
          ...extraColumns.map((c) => c.value(r)),
        ]);
      }
    }
    downloadCsv(`${safeFilename(competition.name)}-dec-forms.csv`, toCsv([...header, ...extraColumns.map((c) => c.title)], rows));
  }

  const count = forms?.length ?? 0;

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex justify-end">
        <button onClick={exportCsv} disabled={count === 0} className="btn-ghost !px-2.5 !py-1.5 text-xs" title="Download all submitted dec forms as CSV">
          <Download className="h-3.5 w-3.5" /> Export CSV ({count})
        </button>
      </div>

      {!user ? (
        <div className="mg-notice flex items-center gap-2.5">
          <LogIn aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="flex-1">Sign in as a trainer to submit declaration forms for your teams.</span>
          <Link to="/login" className="mg-btn mg-btn-primary !min-h-11 !text-sm">Sign in</Link>
        </div>
      ) : myTeams.length === 0 ? (
        <p className="text-sm text-[rgb(var(--mg-muted))]">You have no teams in this competition.</p>
      ) : (
        <>
          {myTeams.length > 1 && (
            <div role="group" aria-label="Choose a team" className="mg-chips">
              {myTeams.map((t) => (
                <button key={t.id} type="button" className="mg-chip" aria-pressed={team?.id === t.id} onClick={() => setChosen(t.id)}>
                  {forms?.some((f) => f.teamId === t.id) && <Check aria-hidden="true" className="h-4 w-4" />}
                  {t.displayName}
                </button>
              ))}
            </div>
          )}
          {team && forms && config && (
            <DecFormEditor key={team.id} competition={competition} team={team} existing={existing} draft={draft}
              priorPhone={priorPhone} onSaved={saved} config={config} />
          )}
        </>
      )}

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {forms?.length === 0 && (
          <div className="card p-3 text-xs text-[rgb(var(--mg-muted))]">No declaration forms submitted yet.</div>
        )}
        {forms?.map((f) => <DecFormCard key={f.id} f={f} config={config ?? STANDARD_CONFIG} onDelete={() => remove(f.id)} canDelete={user != null} />)}
      </div>
    </div>
  );
}

interface CardProps { f: DeclarationForm; config: DecFormConfig; onDelete: () => void; canDelete: boolean }

/** The extra answers a rider gave, as one quiet line. Only staff and the submitter are ever sent them. */
function detailLine(r: RiderEntry, config: DecFormConfig): string {
  const parts = [
    r.birthYear != null ? `born ${r.birthYear}` : null,
    r.ageGroup,
    r.weightKg != null ? `${r.weightKg} kg` : null,
    r.ponyAge != null ? `pony ${r.ponyAge} yrs` : null,
    r.ponyPassportNumber ? `passport ${r.ponyPassportNumber}` : null,
    r.membershipNumber ? `member ${r.membershipNumber}` : null,
    r.emergencyContactName ? `emergency: ${r.emergencyContactName}${r.emergencyContactPhone ? ` ${r.emergencyContactPhone}` : ''}` : null,
    r.medicalNotes ? `medical: ${r.medicalNotes}` : null,
    ...config.customFields.map((c) => (r.customValues?.[c.id] ? `${c.label}: ${r.customValues[c.id]}${c.unit ? ` ${c.unit}` : ''}` : null)),
  ];
  return parts.filter(Boolean).join(' · ');
}

function DecFormCard({ f, config, onDelete, canDelete }: CardProps) {
  return (
    <div className="card p-3">
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <span className="truncate">{f.teamName}</span>
            {(f.flagCount ?? 0) > 0 && (
              <span className="mg-flag inline-flex shrink-0 items-center gap-1 !px-1.5 !py-0.5 !text-[11px]" title="Someone's answer is outside the limits set for this event">
                <Flag aria-hidden="true" className="h-3 w-3" />{f.flagCount} flagged
              </span>
            )}
          </h3>
          {f.entryTeamName && f.entryTeamName.trim().toLowerCase() !== f.teamName.trim().toLowerCase() && (
            <p className="text-[11px] text-[rgb(var(--mg-muted))]">Entered as {f.entryTeamName}</p>
          )}
          <p className="text-[11px] text-[rgb(var(--mg-muted))]">
            Trainer: <span className="font-medium text-[rgb(var(--mg-ink))]">{f.trainerName ?? f.submittedByName ?? '—'}</span>
            {(f.trainerPhone ?? f.submittedByPhone) && <span className="ml-1"> · {f.trainerPhone ?? f.submittedByPhone}</span>}
          </p>
          <p className="text-[10px] text-[rgb(var(--mg-faint))]">
            Submitted {new Date(f.submittedAt).toLocaleString()}
          </p>
        </div>
        {canDelete && (
          <button onClick={onDelete} className="text-rose-500 hover:text-rose-700" title="Delete" aria-label={`Delete the dec form for ${f.teamName}`}>
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      {f.bibDescription && <p className="mb-2 text-[11px] text-[rgb(var(--mg-body))]">Bibs: {f.bibDescription}</p>}
      <ol className="space-y-1">
        {f.riders.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-2 text-xs">
            <span className="flex-1 truncate font-medium text-[rgb(var(--mg-ink))]">
              {r.fullName}
              {r.isReserve && <Shield aria-label="Reserve" className="ml-1 inline h-3 w-3 text-sky-500" />}
              {r.isGuestRider && <span className="ml-1.5 rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-bold uppercase text-emerald-800">Guest</span>}
            </span>
            <span className="truncate text-[rgb(var(--mg-muted))]">
              {r.horseName ?? '—'}{r.ponyHeightHands != null ? ` · ${heightText(r.ponyHeightHands)} hh` : ''}
            </span>
            {detailLine(r, config) && <span className="basis-full text-[11px] text-[rgb(var(--mg-muted))]">{detailLine(r, config)}</span>}
            {r.flags?.map((flag) => <span key={flag} className="mg-flag basis-full">{flag}</span>)}
          </li>
        ))}
      </ol>
      {f.notes && <p className="mt-2 text-[11px] italic text-[rgb(var(--mg-muted))]">"{f.notes}"</p>}
    </div>
  );
}
