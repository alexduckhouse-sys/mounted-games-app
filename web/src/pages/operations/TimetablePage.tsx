import { Fragment, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Minus, Pencil, Plus } from 'lucide-react';
import { api } from '../../api';
import { confirmDialog } from '../../components/ConfirmDialog';
import { apiErrorMessage } from '../../lib/apiError';
import { competitionUpdateBody } from '../../lib/competitionPayload';
import { HATBAND_COLOURS, MAX_LANES, lanesFor } from '../../lib/creatorDraft';
import { defaultEventStart, heatSizes, planTimetable } from '../../lib/formatPlan';
import { SessionKind, type Session } from '../../types';
import { useCompetition } from '../competition/context';
import { RefineChoiceRow, RefineHeader, RefineList, RefinePage, RefineSwitchRow, type ChoiceOption } from '../refine/Refine';
import type { DrawPreview } from './types';
import './operations.css';

const DEFAULT_MINUTES = 10;
const BREAK_NAMES: ChoiceOption<string>[] = [{ value: 'Lunch', label: 'Lunch' }, { value: 'Tea', label: 'Tea' }];
const COLOUR: Record<string, string> = {
  Red: '#C8202F', White: '#FFFFFF', Blue: '#2B5FA8', Yellow: '#E8B400', Green: '#2E8B57', Black: '#222222', Orange: '#E87B00', Pink: '#E86AA6',
};
const dotColour = (name: string) => COLOUR[name.trim()] ?? '#8A93A0';

