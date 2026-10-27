import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Notice } from '../components/Notice';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n/LanguageContext';
import { tr } from '../i18n/translate';
import { usePageWidth } from '../components/pageWidthState';
import { usePageHeader } from '../components/CompactPageBarContext';
import { useMyTeams } from '../hooks/useMyTeams';
import { useTeamNotifications, type NotificationPermissionState } from '../hooks/useTeamNotifications';
import { heatRowsForTeam, heatSummary, heatTime, nextHeatRow, type TeamHeatRow } from '../lib/myTeams';
import { joinKeyFromSearch } from '../lib/sharing';
import { displaySectionName } from '../lib/section';
import type { DeclarationForm, Team } from '../types';
import { TrainerRequestsSection } from './admin/TrainerRequestsSection';
import { CodeRow, JoinTeamCard, ManageTeamBlock, SupportersBlock } from './MyTeamParts';
import { FollowingTeamsSection } from './FollowingPage';

/** "5 riders + reserve", from the team's dec form when there is one. */
function ridersText(form: DeclarationForm | undefined): string | null {
  if (!form) return null;
  const riders = form.riders.filter((r) => !r.isReserve).length;
  const reserve = form.riders.some((r) => r.isReserve);
  return `${tr('entries.riders', { count: riders })}${reserve ? tr('account.teams.plusReserve') : ''}`;
}

function FormChip({ team, form }: { team: Team; form: DeclarationForm | undefined }) {
  if (team.relationship !== 'trainer' && team.relationship !== 'manager') return null;
  return form
    ? <span className="mg-tag mg-tag-ok shrink-0">{tr('account.teams.formIn')}</span>
    : <span className="mg-tag shrink-0 !bg-[rgb(var(--mg-problem-bg))] !text-[rgb(var(--mg-problem-ink))]">{tr('account.teams.formDue')}</span>;
}

function RelationshipTag({ team }: { team: Team }) {
  if (team.relationship === 'manager') return <span className="mg-tag shrink-0">{tr('account.teams.yourClub')}</span>;
  if (team.relationship === 'supporter') return <span className="mg-tag shrink-0">{tr('account.teams.supporter')}</span>;
  return null;
}

