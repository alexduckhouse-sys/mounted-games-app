import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "5 riders + reserve", from the team's dec form when there is one. */
function ridersText(form: DeclarationForm | undefined): string | null {
  if (!form) return null;
  const riders = form.riders.filter((r) => !r.isReserve).length;
  const reserve = form.riders.some((r) => r.isReserve);
  return `${plural(riders, 'rider')}${reserve ? ' + reserve' : ''}`;
}

function FormChip({ team, form }: { team: Team; form: DeclarationForm | undefined }) {
  if (team.relationship !== 'trainer' && team.relationship !== 'manager') return null;
  return form
    ? <span className="mg-tag mg-tag-ok shrink-0">Dec form in</span>
    : <span className="mg-tag shrink-0 !bg-[rgb(var(--mg-live-row))] !text-[rgb(var(--mg-elim))]">Dec form due</span>;
}

function RelationshipTag({ team }: { team: Team }) {
  if (team.relationship === 'manager') return <span className="mg-tag shrink-0">Your club</span>;
  if (team.relationship === 'supporter') return <span className="mg-tag shrink-0">Supporter</span>;
  return null;
}

export function MyTeamsPage() {
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

  const club = user?.clubName || teams.find((t) => t.relationship === 'manager' || t.relationship === 'trainer')?.clubName;
  usePageHeader({
    title: 'My teams',
    subtitle: [club, loaded ? plural(teams.length, 'team') : null].filter(Boolean).join(' · ') || undefined,
    plain: true,
    backTo: '/dashboard',
    backLabel: 'Back to Me',
  });

  return (
    <div className="mg-cards-grid mg-cards-grid-2 mx-auto flex w-full max-w-xl flex-col gap-2.5 pb-2 pt-3 lg:max-w-none">
      {teams.map((team) => {
        const rows = rowsByTeam.get(team.id) ?? [];
        const next = nextHeatRow(rows);
        const form = forms.find((f) => f.teamId === team.id);
        const section = displaySectionName(team.sectionName);
        if (team.id !== expandedId) {
          return (
            <button key={team.id} type="button" aria-expanded="false" onClick={() => setOpenId(team.id)}
              className="grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto_14px] items-center gap-x-2.5 rounded-[10px] border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))] py-2 pl-3.5 pr-2.5 text-left">
              <span className="flex min-w-0 flex-col gap-[3px]">
                <strong className="mg-display truncate text-xl font-bold leading-none text-[rgb(var(--mg-heading))]">{team.displayName}</strong>
                <span className="truncate text-xs text-[rgb(var(--mg-muted))]">{[section, next ? `next ${heatTime(next)}, ${next.label}${next.arenaName ? ` · ${next.arenaName}` : ''}` : 'no heats yet'].join(' · ')}</span>
              </span>
              <span className="flex items-center gap-1.5"><RelationshipTag team={team} /><FormChip team={team} form={form} /></span>
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
              <RelationshipTag team={team} />
              <FormChip team={team} form={form} />
              <button type="button" onClick={() => setOpenId(null)} aria-expanded="true" aria-label={`Hide details for ${team.displayName}`} className="flex h-11 w-9 shrink-0 items-center justify-center text-[rgb(var(--mg-faint))]"><ChevronDown className="h-4 w-4 rotate-180" aria-hidden="true" /></button>
            </div>
            {next ? (
              <div className={`grid min-h-[52px] grid-cols-[44px_minmax(0,1fr)] items-center gap-x-2.5 py-1.5 pl-3.5 pr-3 ${next.delayMinutes > 0 ? 'mg-line-late' : ''}`}>
                <span className={`mg-line-time ${next.delayMinutes > 0 ? 'text-[rgb(var(--mg-late-time))]' : ''}`}>{heatTime(next)}</span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[10px] font-semibold uppercase leading-none tracking-[0.08em] text-[rgb(var(--mg-muted))]">{next.status === 'live' ? 'On now' : 'Next up'}</span>
                  <span className="truncate text-sm font-semibold">{heatSummary(next, team.sectionName)}</span>
                </span>
              </div>
            ) : (
              <p className="px-3.5 py-3 text-sm text-[rgb(var(--mg-muted))]">{rows.length ? 'All heats are finished.' : 'No heats scheduled yet.'}</p>
            )}
            {(team.relationship === 'trainer' || team.relationship === 'manager') && <CodeRow team={team} onTeamUpdated={reload} />}
            <div className="flex min-h-[52px] items-center gap-2.5 border-t border-[rgb(var(--mg-rule-soft))] px-3.5 py-1.5">
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-semibold">Heat alerts</span>
                <span className="text-xs text-[rgb(var(--mg-muted))]">{alertsNote(notify.enabled, notify.permission)}</span>
              </span>
              <Switch label="Heat alerts" on={notify.enabled} disabled={notify.permission === 'denied' || notify.permission === 'unsupported'} onChange={notify.setEnabled} />
            </div>
            {team.bibDescription && <p className="border-t border-[rgb(var(--mg-rule-soft))] px-3.5 py-2.5 text-xs text-[rgb(var(--mg-muted))]">Bibs: {team.bibDescription}</p>}
            {team.relationship === 'manager' && <ManageTeamBlock team={team} onSaved={reload} />}
            {(team.relationship === 'trainer' || team.relationship === 'manager') && <SupportersBlock team={team} />}
            {rows.length > 0 && <AllHeats rows={rows} />}
          </article>
        );
      })}

      {loaded && teams.length === 0 && (
        <div className="mg-card p-4 text-sm text-[rgb(var(--mg-body))]">
          No teams assigned to you yet. An organiser, or your club's team manager, can make you the trainer of a team.
        </div>
      )}
      {!loaded && <p role="status" className="mg-meta px-1">Loading your teams…</p>}

      {joining && <JoinTeamCard onJoined={reload} />}
      {!joining && (
        <button type="button" onClick={() => setJoining(true)} className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-dashed border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))] text-sm font-semibold text-[rgb(var(--mg-heading))]">
          <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />Join a team with a code
        </button>
      )}

      {hasRole('Manager') && <TrainerRequestsSection />}
    </div>
  );
}

