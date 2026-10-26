import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { usePageHeader } from '../components/CompactPageBarContext';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { useMyTeams } from '../hooks/useMyTeams';
import { isLocked, lockHeading, type LockInfo } from '../lib/decFormDeadline';
import { displaySectionName } from '../lib/section';
import type { DeclarationForm, Team } from '../types';
import '../components/sitePages.css';

type View = 'current' | 'all';

interface Row { key: string; to: string; team: string; sub: string; form: DeclarationForm | null }
interface Group { id: number; name: string; start: number; rows: Row[] }

const sentOn = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Dec forms in one place: a row for each of my teams in a competition, with a Sent or Not sent chip and the lock time in
 * the heading. "All my forms" adds every competition I have teams in, and the locked, read-only forms of other clubs.
 */
export function DeclarationsIndexPage() {
  usePageHeader({ title: 'Dec forms', plain: true, backTo: '/me', backLabel: 'Back to Me' });
  const { current } = useCurrentCompetition();
  const { user } = useAuth();
  const mine = useMyTeams();
  const now = useMemo(() => new Date().getTime(), []);
  const [view, setView] = useState<View>(current ? 'current' : 'all');
  const [locks, setLocks] = useState<Record<number, LockInfo | null>>({});
  const [open, setOpen] = useState<Set<number>>(new Set());

  const { groups, others } = useMemo(() => {
    const teams: Team[] = mine.teams.filter((t) => t.relationship !== 'supporter');
    const teamIds = new Set(teams.map((t) => t.id));
    const byComp = new Map<number, Group>();
    const group = (id: number, name?: string): Group => {
      let g = byComp.get(id);
      if (!g) {
        const detail = mine.comps.get(id);
        g = { id, name: detail?.name ?? name ?? `Competition ${id}`, start: detail?.startDate ? new Date(detail.startDate).getTime() : 0, rows: [] };
        byComp.set(id, g);
      }
      return g;
    };
    for (const team of teams) {
      const form = mine.forms.find((f) => f.teamId === team.id) ?? null;
      group(team.competitionId).rows.push({
        key: `team-${team.id}`, to: `/competitions/${team.competitionId}/declarations?team=${team.id}`, team: team.displayName, form,
        sub: form ? `Sent ${sentOn(form.submittedAt)} · ${plural(form.riders.length, 'rider')}` : displaySectionName(team.sectionName),
      });
    }
    // Forms I sent for a team that isn't on my list (an organiser or manager sending for someone).
    const others: DeclarationForm[] = [];
    for (const form of mine.forms) {
      if (teamIds.has(form.teamId)) continue;
      if (user && form.submittedByUserId === user.id) {
        group(form.competitionId, form.competitionName).rows.push({
          key: `form-${form.id}`, to: `/competitions/${form.competitionId}/declarations?team=${form.teamId}`, team: form.teamName, form,
          sub: `Sent ${sentOn(form.submittedAt)} · ${plural(form.riders.length, 'rider')}`,
        });
      } else others.push(form);
    }
    const sorted = [...byComp.values()].sort((a, b) => {
      const aNext = a.start >= now - 24 * 3600_000, bNext = b.start >= now - 24 * 3600_000;
      if (aNext !== bNext) return aNext ? -1 : 1;
      return aNext ? a.start - b.start : b.start - a.start;
    });
    return { groups: sorted, others };
  }, [mine.teams, mine.forms, mine.comps, user, now]);

  const shown = view === 'current' && current ? groups.filter((g) => g.id === current.id) : groups;
  const shownKey = shown.map((g) => g.id).join(',');

  useEffect(() => {
    let cancelled = false;
    const ids = shownKey ? shownKey.split(',').map(Number) : [];
    for (const id of ids) {
      api.get<LockInfo>(`/declaration-forms/competition/${id}/lock-time`)
        .then((r) => { if (!cancelled) setLocks((cur) => ({ ...cur, [id]: r?.data ?? null })); })
        .catch(() => { if (!cancelled) setLocks((cur) => ({ ...cur, [id]: null })); });
    }
    return () => { cancelled = true; };
  }, [shownKey]);

  function toggle(id: number) {
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  const tabs: { id: View; label: string; disabled?: boolean }[] = [
    { id: 'current', label: current?.name ?? 'Current competition', disabled: !current },
    { id: 'all', label: 'All my forms' },
  ];
  const empty = shown.length === 0 && (view === 'all' ? others.length === 0 : true);

  return (
    <div className="skin mx-auto w-full max-w-[560px] pb-4 pt-3">
      <div className="sp-seg" role="tablist" aria-label="Which dec forms">
        {tabs.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={view === tab.id} disabled={tab.disabled} className="disabled:opacity-40" onClick={() => setView(tab.id)}>{tab.label}</button>
        ))}
      </div>

      {!mine.loaded && <p role="status" className="sp-note">Loading…</p>}

      {mine.loaded && shown.map((g) => {
        const info = locks[g.id];
        const heading = lockHeading(info, now);
        const locked = isLocked(info, now);
        return (
          <section key={g.id} aria-label={g.name}>
            <h2 className="sp-sec">{g.name}{heading && <small>{heading}</small>}</h2>
            <ul className="sp-card m-0 list-none p-0">
              {g.rows.map((row) => (
                <li key={row.key}>
                  <Link to={row.to} className="sp-row">
                    <span className="sp-grow"><span className="sp-t1">{row.team}</span><span className="sp-t2">{row.sub}</span></span>
                    <span className="sp-chip" data-tone={locked ? 'grey' : row.form ? 'good' : 'warn'}>{locked ? 'Locked' : row.form ? 'Sent' : 'Not sent'}</span>
                    <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {mine.loaded && view === 'all' && others.length > 0 && (
        <section aria-label="Other clubs">
          <h2 className="sp-sec">Other clubs<small>Locked, read only</small></h2>
          <ul className="sp-card m-0 list-none p-0">
            {others.map((form) => {
              const isOpen = open.has(form.id);
              return (
                <li key={form.id}>
                  <button type="button" className="sp-row" aria-expanded={isOpen} onClick={() => toggle(form.id)}>
                    <span className="sp-grow"><span className="sp-t1">{form.teamName}</span><span className="sp-t2">{[form.competitionName, plural(form.riders.length, 'rider')].join(' · ')}</span></span>
                    {isOpen ? <ChevronDown aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} /> : <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />}
                  </button>
                  {isOpen && (
                    <ol className="m-0 list-none bg-[rgb(var(--mg-subtle))] px-4 py-2 text-[15px]" aria-label={`Riders for ${form.teamName}`}>
                      {form.riders.map((r) => (
                        <li key={r.id} className="flex items-baseline justify-between gap-2 py-1">
                          <span className="font-semibold">{r.fullName}{r.isReserve && <span className="sp-t2"> · reserve</span>}</span>
                          {r.horseName && <span className="sp-t2">{r.horseName}</span>}
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {mine.loaded && empty && (
        <p className="sp-note">
          {view === 'current' && current ? `No dec forms for ${current.name} yet.` : 'No dec forms yet. Open a competition to start one.'}
          {current && <> <Link to={`/competitions/${current.id}/declarations`} className="font-semibold text-[rgb(var(--mg-heading))] underline">Open {current.name}</Link></>}
        </p>
      )}
    </div>
  );
}