const isRace = (s: Session) => !s.isBreak && (s.kind ?? SessionKind.Race) === SessionKind.Race;
const hhmm = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const lengthText = (minutes: number) => (minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`);
const dayText = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const addMinutes = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000);

interface Item {
  session: Session;
  isBreak: boolean;
  arena: string;
  start: Date | null;
  minutes: number;
  heats: number;
  perHeat: number;
  /** Heats exist or it has started: its times are the real ones and it can't be nudged. */
  locked: boolean;
}

/** Timetable and draw: the day's running order for each arena, the hatbands, and the lane draw. Every change saves as it is made. */
export function TimetablePage() {
  const { competition, reload } = useCompetition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [move, setMove] = useState(15);
  const [follow, setFollow] = useState(true);
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const items = useMemo<Item[]>(() => {
    const teamsIn = (sectionId: number | null) => competition.teams.filter((t) => t.competitionSectionId === sectionId && !t.isWithdrawn).length;
    const plan = planTimetable({
      eventStart: defaultEventStart(new Date(competition.startDate)),
      sessions: competition.sessions.filter(isRace).map((s) => {
        const section = competition.sections.find((x) => x.id === s.competitionSectionId);
        return { id: s.id, name: s.name, arena: s.arenaName?.trim() ?? '', orderIndex: s.orderIndex, raceCount: 1, minutesPerHeat: s.minutesPerHeat ?? DEFAULT_MINUTES,
          lanes: s.lanesPerHeat ?? lanesFor(section?.format ?? 2), teamCount: teamsIn(s.competitionSectionId), raceFinals: !!section?.usesRaceFinals };
      }),
      fixed: competition.sessions.filter((s) => !isRace(s) && s.scheduledStart).map((s) => {
        const start = new Date(s.scheduledStart!);
        return { start, end: addMinutes(start, s.durationMinutes ?? 0), arena: s.arenaName?.trim() ?? '' };
      }),
    });
    const planOf = new Map(plan.map((row) => [row.id, row]));
    return competition.sessions.map((s): Item => {
      const brk = !isRace(s);
      const section = competition.sections.find((x) => x.id === s.competitionSectionId);
      const perHeat = s.minutesPerHeat ?? DEFAULT_MINUTES;
      const row = planOf.get(s.id);
      const heats = brk ? 0 : s.heats.length > 0 ? s.heats.length : heatSizes(teamsIn(s.competitionSectionId), s.lanesPerHeat ?? lanesFor(section?.format ?? 2)).length;
      const minutes = brk ? s.durationMinutes ?? 0 : section?.usesRaceFinals ? 3 * perHeat : s.heats.length > 0 || !s.durationMinutes ? heats * perHeat || row?.minutes || 0 : s.durationMinutes;
      const start = s.scheduledStart ? new Date(s.scheduledStart) : row && row.minutes > 0 ? row.start : null;
      return { session: s, isBreak: brk, arena: s.arenaName?.trim() ?? '', start, minutes, heats, perHeat, locked: !brk && (s.heats.length > 0 || s.status !== 0) };
    });
  }, [competition]);

  const groups = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of items) {
      const key = item.arena || 'All arenas';
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()].map(([name, list]) => ({
      name,
      list: list.sort((a, b) => (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity) || a.session.orderIndex - b.session.orderIndex),
    }));
  }, [items]);

  async function run(failure: string, work: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try { await work(); reload(); return true; }
    catch (caught) { setError(apiErrorMessage(caught, failure)); return false; }
    finally { setBusy(false); }
  }
  const put = (id: number, body: Record<string, unknown>) => api.put(`/competitions/${competition.id}/sessions/${id}`, body);
  const endOf = (item: Item) => (item.start ? addMinutes(item.start, item.minutes) : null);

  /** With follow-on, everything after an item in its arena moves with it when its length changes. */
  async function shiftLater(list: Item[], after: Item, minutes: number) {
    if (!follow || minutes === 0 || !after.start) return;
    for (const item of list) {
      if (item === after || !item.start || item.locked || item.start.getTime() < after.start.getTime()) continue;
      await put(item.session.id, { scheduledStart: addMinutes(item.start, minutes).toISOString() });
    }
  }

  const shiftAll = (by: number) => run('Couldn’t move the timetable.', () => api.post(`/competitions/${competition.id}/sessions/shift-times`, { deltaMinutes: by }));

  const setHeatMinutes = (list: Item[], item: Item, value: number) => run('Couldn’t save the time per heat.', async () => {
    const length = item.heats * value;
    const body: Record<string, unknown> = { minutesPerHeat: value };
    if (!item.locked && item.heats > 0) body.durationMinutes = length;
    await put(item.session.id, body);
    if (!item.locked) await shiftLater(list, item, length - item.minutes);
  });

  const setBreakLength = (list: Item[], item: Item, value: number) => run('Couldn’t save the length.', async () => {
    await put(item.session.id, { durationMinutes: value });
    await shiftLater(list, item, value - item.minutes);
  });

  const setBreakName = (item: Item, name: string) => run('Couldn’t save the name.', () => put(item.session.id, { name }));

  const setStart = (item: Item, time: string) => run('Couldn’t save the start time.', async () => {
    if (!item.start || !/^\d{2}:\d{2}$/.test(time)) return;
    const [h, m] = time.split(':').map(Number);
    await put(item.session.id, { scheduledStart: new Date(item.start.getFullYear(), item.start.getMonth(), item.start.getDate(), h, m).toISOString() });
  });

  const followOn = (list: Item[], item: Item) => run('Couldn’t save the start time.', async () => {
    const before = list[list.indexOf(item) - 1];
    const end = before && endOf(before);
    if (end) await put(item.session.id, { scheduledStart: end.toISOString() });
  });

  /** Swaps an item with its neighbour: the earlier takes the other's start, and the other follows it. */
  const swap = (list: Item[], item: Item, direction: -1 | 1) => run('Couldn’t move that.', async () => {
    const index = list.indexOf(item);
    const other = list[index + direction];
    const [first, second] = direction === -1 ? [other, item] : [item, other];
    if (!first.start || !second.start) return;
    const firstEnd = endOf(first)!;
    const gap = Math.max(0, Math.round((second.start.getTime() - firstEnd.getTime()) / 60_000));
    await put(second.session.id, { scheduledStart: first.start.toISOString() });
    await put(first.session.id, { scheduledStart: addMinutes(first.start, second.minutes + gap).toISOString() });
  });

  async function removeBreak(list: Item[], item: Item) {
    if (!(await confirmDialog({ title: 'Remove this break?', message: `Remove ${item.session.name}?`, confirmLabel: 'Remove', destructive: true }))) return;
    await run('Couldn’t remove the break.', async () => {
      await api.delete(`/competitions/${competition.id}/sessions/${item.session.id}`);
      await shiftLater(list, item, -item.minutes);
    });
    setEditing(null);
  }

  const addBreak = (list: Item[], arena: string, after: Item | null, name: string, minutes: number) => run('Couldn’t add the break.', async () => {
    const start = (after && endOf(after)) ?? list.find((i) => i.start)?.start ?? defaultEventStart(new Date(competition.startDate));
    if (after) await shiftLater(list.filter((i) => i !== after), { ...after, start }, minutes);
    await api.post(`/competitions/${competition.id}/sessions`, {
      competitionSectionId: null, name, arenaName: arena === 'All arenas' ? null : arena, scheduledStart: start.toISOString(),
      orderIndex: competition.sessions.reduce((m, s) => Math.max(m, s.orderIndex), 0) + 1, notes: null, isBreak: true, durationMinutes: minutes, kind: SessionKind.Break, location: null,
    });
    setAdding(null);
  });

  // ----- hatbands -----
  const bands = competition.laneHatbands ?? [];
  const saveBands = (next: string[]) => run('Couldn’t save the hatbands.', () => api.put(`/competitions/${competition.id}`, competitionUpdateBody(competition, { laneHatbands: next })));
  const [addingBand, setAddingBand] = useState(false);
  const [bandName, setBandName] = useState('');
  const moveBand = (i: number, by: -1 | 1) => { const next = [...bands]; [next[i], next[i + by]] = [next[i + by], next[i]]; void saveBands(next); };

  // ----- draw -----
  const [sectionId, setSectionId] = useState<string>(String(competition.sections[0]?.id ?? ''));
  const [preview, setPreview] = useState<DrawPreview | null>(null);
  const draw = () => run('Couldn’t draw this section.', async () => {
    const { data } = await api.post<DrawPreview>(`/competitions/${competition.id}/sections/${sectionId}/draw/preview`, { seed: Math.floor(Math.random() * 90_000) + 10_000 });
    setPreview(data);
  });
  const applyDraw = () => preview && run('Couldn’t apply the draw.', async () => {
    await api.post(`/competitions/${competition.id}/sections/${preview.sectionId}/draw/apply`, { seed: preview.seed, fingerprint: preview.fingerprint });
    setNotice('Draw applied. The timetable has these lanes.');
    setPreview(null);
  });
  const heatOne = preview?.sessions[0]?.heats[0];

  return (
    <RefinePage>
      <RefineHeader back={`/competitions/${competition.id}/operations`} backLabel="Back to preparations" context={competition.name} title="Timetable and draw" />
      <div className="ops-cards ops-tt" aria-busy={busy}>
        {error && <p role="alert" className="mg-notice ops-alert">{error}</p>}
        {notice && <p role="status" className="rf-note">{notice}</p>}

        <RefineList as="div">
          <div className="rf-row ops-mv">
            <span className="rf-grow rf-t1">Move everything</span>
            <span className="ops-step-ctl" role="group" aria-label="Minutes to move everything">
              <button type="button" className="ops-ibtn" aria-label="Fewer minutes" disabled={move <= 5} onClick={() => setMove(Math.max(5, move - 5))}><Minus className="h-4 w-4" aria-hidden="true" /></button>
              <output>{move}</output>
              <button type="button" className="ops-ibtn" aria-label="More minutes" disabled={move >= 120} onClick={() => setMove(Math.min(120, move + 5))}><Plus className="h-4 w-4" aria-hidden="true" /></button>
            </span>
            <span className="rf-t2">min</span>
            <span className="ops-mv-btns">
              <button type="button" className="rf-btn" disabled={busy} onClick={() => void shiftAll(-move)}>Earlier</button>
              <button type="button" className="rf-btn" disabled={busy} onClick={() => void shiftAll(move)}>Later</button>
            </span>
          </div>
          <RefineSwitchRow label="Each one follows on from the one before" on={follow} onChange={setFollow} />
        </RefineList>

        {groups.map((group) => {
          const first = group.list.find((i) => i.start);
          const last = [...group.list].reverse().find((i) => i.start);
          return (
            <Fragment key={group.name}>
              <h2 className="rf-sec ops-tt-head"><span>{group.name} {first?.start ? `· ${dayText(first.start)}` : ''}</span>{first?.start && last && <span>{hhmm(first.start)} – {hhmm(endOf(last) ?? last.start!)}</span>}</h2>
              <RefineList as="div" label={group.name}>
                {group.list.map((item, i) => {
                  const prev = group.list[i - 1];
                  const prevEnd = prev && endOf(prev);
                  const gap = prevEnd && item.start ? Math.round((item.start.getTime() - prevEnd.getTime()) / 60_000) : 0;
                  const open = editing === item.session.id;
                  const end = endOf(item);
                  const meta = item.isBreak ? `Break · ${lengthText(item.minutes)}` : `${item.heats} ${item.heats === 1 ? 'heat' : 'heats'} · ${item.perHeat} min a heat · ${lengthText(item.minutes)}`;
                  const canMove = (dir: -1 | 1) => { const o = group.list[i + dir]; return !!o && !item.locked && !o.locked && !!item.start && !!o.start; };
                  return (
                    <Fragment key={item.session.id}>
                      {gap > 0 && <div className="ops-gap-line">{gap} min gap</div>}
                      {!open ? (
                        <button type="button" className="rf-row ops-tt-row" aria-expanded={false} onClick={() => setEditing(item.session.id)}>
                          <span className="ops-time">{item.start ? hhmm(item.start) : '–'}</span>
                          <span className="rf-grow"><span className="rf-t1">{item.session.name}</span><span className="rf-t2">{meta}</span></span>
                          {gap < 0 && <span className="ops-warn">Overlaps the one before</span>}
                          {end && <span className="rf-t2">to {hhmm(end)}</span>}
                          <Pencil className="rf-chev h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : (
                        <div className="ops-tt-edit">
                          <div className="rf-row">
                            <span className="ops-time">{item.start ? hhmm(item.start) : '–'}</span>
                            <span className="rf-grow"><span className="rf-t1">{item.session.name}</span><span className="rf-t2">{meta}{end ? ` · to ${hhmm(end)}` : ''}</span></span>
                            <button type="button" className="ops-ibtn" aria-label={`Move ${item.session.name} up`} disabled={busy || !canMove(-1)} onClick={() => void swap(group.list, item, -1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                            <button type="button" className="ops-ibtn" aria-label={`Move ${item.session.name} down`} disabled={busy || !canMove(1)} onClick={() => void swap(group.list, item, 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
                            <button type="button" className="rf-btn" aria-expanded onClick={() => setEditing(null)}>Done</button>
                          </div>
                          {item.isBreak && (
                            <RefineChoiceRow label="Name" value={item.session.name} options={BREAK_NAMES} allowOther disabled={busy} onChange={(name) => void setBreakName(item, name)} />
                          )}
                          {!follow && item.start && (
                            <div className="rf-row">
                              <label className="rf-grow rf-t1" htmlFor={`start-${item.session.id}`}>Start</label>
                              <input id={`start-${item.session.id}`} type="time" className="ops-time-input" defaultValue={hhmm(item.start)} disabled={busy || item.locked}
                                onBlur={(event) => { if (event.target.value && event.target.value !== hhmm(item.start!)) void setStart(item, event.target.value); }} />
                              <button type="button" className="rf-btn" disabled={busy || item.locked || !prev} onClick={() => void followOn(group.list, item)}>Follow on from the one before</button>
                            </div>
                          )}
                          <div className="ops-pair">
                            {item.isBreak
                              ? <MinuteStepper label="Length" value={item.minutes} min={5} max={240} disabled={busy} onChange={(n) => void setBreakLength(group.list, item, n)} />
                              : <MinuteStepper label="Time per heat" value={item.perHeat} min={5} max={120} disabled={busy} onChange={(n) => void setHeatMinutes(group.list, item, n)} />}
                          </div>
                          {item.isBreak && <div className="rf-row ops-end"><button type="button" className="ops-danger-link" disabled={busy} onClick={() => void removeBreak(group.list, item)}>Remove</button></div>}
                        </div>
                      )}
                    </Fragment>
                  );
                })}
                {adding === group.name
                  ? <BreakForm key={group.name} list={group.list} busy={busy} onCancel={() => setAdding(null)} onAdd={(after, name, minutes) => void addBreak(group.list, group.name, after, name, minutes)} />
                  : <button type="button" className="ops-addbar ops-addrow" disabled={busy} onClick={() => setAdding(group.name)}><Plus className="h-4 w-4" aria-hidden="true" />Add a break</button>}
              </RefineList>
            </Fragment>
          );
        })}

        <h2 className="rf-sec ops-tt-head"><span>Hatbands</span><span>{bands.length}</span></h2>
        <RefineList as="div" label="Hatbands">
          {bands.map((band, i) => (
            <div key={`${band}-${i}`} className="rf-row">
              <span className="ops-lane-badge">{i + 1}</span>
              <span className="ops-dot-colour" aria-hidden="true" style={{ background: dotColour(band) }} />
              <span className="rf-grow rf-t1">{band}</span>
              <button type="button" className="ops-ibtn" aria-label={`Move ${band} up`} disabled={busy || i === 0} onClick={() => moveBand(i, -1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
              <button type="button" className="ops-ibtn" aria-label={`Move ${band} down`} disabled={busy || i === bands.length - 1} onClick={() => moveBand(i, 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
              <button type="button" className="ops-danger-link" aria-label={`Remove ${band}`} disabled={busy} onClick={() => void saveBands(bands.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          {bands.length === 0 && (
            <div className="rf-row"><span className="rf-grow rf-t2">No hatbands</span>
              <button type="button" className="rf-btn" disabled={busy} onClick={() => void saveBands(HATBAND_COLOURS.slice(0, 6))}>Use the usual colours</button></div>
          )}
          {bands.length < MAX_LANES && !addingBand && <button type="button" className="ops-addbar ops-addrow" disabled={busy} onClick={() => setAddingBand(true)}><Plus className="h-4 w-4" aria-hidden="true" />Add a hatband</button>}
          {addingBand && (
            <form className="ops-dup" onSubmit={(event) => { event.preventDefault(); const name = bandName.trim(); if (name) { void saveBands([...bands, name]); setBandName(''); setAddingBand(false); } }}>
              <div className="ops-chips" role="group" aria-label="Quick colours">
                {HATBAND_COLOURS.map((name) => (
                  <button key={name} type="button" className="rf-btn" onClick={() => setBandName(name)}><span className="ops-dot-colour" aria-hidden="true" style={{ background: dotColour(name) }} />{name}</button>
                ))}
              </div>
              <label className="rf-fld">Name<input value={bandName} placeholder="Any name" maxLength={30} onChange={(event) => setBandName(event.target.value)} /></label>
              <div className="rf-actions"><button type="submit" className="rf-btn rf-btn-primary" disabled={!bandName.trim()}>Add hatband</button><button type="button" className="rf-btn" onClick={() => { setAddingBand(false); setBandName(''); }}>Cancel</button></div>
            </form>
          )}
        </RefineList>
        {bands.length > 0 && <div className="ops-end-left"><button type="button" className="ops-danger-link" disabled={busy} onClick={() => void saveBands([])}>Remove all hatbands</button></div>}

        <h2 className="rf-sec ops-tt-head"><span>Draw</span></h2>
        <RefineList as="div">
          <RefineChoiceRow label="Section" value={sectionId} options={competition.sections.map((s) => ({ value: String(s.id), label: s.displayName }))} disabled={busy || competition.sections.length === 0}
            onChange={(value) => { setSectionId(value); setPreview(null); }} />
          <div className="rf-row">
            <span className="rf-grow rf-t1">Lanes for heat 1</span>
            <button type="button" className="rf-btn rf-btn-primary" disabled={busy || !sectionId} onClick={() => void draw()}>Draw</button>
          </div>
        </RefineList>
        {heatOne && (
          <>
            <h2 className="rf-sec ops-tt-head"><span>Heat 1</span></h2>
            <RefineList as="div" label="Heat 1">
              {heatOne.teams.slice().sort((a, b) => a.laneIndex - b.laneIndex).map((team) => (
                <div key={team.teamId} className="rf-row">
                  <span className="ops-dot-colour" aria-hidden="true" style={{ background: dotColour(bands[team.laneIndex - 1] ?? '') }} />
                  <span className="rf-t1 ops-lane-label">Lane {team.laneIndex}</span>
                  <span className="rf-grow rf-t1">{team.teamName}</span>
                </div>
              ))}
            </RefineList>
            <div className="rf-actions ops-draw-actions">
              <button type="button" className="rf-btn rf-btn-primary" disabled={busy || !preview.fairness.everyTeamAppearsOncePerSession} onClick={() => void applyDraw()}>Apply draw</button>
              <button type="button" className="rf-btn" disabled={busy} onClick={() => void draw()}>Shuffle again</button>
            </div>
          </>
        )}
      </div>
    </RefinePage>
  );
}

/** A small round − and + with the number on its own between them. */
function MinuteStepper({ label, value, min, max, disabled, onChange }: { label: string; value: number; min: number; max: number; disabled?: boolean; onChange: (n: number) => void }) {
  return (
    <div className="ops-step">
      <span className="ops-step-label">{label} (min)</span>
      <span className="ops-step-ctl" role="group" aria-label={label}>
        <button type="button" className="ops-ibtn" aria-label={`Shorter ${label.toLowerCase()}`} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 5))}><Minus className="h-4 w-4" aria-hidden="true" /></button>
        <output>{value}</output>
        <button type="button" className="ops-ibtn" aria-label={`Longer ${label.toLowerCase()}`} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 5))}><Plus className="h-4 w-4" aria-hidden="true" /></button>
      </span>
    </div>
  );
}

function BreakForm({ list, busy, onAdd, onCancel }: { list: Item[]; busy: boolean; onAdd: (after: Item | null, name: string, minutes: number) => void; onCancel: () => void }) {
  const [after, setAfter] = useState(list.length ? String(list[list.length - 1].session.id) : '');
  const [name, setName] = useState('Lunch');
  const [minutes, setMinutes] = useState(30);
  return (
    <div className="ops-dup">
      <RefineChoiceRow label="After" value={after} options={list.map((item) => ({ value: String(item.session.id), label: item.session.name }))} onChange={setAfter} />
      <RefineChoiceRow label="Name" value={name} options={BREAK_NAMES} allowOther onChange={setName} />
      <MinuteStepper label="How long" value={minutes} min={5} max={240} onChange={setMinutes} />
      <div className="rf-actions">
        <button type="button" className="rf-btn rf-btn-primary" disabled={busy} onClick={() => onAdd(list.find((i) => String(i.session.id) === after) ?? null, name, minutes)}>Add break</button>
        <button type="button" className="rf-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