export function MyTeamsPage() {
  const t = useT();
  usePageWidth('wide');
  const { user, hasRole } = useAuth();
  const { search } = useLocation();
  const { teams, forms, comps, loaded, reload } = useMyTeams();
  const notify = useTeamNotifications(teams);
  const [openId, setOpenId] = useState<number | null | undefined>(undefined);
  const [joining, setJoining] = useState(() => joinKeyFromSearch(search) !== '');
  const expandedId = openId === undefined ? teams[0]?.id ?? null : openId;

  const rowsByTeam = useMemo(() => {
    const out = new Map<number, TeamHeatRow[]>();
    for (const team of teams) {
      const comp = comps.get(team.competitionId);
      out.set(team.id, comp ? heatRowsForTeam(team, comp) : []);
    }
    return out;
  }, [teams, comps]);

  const clashByTeamId = useMemo(() => {
    const out = new Map<number, string>();
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const a = teams[i];
        const b = teams[j];
        if (a.competitionId !== b.competitionId) continue;
        const rowsA = (rowsByTeam.get(a.id) ?? []).filter((r) => r.status !== 'over');
        const rowsB = (rowsByTeam.get(b.id) ?? []).filter((r) => r.status !== 'over');
        const overlaps = rowsA.some((ra) =>
          rowsB.some((rb) => {
            if (ra.heatId === rb.heatId) return false;
            if (ra.status === 'live' && rb.status === 'live') return true;
            const ta = (ra.effective ?? ra.scheduled)?.getTime();
            const tb = (rb.effective ?? rb.scheduled)?.getTime();
            return ta != null && tb != null && Math.abs(ta - tb) < 20 * 60_000;
          }),
        );
        if (overlaps) {
          out.set(a.id, b.displayName);
          out.set(b.id, a.displayName);
        }
      }
    }
    return out;
  }, [teams, rowsByTeam]);

  const club = user?.clubName || teams.find((t) => t.relationship === 'manager' || t.relationship === 'trainer')?.clubName;
  usePageHeader({
    title: t('account.teams.title'),
    subtitle: [club, loaded ? t('account.teams.count', { count: teams.length }) : null].filter(Boolean).join(' · ') || undefined,
    plain: true,
    backTo: '/dashboard',
    backLabel: t('account.backToMe'),
  });

  return (
    <div className="mg-cards-grid mg-cards-grid-2 mx-auto flex w-full max-w-xl flex-col gap-2.5 pb-2 pt-3 lg:max-w-none">
      {teams.map((team) => {
        const rows = rowsByTeam.get(team.id) ?? [];
        const next = nextHeatRow(rows);
        const form = forms.find((f) => f.teamId === team.id);
        const section = displaySectionName(team.sectionName);
        const clashWith = clashByTeamId.get(team.id);
        if (team.id !== expandedId) {
          return (
            <button key={team.id} type="button" aria-expanded="false" onClick={() => setOpenId(team.id)}
              className="grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto_14px] items-center gap-x-2.5 rounded-[10px] border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))] py-2 pl-3.5 pr-2.5 text-left">
              <span className="flex min-w-0 flex-col gap-[3px]">
                <strong className="mg-display truncate text-xl font-bold leading-none text-[rgb(var(--mg-heading))]">{team.displayName}</strong>
                <span className="truncate text-xs text-[rgb(var(--mg-muted))]">{[section, next ? `${t('account.teams.next', { time: heatTime(next), label: next.label })}${next.arenaName ? ` · ${next.arenaName}` : ''}` : t('account.teams.noHeats')].join(' · ')}</span>
              </span>
              <span className="flex items-center gap-1.5">
                {clashWith && <span className="mg-tag shrink-0 !bg-[rgb(var(--mg-problem-bg))] !text-[rgb(var(--mg-problem-ink))]" title={t('account.teams.clashesWith', { name: clashWith })}>{t('account.teams.clash')}</span>}
                <RelationshipTag team={team} />
                <FormChip team={team} form={form} />
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-[rgb(var(--mg-faint))]" aria-hidden="true" />
            </button>
          );
        }
        return (
          <article key={team.id} aria-label={team.displayName} className="overflow-hidden rounded-[10px] border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))] lg:col-span-2">
            <div className="flex items-center gap-2.5 border-b border-[rgb(var(--mg-rule-soft))] py-3 pl-3.5 pr-3">
              <Link to={`/competitions/${team.competitionId}`} className="flex min-w-0 flex-1 flex-col gap-[3px] !text-[rgb(var(--mg-ink))]">
                <strong className="mg-display truncate text-xl font-bold leading-none text-[rgb(var(--mg-heading))]">{team.displayName}</strong>
                <span className="truncate text-xs text-[rgb(var(--mg-muted))]">{[section, ridersText(form), comps.get(team.competitionId)?.name].filter(Boolean).join(' · ')}</span>
              </Link>
              {clashWith && <span className="mg-tag shrink-0 !bg-[rgb(var(--mg-problem-bg))] !text-[rgb(var(--mg-problem-ink))]" title={t('account.teams.clashesWith', { name: clashWith })}>{t('account.teams.clash')}</span>}
              <RelationshipTag team={team} />
              <FormChip team={team} form={form} />
              <button type="button" onClick={() => setOpenId(null)} aria-expanded="true" aria-label={t('account.teams.hideDetails', { team: team.displayName })} className="flex h-11 w-9 shrink-0 items-center justify-center text-[rgb(var(--mg-faint))]"><ChevronDown className="h-4 w-4 rotate-180" aria-hidden="true" /></button>
            </div>
            {next ? (
              <div className={`grid min-h-[52px] grid-cols-[44px_minmax(0,1fr)] items-center gap-x-2.5 py-1.5 pl-3.5 pr-3 ${next.delayMinutes > 0 ? 'mg-line-late' : ''}`}>
                <span className={`mg-line-time ${next.delayMinutes > 0 ? 'text-[rgb(var(--mg-late-time))]' : ''}`}>{heatTime(next)}</span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[10px] font-semibold uppercase leading-none tracking-[0.08em] text-[rgb(var(--mg-muted))]">{next.status === 'live' ? t('account.teams.onNow') : t('account.teams.nextUp')}</span>
                  <span className="truncate text-sm font-semibold">{heatSummary(next, team.sectionName)}</span>
                </span>
              </div>
            ) : (
              <p className="px-3.5 py-3 text-sm text-[rgb(var(--mg-muted))]">{rows.length ? t('account.teams.allFinished') : t('account.teams.noneScheduled')}</p>
            )}
            {(team.relationship === 'trainer' || team.relationship === 'manager') && <CodeRow team={team} onTeamUpdated={reload} />}
            <div className="flex min-h-[52px] items-center gap-2.5 border-t border-[rgb(var(--mg-rule-soft))] px-3.5 py-1.5">
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-semibold">{t('account.teams.alerts')}</span>
                <span className="text-xs text-[rgb(var(--mg-muted))]">{alertsNote(notify.enabled, notify.permission)}</span>
              </span>
              <Switch label={t('account.teams.alerts')} on={notify.enabled} disabled={notify.permission === 'denied'} onChange={notify.setEnabled} />
            </div>
            {notify.problem && <div className="px-3.5 pb-2.5"><Notice>{notify.problem}</Notice></div>}
            {team.bibDescription && <p className="border-t border-[rgb(var(--mg-rule-soft))] px-3.5 py-2.5 text-xs text-[rgb(var(--mg-muted))]">{t('account.teams.bibs', { value: team.bibDescription })}</p>}
            {team.relationship === 'manager' && <ManageTeamBlock team={team} onSaved={reload} />}
            {(team.relationship === 'trainer' || team.relationship === 'manager') && <SupportersBlock team={team} />}
            {rows.length > 0 && <AllHeats rows={rows} />}
          </article>
        );
      })}

      {loaded && teams.length === 0 && (
        <div className="mg-card p-4 text-sm text-[rgb(var(--mg-body))]">
          {t('account.teams.none')}
        </div>
      )}
      {!loaded && <p role="status" className="mg-meta px-1">{t('account.teams.loading')}</p>}

      {joining && <JoinTeamCard onJoined={reload} />}
      {!joining && (
        <button type="button" onClick={() => setJoining(true)} className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-dashed border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))] text-sm font-semibold text-[rgb(var(--mg-heading))]">
          <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />{t('account.teams.joinWithCode')}
        </button>
      )}

      {hasRole('Manager') && <TrainerRequestsSection />}

      <div className="mt-2 flex flex-col gap-2.5 lg:col-span-2">
        <h2 className="mg-display text-lg font-bold text-[rgb(var(--mg-heading))]">{t('account.teams.following')}</h2>
        <FollowingTeamsSection />
      </div>
    </div>
  );
}

