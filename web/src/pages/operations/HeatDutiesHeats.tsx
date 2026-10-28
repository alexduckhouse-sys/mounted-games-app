import { useMemo, useState } from 'react';
import { Check, ChevronRight, Sparkles } from 'lucide-react';
import { api } from '../../api';
import { Notice } from '../../components/Notice';
import { Sheet } from '../../components/Sheet';
import { useT } from '../../i18n/LanguageContext';
import { apiErrorMessage } from '../../lib/apiError';
import {
  addableSpecs, addHeatSlot, autoFillRoles, copyRoles, customSpec, dutiesToFill, emptySlots, gapGroups, heatTitle, matchesSetup, mergeProposal,
  pickerOptions, removeHeatSlot, setSlotTeam, teamDutyCounts, MAX_ROLE_NAME,
  type DutySession, type DutySlot, type RoleSetup, type SlotSpec, type SlotState,
} from '../../lib/heatDuties';
import type { AutoFillHeatDutiesInput, AutoFillHeatDutiesResult, Heat, Team } from '../../types';
import { Chevron, RefineList } from '../refine/Refine';
import { roleLabel, roleWithLane } from './heatDutiesText';

interface Props {
  competitionId: number;
  sessions: readonly DutySession[];
  setup: RoleSetup;
  state: SlotState;
  teams: readonly Team[];
  onChange: (next: SlotState) => void;
}

