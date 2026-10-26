import { useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2 } from 'lucide-react';
import { api } from '../../api';
import type { CompetitionSection, TieBreakRule } from '../../types';
import { cutLabel, move, TIE_BREAK_RULES, tieStatus, TieSettlement, type BoundaryTie, type FinalsBoundary } from '../../lib/tieBreak';
import { SelectField } from '../../components/SelectField';
import { Notice } from '../../components/Notice';

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
      setError(message(caught, 'Couldn’t change how ties are settled. Check your signal and try again.'));
    } finally { setBusy(false); }
  }

  const ties = boundary?.tied ? boundary.boundaries ?? [] : [];
  if (!section && ties.length === 0) return null;

  return <div className="space-y-2">
    {section && <label className="block">
      <span className="text-xs font-semibold text-[rgb(var(--mg-body))]">Teams level on points</span>
      <SelectField className="input mt-1 text-sm" value={rule} disabled={busy}
        onChange={(event) => changeRule(Number(event.target.value) as TieBreakRule)}>
        {TIE_BREAK_RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </SelectField>
      <span className="text-[11px] text-[rgb(var(--mg-muted))]">{TIE_BREAK_RULES.find((r) => r.value === rule)?.hint}</span>
    </label>}
    {ties.map((tie) => <TieCard key={`${tie.cutoff}:${tie.settledBy}:${tie.teams.map((t) => t.id).join(',')}`} tie={tie} competitionId={competitionId} canOrder={section !== null}
      runoffRaceName={boundary?.runoffRaceName} onChanged={onChanged} />)}
    {!section && ties.length > 0 && <p className="text-[11px] text-[rgb(var(--mg-muted))]">Pick an age group to settle these ties.</p>}
    {error && <Notice>{error}</Notice>}
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
    } catch (caught) { setError(message(caught, 'Couldn’t save the order. Check your signal and try again.')); }
    finally { setBusy(false); }
  }

  async function clear() {
    setBusy(true); setError(null);
    try {
      await api.delete(`/competitions/${competitionId}/finals/tie-order`, { params: { teamIds: tie.teams.map((t) => t.id) }, paramsSerializer: { indexes: null } });
      onChanged();
    } catch (caught) { setError(message(caught, 'Couldn’t clear the order. Check your signal and try again.')); }
    finally { setBusy(false); }
  }

  const tone = open
    ? 'border-[rgb(var(--mg-late-ink)/0.35)] bg-[rgb(var(--mg-late-bg))] text-[rgb(var(--mg-late-ink))]'
    : 'border-[rgb(var(--mg-ok)/0.35)] bg-[rgb(var(--mg-ok)/0.12)] text-[rgb(var(--mg-ok))]';
  return <section aria-label={cutLabel(tie.cutoff)} className={`space-y-1.5 rounded-lg border p-2.5 text-xs ${tone}`}>
    <div className="flex items-center gap-1.5 font-semibold">
      {open ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
      {cutLabel(tie.cutoff)} · {tie.totalAtCutoff} pts
    </div>
    <p>{tieStatus(tie, runoffRaceName)}</p>
    <ol className="space-y-1">
      {(showOrder ? order : tie.teams).map((team, index, list) => <li key={team.id} className="flex items-center gap-1.5">
        <span className="w-5 text-right tabular-nums">{showOrder ? tie.teams[0].position + index : team.position}.</span>
        <span className="flex-1">{team.name} <span className="opacity-70">· {team.wins} {team.wins === 1 ? 'win' : 'wins'}</span></span>
        {showOrder && <>
          <button type="button" className="mg-icon-btn !h-7 !w-7" disabled={index === 0 || busy} aria-label={`Move ${team.name} up`}
            onClick={() => setOrder((current) => move(current, index, -1))}><ArrowUp className="h-3.5 w-3.5" /></button>
          <button type="button" className="mg-icon-btn !h-7 !w-7" disabled={index === list.length - 1 || busy} aria-label={`Move ${team.name} down`}
            onClick={() => setOrder((current) => move(current, index, 1))}><ArrowDown className="h-3.5 w-3.5" /></button>
        </>}
      </li>)}
    </ol>
    {canOrder && <div className="flex gap-2">
      {showOrder && <button type="button" className="mg-btn mg-btn-primary !min-h-8 !px-2.5 !py-1 text-xs" disabled={busy} onClick={save}>Save this order</button>}
      {!showOrder && tie.settledBy === TieSettlement.Rule && <button type="button" className="mg-small-btn !min-h-8 !px-2.5 !py-1 text-xs" onClick={() => setEditing(true)}>Change the order</button>}
      {tie.settledBy === TieSettlement.Organiser && <button type="button" className="mg-small-btn !min-h-8 !px-2.5 !py-1 text-xs" disabled={busy} onClick={clear}>Clear my order</button>}
    </div>}
    {error && <Notice>{error}</Notice>}
  </section>;
}