function alertsNote(enabled: boolean, permission: NotificationPermissionState): string {
  if (permission === 'denied') return tr('account.teams.alertsDenied');
  if (permission === 'unsupported') return tr('account.teams.alertsUnsupported');
  return enabled ? tr('account.teams.alertsOn') : tr('account.teams.alertsOff');
}

function Switch({ label, on, disabled, onChange }: { label: string; on: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-[rgb(var(--mg-button))]' : 'bg-[rgb(var(--mg-control))]'}`}>
      <span aria-hidden="true" className={`absolute left-[3px] top-[3px] h-[22px] w-[22px] rounded-full bg-white transition-transform duration-150 ${on ? 'translate-x-5' : 'translate-x-0'}`} />
      <span className="absolute -inset-y-2 inset-x-0" aria-hidden="true" />
    </button>
  );
}

function AllHeats({ rows }: { rows: TeamHeatRow[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-[rgb(var(--mg-rule-soft))]">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-11 w-full items-center gap-2 px-3.5 text-left text-[13px] font-semibold text-[rgb(var(--mg-heading))]">
        {t('account.teams.allHeats')} <span className="font-medium text-[rgb(var(--mg-muted))]">· {rows.length}</span>
        <ChevronDown className={`ml-auto h-4 w-4 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <ul className="space-y-1 px-3.5 pb-3 text-xs">
          {rows.map((r) => (
            <li key={r.heatId} className="flex items-center gap-2">
              <span className="w-12 font-bold tabular-nums">{heatTime(r)}</span>
              <span className="min-w-0 flex-1 truncate">{displaySectionName(r.sessionName)} · {r.label}{r.arenaName && ` · ${r.arenaName}`}</span>
              {r.lane != null && <span className="shrink-0 text-[rgb(var(--mg-muted))]">{t('account.teams.lane', { n: r.lane })}</span>}
              {r.status === 'live' && <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--mg-red))]">{t('account.teams.inArena')}</span>}
              {r.status === 'over' && <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--mg-ok))]">{t('account.teams.over')}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