/** Step 2: each session's heats, each heat's duties, and the team for each one. */
export function HeatDutiesHeats({ competitionId, sessions, setup, state, teams, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const [pick, setPick] = useState<{ sessionId: number; heatId: number; uid: string } | null>(null);
  const [add, setAdd] = useState<{ sessionId: number; heatId: number } | null>(null);
  const [auto, setAuto] = useState<DutySession | null>(null);
  const [notice, setNotice] = useState<string[] | null>(null);
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const counts = useMemo(() => teamDutyCounts(state.slots), [state.slots]);

  const toggle = (heatId: number) => setOpen((current) => { const next = new Set(current); if (!next.delete(heatId)) next.add(heatId); return next; });
  const teamName = (id: number | null) => (id == null ? null : teamsById.get(id)?.displayName ?? '?');

  const picking = pick && sessions.find((item) => item.session.id === pick.sessionId);
  const pickedHeat = picking?.heats.find((heat) => heat.id === pick?.heatId);

  return (
    <div className="hd-step">
      {notice && <Notice tone="problem" onDismiss={() => setNotice(null)}>{notice.map((line, index) => <span key={index} className="hd-line">{line}</span>)}</Notice>}
      {sessions.map(({ session, heats }) => {
        const toFill = heats.reduce((sum, heat) => sum + emptySlots(state.slots[heat.id] ?? []).length, 0);
        const arena = session.arenaName?.trim();
        const title = arena && !session.name.includes(arena) ? `${session.name} · ${arena}` : session.name;
        return (
          <section key={session.id} aria-label={title} className="hd-session">
            <div className="hd-session-head">
              <div className="rf-grow">
                <h2 className="hd-session-title">{title}</h2>
                <p className="hd-session-sub">{t('duties.session.heatCount', { count: heats.length })} · {toFill > 0 ? t('duties.session.toFill', { count: toFill }) : t('duties.session.allFilled')}</p>
              </div>
              <button type="button" className="hd-auto" aria-label={t('duties.auto.aria', { session: title })} onClick={() => setAuto({ session, heats })}><Sparkles className="h-4 w-4" aria-hidden="true" />{t('duties.auto')}</button>
            </div>
            <div className="hd-heats">
              {heats.map((heat, index) => {
                const slots = state.slots[heat.id] ?? [];
                const gaps = gapGroups(slots);
                const empty = emptySlots(slots).length;
                const isOpen = open.has(heat.id);
                const riding = heat.entries.map((entry) => entry.teamName);
                const previous = index > 0 ? heats[index - 1] : null;
                const panel = `hd-panel-${heat.id}`;
                return (
                  <div key={heat.id} className={`hd-heat${empty > 0 ? ' has-gaps' : ''}`}>
                    <button type="button" className="hd-heat-head" aria-expanded={isOpen} aria-controls={panel} onClick={() => toggle(heat.id)}>
                      <span className="hd-heat-name">{heatTitle(heat, index)}</span>
                      <span className="hd-heat-state">
                        {slots.length === 0 ? <span className="hd-muted">{t('duties.heat.noDuties')}</span>
                          : empty === 0 ? <><span className="hd-ok">{t('duties.heat.allFilled', { count: slots.length })}</span><Check className="hd-tick h-4 w-4" aria-hidden="true" /></>
                          : <><span className="hd-gap">{gaps.map((gap) => (gap.counted ? t('duties.gap.counted', { count: gap.count, role: roleLabel(gap, t).toLowerCase() }) : roleLabel(gap, t))).join(', ')}</span><b className="hd-count" aria-label={t('duties.gap.aria', { count: empty })}>{empty}</b></>}
                      </span>
                      <Chevron down={isOpen} />
                    </button>
                    {isOpen && (
                      <div id={panel} className="hd-panel">
                        <p className="hd-riding">{riding.length === 0 ? t('duties.heat.noneRiding') : riding.length > 4 ? t('duties.heat.ridingMore', { names: riding.slice(0, 4).join(', '), more: riding.length - 4 }) : t('duties.heat.riding', { names: riding.join(', ') })}</p>
                        <RefineList as="div">
                          {slots.map((slot) => {
                            const name = teamName(slot.teamId);
                            return (
                              <button key={slot.uid} type="button" className="rf-row hd-duty" onClick={() => setPick({ sessionId: session.id, heatId: heat.id, uid: slot.uid })}>
                                <span className="rf-grow"><span className="rf-t1">{roleLabel(slot, t)}</span>{slot.lane != null && <span className="rf-t2">{t('duties.lane', { number: slot.lane })}</span>}</span>
                                {name ? <span className="hd-team">{name}</span> : <span className="hd-choose"><i aria-hidden="true" />{t('duties.row.choose')}</span>}
                                <ChevronRight className="hd-chev h-4 w-4" aria-hidden="true" />
                              </button>
                            );
                          })}
                        </RefineList>
                        <div className="hd-heat-acts">
                          {previous && !matchesSameRoles(state.slots[previous.id] ?? [], slots) && <button type="button" className="rf-btn rf-btn-text" onClick={() => onChange(copyRoles(state, previous.id, heat.id))}>{t('duties.heat.sameAs', { heat: heatTitle(previous, index - 1) })}</button>}
                          <button type="button" className="rf-btn rf-btn-text" onClick={() => setAdd({ sessionId: session.id, heatId: heat.id })}>{t('duties.heat.addDuty')}</button>
                          {!matchesSetup(slots, setup) && <span className="hd-muted hd-own">{t('duties.heat.own')}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {pick && picking && pickedHeat && (
        <TeamPicker
          teams={teams} heats={picking.heats} heat={pickedHeat} slots={state.slots[pickedHeat.id] ?? []} slotUid={pick.uid} counts={counts}
          onClose={() => setPick(null)}
          onPick={(teamId) => onChange(setSlotTeam(state, pickedHeat.id, pick.uid, teamId))}
          onRemove={() => onChange(removeHeatSlot(state, pickedHeat.id, pick.uid))}
        />
      )}
      {add && (() => {
        const owner = sessions.find((item) => item.session.id === add.sessionId);
        const heat = owner?.heats.find((item) => item.id === add.heatId);
        if (!owner || !heat) return null;
        return <AddDutySheet heat={heat} index={owner.heats.indexOf(heat)} slots={state.slots[heat.id] ?? []} setup={setup} onClose={() => setAdd(null)} onAdd={(spec) => onChange(addHeatSlot(state, heat.id, spec))} />;
      })()}
      {auto && (
        <AutoSheet
          competitionId={competitionId} target={auto} others={sessions.filter((item) => item.session.id !== auto.session.id)} setup={setup} state={state}
          onClose={() => setAuto(null)}
          onDone={(next, lines) => { onChange(next); setNotice(lines.length > 0 ? lines : null); setAuto(null); }}
        />
      )}
    </div>
  );
}

/** Do the two heats hold the same list of roles? Then "Same roles as…" has nothing to do. */
function matchesSameRoles(a: readonly DutySlot[], b: readonly DutySlot[]): boolean {
  const key = (slot: DutySlot) => `${slot.role.toLowerCase()}|${slot.lane ?? ''}`;
  const x = a.map(key).sort();
  const y = b.map(key).sort();
  return x.length === y.length && x.every((item, index) => item === y[index]);
}

function TeamPicker({ teams, heats, heat, slots, slotUid, counts, onClose, onPick, onRemove }: {
  teams: readonly Team[]; heats: readonly Heat[]; heat: Heat; slots: readonly DutySlot[]; slotUid: string; counts: ReadonlyMap<number, number>;
  onClose: () => void; onPick: (teamId: number | null) => void; onRemove: () => void;
}) {
  const t = useT();
  const slot = slots.find((item) => item.uid === slotUid);
  const options = useMemo(() => pickerOptions({ teams, heats, heatId: heat.id, slots, slotUid, counts }), [teams, heats, heat.id, slots, slotUid, counts]);
  if (!slot) return null;
  const heatName = heatTitle(heat, heats.indexOf(heat));
  return (
    <Sheet title={t('duties.pick.title', { role: roleWithLane(slot, t), heat: heatName })} description={t('duties.swipe')} onClose={onClose} className="hd-sheet">
      {({ close }) => {
        const finish = (apply: () => void) => close(() => { apply(); onClose(); });
        return (
          <>
            {options.length === 0 && <p className="rf-note">{t('duties.pick.noTeams')}</p>}
            <ul className="hd-opts" role="radiogroup" aria-label={t('duties.pick.team')}>
              {options.map(({ team, duties, selected, blocked, nearHeat }) => (
                <li key={team.id}>
                  <button type="button" role="radio" aria-checked={selected} disabled={blocked != null} className="hd-opt" onClick={() => finish(() => onPick(team.id))}>
                    <i className="hd-radio" aria-hidden="true" />
                    <span className="hd-opt-name">{team.displayName}</span>
                    {blocked === 'riding' && <span className="hd-tag">{t('duties.pick.riding')}</span>}
                    {blocked === 'onDuty' && <span className="hd-tag">{t('duties.pick.onDuty')}</span>}
                    {!blocked && nearHeat && <span className="hd-tag is-warn">{t('duties.pick.near', { heat: nearHeat })}</span>}
                    {!blocked && <span className="hd-opt-count">{t('duties.pick.count', { count: duties })}</span>}
                  </button>
                </li>
              ))}
              <li>
                <button type="button" role="radio" aria-checked={slot.teamId == null} className="hd-opt" onClick={() => finish(() => onPick(null))}>
                  <i className="hd-radio" aria-hidden="true" /><span className="hd-opt-name">{t('duties.pick.leave')}</span>
                </button>
              </li>
            </ul>
            <button type="button" className="rf-btn rf-btn-text hd-remove" onClick={() => finish(onRemove)}>{t('duties.pick.remove', { heat: heatName })}</button>
          </>
        );
      }}
    </Sheet>
  );
}

function AddDutySheet({ heat, index, slots, setup, onClose, onAdd }: { heat: Heat; index: number; slots: readonly DutySlot[]; setup: RoleSetup; onClose: () => void; onAdd: (spec: SlotSpec) => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const specs = useMemo(() => addableSpecs(slots, setup), [slots, setup]);
  return (
    <Sheet title={t('duties.add.title', { heat: heatTitle(heat, index) })} description={t('duties.swipe')} onClose={onClose} className="hd-sheet">
      {({ close }) => {
        const finish = (spec: SlotSpec) => close(() => { onAdd(spec); onClose(); });
        return (
          <>
            <ul className="hd-opts">
              {specs.map((spec) => (
                <li key={`${spec.role}|${spec.lane ?? ''}`}><button type="button" className="hd-opt" onClick={() => finish(spec)}><span className="hd-opt-name">{roleWithLane(spec, t)}</span></button></li>
              ))}
            </ul>
            <form className="hd-addform" onSubmit={(event) => { event.preventDefault(); if (name.trim()) finish(customSpec(name)); }}>
              <label className="rf-fld rf-grow">{t('duties.add.other')}<input value={name} maxLength={MAX_ROLE_NAME} placeholder={t('duties.add.name')} onChange={(event) => setName(event.target.value)} /></label>
              <button type="submit" className="rf-btn rf-btn-primary" disabled={!name.trim()}>{t('duties.addRole.add')}</button>
            </form>
          </>
        );
      }}
    </Sheet>
  );
}

function AutoSheet({ competitionId, target, others, setup, state, onClose, onDone }: {
  competitionId: number; target: DutySession; others: readonly DutySession[]; setup: RoleSetup; state: SlotState;
  onClose: () => void; onDone: (next: SlotState, lines: string[]) => void;
}) {
  const t = useT();
  const [from, setFrom] = useState<'this' | 'other'>('this');
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set());
  const [keep, setKeep] = useState(true);
  const [avoid, setAvoid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { session, heats } = target;
  const heatIds = heats.map((heat) => heat.id);
  const roles = autoFillRoles(setup);
  const count = dutiesToFill(state.slots, heatIds, keep);
  const needSessions = from === 'other' && chosen.size === 0;
  const arena = session.arenaName?.trim();
  const title = arena && !session.name.includes(arena) ? `${session.name} · ${arena}` : session.name;

  async function fill() {
    setBusy(true);
    setError(null);
    const body: AutoFillHeatDutiesInput = {
      roles, heatIds, keepExisting: keep, avoidNeighbouringHeats: avoid,
      teamSessionIds: from === 'this' ? [session.id] : [...chosen],
    };
    try {
      const { data } = await api.post<AutoFillHeatDutiesResult>(`/competitions/${competitionId}/sessions/${session.id}/heat-duties/auto-fill`, body);
      if (!data || !Array.isArray(data.duties)) throw new Error('Unexpected response');
      const merged = mergeProposal(state, data.duties, keep);
      const lines: string[] = [];
      if (merged.stillEmpty > 0) lines.push(t('duties.auto.unfilled', { count: merged.stillEmpty }));
      lines.push(...(data.warnings ?? []));
      onDone({ slots: merged.slots, overridden: merged.overridden }, lines);
    } catch (caught) {
      setError(apiErrorMessage(caught, t('duties.auto.failed')));
      setBusy(false);
    }
  }

  const toggleSession = (id: number) => setChosen((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  const radio = (value: 'this' | 'other', label: string, hint: string) => (
    <button type="button" role="radio" aria-checked={from === value} className="hd-opt hd-radio-row" onClick={() => setFrom(value)}>
      <i className="hd-radio" aria-hidden="true" />
      <span className="rf-grow"><span className="rf-t1">{label}</span><span className="rf-t2">{hint}</span></span>
    </button>
  );
  const switchRow = (label: string, hint: string | null, on: boolean, onChange: (next: boolean) => void) => (
    <div className="hd-sw-row">
      <span className="rf-grow"><span className="rf-t1">{label}</span>{hint && <span className="rf-t2">{hint}</span>}</span>
      {onChange !== noop && <button type="button" role="switch" aria-checked={on} aria-label={label} className="rf-sw" onClick={() => onChange(!on)}><span aria-hidden="true" /></button>}
    </div>
  );

  return (
    <Sheet title={t('duties.auto.title', { session: title })} description={t('duties.swipe')} onClose={onClose} dismissible={!busy} className="hd-sheet">
      {() => (
        <>
          <h3 className="hd-sheet-h">{t('duties.auto.from')}</h3>
          <div role="radiogroup" aria-label={t('duties.auto.from')} className="hd-radios">
            {radio('this', t('duties.auto.thisSession'), t('duties.auto.thisHint', { session: title }))}
            {radio('other', t('duties.auto.other'), t('duties.auto.otherHint'))}
          </div>
          {from === 'other' && (others.length === 0
            ? <p className="rf-note">{t('duties.auto.noOthers')}</p>
            : <div className="hd-chips" role="group" aria-label={t('duties.auto.other')}>
              {others.map((item) => <button key={item.session.id} type="button" className="hd-chip" aria-pressed={chosen.has(item.session.id)} onClick={() => toggleSession(item.session.id)}>{item.session.name}</button>)}
            </div>)}
          <h3 className="hd-sheet-h">{t('duties.auto.rules')}</h3>
          <div className="hd-sw-list">
            {switchRow(t('duties.auto.keep'), t('duties.auto.keepHint'), keep, setKeep)}
            {switchRow(t('duties.auto.avoid'), null, avoid, setAvoid)}
            {switchRow(t('duties.auto.even'), t('duties.auto.evenHint'), true, noop)}
          </div>
          {needSessions && <p className="rf-note" role="status">{t('duties.auto.needSession')}</p>}
          {error && <Notice>{error}</Notice>}
          <div className="kit-acts">
            <button type="button" className="kit-pill kit-pill-fill" disabled={busy || count === 0 || needSessions || roles.length === 0} onClick={() => void fill()}>{busy ? t('duties.auto.filling') : t('duties.auto.fill', { count })}</button>
          </div>
        </>
      )}
    </Sheet>
  );
}

const noop = () => {};
