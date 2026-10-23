import { useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2 } from 'lucide-react';
import { api } from '../../api';
import type { CompetitionSection, TieBreakRule } from '../../types';
import { cutLabel, move, TIE_BREAK_RULES, tieStatus, TieSettlement, type BoundaryTie, type FinalsBoundary } from '../../lib/tieBreak';

function message(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: string | { message?: string } } })?.response?.data;
  return typeof data === 'string' ? data : data?.message ?? fallback;
}

/**
 * The finals ties for one age group: how the age group settles them, and, where a tie is still open (or the
 * organiser wants to overrule the rule), the tied teams in an order the organiser can change and save.
 */
export function FinalsTiePanel({ competitionId, section, rule, onRuleChange, boundary, onChanged }: {
  competitionId: number;
  /** Null for "all age groups": ties across age groups can be seen but not ordered. */
  section: CompetitionSection | null;
  /** The section's rule as the parent last saved it. */
  rule: TieBreakRule;
  onRuleChange: (sectionId: number, rule: TieBreakRule) => void;
  boundary: FinalsBoundary | null;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function changeRule(next: TieBreakRule) {
    if (!section) return;
    setBusy(true); setError(null);
    try {
      // The section update clears the run-off race and finalist count when they're left out, so send them as they are.
      await api.put(`/competitions/${competitionId}/sections/${section.id}`, {
        runoffRaceName: section.runoffRaceName ?? null,
        finalistCount: section.finalistCount ?? null,
        tieBreakRule: next,
      });
      onRuleChange(section.id, next);
      onChanged();
    } catch (caught) {
      setError(message(caught, 'Couldn’t change how ties are settled.'));
    } finally { setBusy(false); }
  }

  const ties = boundary?.tied ? boundary.boundaries ?? [] : [];
  if (!section && ties.length === 0) return null;

  return <div className="space-y-2">
    {section && <label className="block">
      <span className="text-xs font-semibold">Teams level on points</span>
      <select className="input mt-1 text-sm" value={rule} disabled={busy}
        onChange={(event) => changeRule(Number(event.target.value) as TieBreakRule)}>
        {TIE_BREAK_RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
      <span className="text-[11px] text-slate-500 dark:text-slate-300">{TIE_BREAK_RULES.find((r) => r.value === rule)?.hint}</span>
    </label>}
    {ties.map((tie) => <TieCard key={`${tie.cutoff}:${tie.settledBy}:${tie.teams.map((t) => t.id).join(',')}`} tie={tie} competitionId={competitionId} canOrder={section !== null}
      runoffRaceName={boundary?.runoffRaceName} onChanged={onChanged} />)}
    {!section && ties.length > 0 && <p className="text-[11px] text-slate-500 dark:text-slate-300">Pick an age group to settle these ties.</p>}
    {error && <div role="alert" className="text-xs text-rose-700 dark:text-rose-300">{error}</div>}
  </div>;
}

function TieCard({ tie, competitionId, canOrder, runoffRaceName, onChanged }: {
  tie: BoundaryTie; competitionId: number; canOrder: boolean; runoffRaceName?: string | null; onChanged: () => void;
}) {
  const [order, setOrder] = useState(tie.teams);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = !tie.settled;
  const showOrder = canOrder && (open || editing);

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.put(`/competitions/${competitionId}/finals/tie-order`, { teamIds: order.map((t) => t.id) });
      onChanged();
    } catch (caught) { setError(message(caught, 'Couldn’t save the order.')); }
    finally { setBusy(false); }
  }

  async function clear() {
    setBusy(true); setError(null);
    try {
      await api.delete(`/competitions/${competitionId}/finals/tie-order`, { params: { teamIds: tie.teams.map((t) => t.id) }, paramsSerializer: { indexes: null } });
      onChanged();
    } catch (caught) { setError(message(caught, 'Couldn’t clear the order.')); }
    finally { setBusy(false); }
  }

  const tone = open
    ? 'text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800'
    : 'text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800';
  return <section aria-label={cutLabel(tie.cutoff)} className={`text-xs border rounded-md p-2 space-y-1.5 ${tone}`}>
    <div className="font-semibold flex items-center gap-1.5">
      {open ? <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> : <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />}
      {cutLabel(tie.cutoff)} · {tie.totalAtCutoff} pts
    </div>
    <p>{tieStatus(tie, runoffRaceName)}</p>
    <ol className="space-y-1">
      {(showOrder ? order : tie.teams).map((team, index, list) => <li key={team.id} className="flex items-center gap-1.5">
        <span className="w-5 text-right tabular-nums">{showOrder ? tie.teams[0].position + index : team.position}.</span>
        <span className="flex-1">{team.name} <span className="opacity-70">· {team.wins} {team.wins === 1 ? 'win' : 'wins'}</span></span>
        {showOrder && <>
          <button type="button" className="btn-ghost !p-1" disabled={index === 0 || busy} aria-label={`Move ${team.name} up`}
            onClick={() => setOrder((current) => move(current, index, -1))}><ArrowUp className="w-3.5 h-3.5" /></button>
          <button type="button" className="btn-ghost !p-1" disabled={index === list.length - 1 || busy} aria-label={`Move ${team.name} down`}
            onClick={() => setOrder((current) => move(current, index, 1))}><ArrowDown className="w-3.5 h-3.5" /></button>
        </>}
      </li>)}
    </ol>
    {canOrder && <div className="flex gap-2">
      {showOrder && <button type="button" className="btn-primary !py-1 !px-2 text-xs" disabled={busy} onClick={save}>Save this order</button>}
      {!showOrder && tie.settledBy === TieSettlement.Rule && <button type="button" className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setEditing(true)}>Change the order</button>}
      {tie.settledBy === TieSettlement.Organiser && <button type="button" className="btn-ghost !py-1 !px-2 text-xs" disabled={busy} onClick={clear}>Clear my order</button>}
    </div>}
    {error && <div role="alert" className="text-rose-700 dark:text-rose-300">{error}</div>}
  </section>;
}