function alertsNote(enabled: boolean, permission: NotificationPermissionState): string {
  if (permission === 'denied') return 'Browser permission denied';
  if (permission === 'unsupported') return 'Not supported in this browser';
  return enabled ? '60 minutes before each heat' : 'Off. Turn on for a nudge 60 minutes before each heat';
}

function Switch({ label, on, disabled, onChange }: { label: string; on: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-[rgb(var(--mg-button))]' : 'bg-[rgb(var(--mg-control))]'}`}>
      <span aria-hidden="true" className={`absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white transition-all ${on ? 'left-[23px]' : 'left-[3px]'}`} />
      <span className="absolute -inset-y-2 inset-x-0" aria-hidden="true" />
    </button>
  );
}

function AllHeats({ rows }: { rows: TeamHeatRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-[rgb(var(--mg-rule-soft))]">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-11 w-full items-center gap-2 px-3.5 text-left text-[13px] font-semibold text-[rgb(var(--mg-heading))]">
        All heats <span className="font-medium text-[rgb(var(--mg-muted))]">· {rows.length}</span>
        <ChevronDown className={`ml-auto h-4 w-4 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <ul className="space-y-1 px-3.5 pb-3 text-xs">
          {rows.map((r) => (
            <li key={r.heatId} className="flex items-center gap-2">
              <span className="w-12 font-bold tabular-nums">{heatTime(r)}</span>
              <span className="min-w-0 flex-1 truncate">{displaySectionName(r.sessionName)} · {r.label}{r.arenaName && ` · ${r.arenaName}`}</span>
              {r.lane != null && <span className="shrink-0 text-[rgb(var(--mg-muted))]">Lane {r.lane}</span>}
              {r.status === 'live' && <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--mg-red))]">In arena</span>}
              {r.status === 'over' && <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--mg-ok))]">Over</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
