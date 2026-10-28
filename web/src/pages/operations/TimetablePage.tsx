import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDown, ArrowUp, Minus, Pencil, Plus } from 'lucide-react';
import { useSavedToast } from '../../components/SavedTick';
import { TickerNumber } from '../../components/TickerNumber';
import { api } from '../../api';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { apiErrorMessage } from '../../lib/apiError';
import { competitionUpdateBody } from '../../lib/competitionPayload';
import { HATBAND_COLOURS, MAX_LANES, lanesFor } from '../../lib/creatorDraft';
import { dayKey } from '../../lib/timetableDay';
import { HATBAND_PALETTE, formatHatband, hatbandColour, hatbandHex, hatbandName, isHatbandHex, parseHatband } from '../../lib/hatbands';
import { defaultEventStart, heatSizes, planTimetable } from '../../lib/formatPlan';
import { dropIndex, makeRoom } from '../../lib/creatorRaces';
import { reorderStarts } from '../../lib/timetableReorder';
import { SessionKind, type Session } from '../../types';
import { useCompetition } from '../competition/context';
import { RefineChoiceRow, RefineHeader, RefineList, RefineMenu, RefinePage, RefineSwitchRow, type ChoiceOption } from '../refine/Refine';
import { DrawUndoBanner } from './DrawUndoBanner';
import { TimetableClashes } from './TimetableClashes';
import { ShareTextButtons } from './ShareTextButtons';
import { timetableShareText } from './shareText';
import type { DrawPreview } from './types';
import { isSessionLocked } from '../../lib/sessionLock';
import './operations.css';

const DEFAULT_MINUTES = 10;
const BREAK_NAMES: ChoiceOption<string>[] = [{ value: 'Lunch', label: 'Lunch' }, { value: 'Tea', label: 'Tea' }];
const NO_COLOUR = '#8A93A0';
const AT_START = 'start';

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
  /** An age group's finals: they keep their own start time, and the public timetable shows them only once it is set. */
  final: boolean;
}

/** Six dots: the grip for dragging a block to another place in the running order. */
function GripIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.7" /><circle cx="15" cy="6" r="1.7" /><circle cx="9" cy="12" r="1.7" /><circle cx="15" cy="12" r="1.7" /><circle cx="9" cy="18" r="1.7" /><circle cx="15" cy="18" r="1.7" />
    </svg>
  );
}

interface Drag { id: number; from: number; to: number; dy: number; height: number }

/** Keeps its own time when the order changes: started or scored, a final (its start is set by the organiser), or no start yet. */
const stays = (item: Item) => item.locked || item.final || !item.start;
/** Moves with the others when times are pushed: not started or scored, and not a final that has no start of its own yet. */
const shifts = (item: Item) => !!item.start && !item.locked && !(item.final && !item.session.scheduledStart);

/** Timetable and draw: the day's running order for each arena, the hatbands, and the lane draw. Every change saves as it is made. */
export function TimetablePage() {
  const { competition, reload } = useCompetition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [move, setMove] = useState(15);
  const [follow, setFollow] = useState(true);
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState<{ group: string; after?: string } | null>(null);
  const [arrange, setArrange] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [undoVersion, setUndoVersion] = useState(0);

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
      return { session: s, isBreak: brk, arena: s.arenaName?.trim() ?? '', start, minutes, heats, perHeat, locked: !brk && isSessionLocked(s), final: !brk && /\bfinals?\b/i.test(s.name) };
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

  // Changes save straight away, so a small toast confirms each one.
  const savedToast = useSavedToast();
  async function run(failure: string, work: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try { await work(); reload(); savedToast.show('Changes'); return true; }
    catch (caught) { setError(apiErrorMessage(caught, `${failure} Check your signal and try again.`)); return false; }
    finally { setBusy(false); }
  }
  const put = (id: number, body: Record<string, unknown>) => api.put(`/competitions/${competition.id}/sessions/${id}`, body);
  const endOf = (item: Item) => (item.start ? addMinutes(item.start, item.minutes) : null);

  /** Moves each of these by the minutes: the start of every one is saved at the same time. */
  const pushItems = (list: Item[], minutes: number) =>
    Promise.all(list.filter(shifts).map((item) => put(item.session.id, { scheduledStart: addMinutes(item.start!, minutes).toISOString() })));

  /** With follow-on, everything after an item in its arena on the same day moves with it when its length changes. */
  async function shiftLater(list: Item[], after: Item, minutes: number) {
    if (!follow || minutes === 0 || !after.start) return;
    await pushItems(list.filter((item) => item !== after && !!item.start && item.start.getTime() >= after.start!.getTime() && dayKey(item.start) === dayKey(after.start!)), minutes);
  }

  /** This block and every later one in its arena, whether or not each follows on. */
  const shiftFrom = (list: Item[], item: Item, minutes: number) => run('Couldn’t move those.', () => pushItems(list.slice(list.indexOf(item)), minutes));

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

  /** Moves a block to another place in its arena; the ones that can move share out the times, and the rest keep theirs. */
  const reorder = (list: Item[], from: number, to: number) => run('Couldn’t move that.', async () => {
    const changes = reorderStarts(list.map((item) => ({ id: item.session.id, start: item.start, minutes: item.minutes, fixed: stays(item) })), from, to);
    await Promise.all(changes.map((change) => put(change.id, { scheduledStart: change.start.toISOString() })));
  });

  function grab(event: ReactPointerEvent<HTMLButtonElement>, list: Item[], index: number) {
    if (event.button > 0) return;
    event.preventDefault();
    const row = event.currentTarget.closest('[data-tt-row]');
    const height = row ? row.getBoundingClientRect().height : 56;
    const y0 = event.clientY;
    const start: Drag = { id: list[index].session.id, from: index, to: index, dy: 0, height };
    dragRef.current = start;
    setDrag(start);
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - y0;
      const next = { ...start, dy, to: dropIndex(index, dy, height, list.length) };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const done = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (done && done.to !== done.from) void reorder(list, done.from, done.to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** The arrow keys on a focused grip move the block one place, over any that keep their own time. */
  function keys(event: ReactKeyboardEvent<HTMLButtonElement>, list: Item[], index: number) {
    const by = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!by) return;
    event.preventDefault();
    let to = index + by;
    while (list[to] && stays(list[to])) to += by;
    if (list[to]) void reorder(list, index, to);
  }

  async function removeBreak(list: Item[], item: Item) {
    if (!(await confirmDialog({ title: `Remove ${item.session.name}?`, message: 'Later sessions move up to fill the gap.', confirmLabel: 'Remove break', destructive: true }))) return;
    await run('Couldn’t remove the break.', async () => {
      await api.delete(`/competitions/${competition.id}/sessions/${item.session.id}`);
      await shiftLater(list, item, -item.minutes);
    });
    setEditing(null);
  }

  const addBreak = (list: Item[], arena: string, after: Item | null, name: string, minutes: number) => run('Couldn’t add the break.', async () => {
    const start = (after && endOf(after)) ?? list.find((i) => i.start)?.start ?? defaultEventStart(new Date(competition.startDate));
    if (after) await shiftLater(list.filter((i) => i !== after), { ...after, start }, minutes);
    else if (follow) await pushItems(list, minutes);
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
  const [changing, setChanging] = useState<number | null>(null);
  const moveBand = (i: number, by: -1 | 1) => { const next = [...bands]; [next[i], next[i + by]] = [next[i + by], next[i]]; setChanging(null); void saveBands(next); };
  // The colour panel sends its edits from a timer, so it reads the hatbands as they are when it fires.
  const bandsRef = useRef(bands);
  useEffect(() => { bandsRef.current = bands; });
  const saveBand = (i: number, value: string) => { const next = [...bandsRef.current]; next[i] = value; return saveBands(next); };

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
    setUndoVersion((n) => n + 1);
    setPreview(null);
  });
  const heatOne = preview?.sessions[0]?.heats[0];

  return (
    <RefinePage>
      {savedToast.node}
      <RefineHeader back={`/competitions/${competition.id}/operations`} backLabel="Back to preparations" context={competition.name} title="Timetable and draw" />
      <div className="ops-cards ops-tt" aria-busy={busy}>
        <DrawUndoBanner competitionId={competition.id} version={undoVersion} onRestored={reload} />
        <TimetableClashes competition={competition} />
        {error && <Notice>{error}</Notice>}
        {notice && <Notice tone="info" onDismiss={() => setNotice(null)}>{notice}</Notice>}

        <RefineList as="div">
          <div className="rf-row ops-mv">
            <span className="rf-grow rf-t1">Move everything</span>
            <span className="ops-step-ctl" role="group" aria-label="Minutes to move everything">
              <button type="button" className="ops-ibtn" aria-label="Fewer minutes" disabled={move <= 5} onClick={() => setMove(Math.max(5, move - 5))}><Minus className="h-4 w-4" aria-hidden="true" /></button>
              <output><TickerNumber value={move} format={String} /></output>
              <button type="button" className="ops-ibtn" aria-label="More minutes" disabled={move >= 120} onClick={() => setMove(Math.min(120, move + 5))}><Plus className="h-4 w-4" aria-hidden="true" /></button>
            </span>
            <span className="rf-t2">min</span>
            <span className="ops-mv-btns">
              <button type="button" className="rf-btn" disabled={busy} onClick={() => void shiftAll(-move)}>Earlier</button>
              <button type="button" className="rf-btn" disabled={busy} onClick={() => void shiftAll(move)}>Later</button>
            </span>
          </div>
          <RefineSwitchRow label="Each one follows on from the one before" on={follow} onChange={setFollow} />
          <RefineSwitchRow label="Drag to change the order" on={arrange} onChange={(on) => { setArrange(on); setEditing(null); }} />
          <div className="rf-row ops-wrap">
            <span className="rf-grow rf-t1">Send the timetable</span>
            <ShareTextButtons title="Share timetable" name="Timetable" text={timetableShareText(competition, `${window.location.origin}/competitions/${competition.id}`)} />
          </div>
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
                  const unsetFinal = item.final && !item.locked && !item.session.scheduledStart;
                  const meta = item.isBreak ? `Break · ${lengthText(item.minutes)}` : unsetFinal ? 'Set a start time so it shows on the public timetable' : `${item.heats} ${item.heats === 1 ? 'heat' : 'heats'} · ${item.perHeat} min a heat · ${lengthText(item.minutes)}`;
                  const lifted = drag?.id === item.session.id;
                  const room = drag && !lifted ? makeRoom(i, drag.from, drag.to, drag.height) : 0;
                  return (
                    <Fragment key={item.session.id}>
                      {gap > 0 && <div className="ops-gap-line">{gap} min gap</div>}
                      {arrange ? (
                        <div className="rf-row ops-tt-row" data-tt-row="" data-lifted={lifted}
                          style={lifted && drag ? { transform: `translateY(${drag.dy}px)` } : room ? { transform: `translateY(${room}px)` } : undefined}>
                          {stays(item)
                            ? <span className="ops-grip-gap" />
                            : (
                              <button type="button" className="ops-grip" disabled={busy} aria-label={`Move ${item.session.name}: drag, or use the up and down arrow keys`}
                                onPointerDown={(event) => grab(event, group.list, i)} onKeyDown={(event) => keys(event, group.list, i)}><GripIcon /></button>
                            )}
                          <span className="ops-time">{item.start ? hhmm(item.start) : '–'}</span>
                          <span className="rf-grow"><span className="rf-t1">{item.session.name}</span><span className="rf-t2">{meta}</span></span>
                          {gap < 0 && <span className="ops-warn">Overlaps the one before</span>}
                          {end && <span className="rf-t2">to {hhmm(end)}</span>}
                        </div>
                      ) : !open ? (
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
                            <button type="button" className="rf-btn" aria-expanded onClick={() => setEditing(null)}>Done</button>
                          </div>
                          {item.isBreak && (
                            <RefineChoiceRow label="Name" value={item.session.name} options={BREAK_NAMES} allowOther disabled={busy} onChange={(name) => void setBreakName(item, name)} />
                          )}
                          {(!follow || item.final) && item.start && (
                            <div className="rf-row">
                              <label className="rf-grow rf-t1" htmlFor={`start-${item.session.id}`}>Start</label>
                              <input id={`start-${item.session.id}`} type="time" className="ops-time-input" defaultValue={hhmm(item.start)} disabled={busy || item.locked}
                                onBlur={(event) => { if (event.target.value && (event.target.value !== hhmm(item.start!) || unsetFinal)) void setStart(item, event.target.value); }} />
                              <button type="button" className="rf-btn" disabled={busy || item.locked || !prev} onClick={() => void followOn(group.list, item)}>Follow on from the one before</button>
                            </div>
                          )}
                          {item.locked && !item.isBreak && <p className="rf-t2 ops-lock-note">This one has started or has scores, so its time can’t be changed here. “Move everything” still moves what is left.</p>}
                          {shifts(item) && <ShiftFrom name={item.session.name} busy={busy} onShift={(minutes) => void shiftFrom(group.list, item, minutes)} />}
                          <div className="ops-pair">
                            {item.isBreak
                              ? <MinuteStepper label="Length" value={item.minutes} min={5} max={240} disabled={busy} onChange={(n) => void setBreakLength(group.list, item, n)} />
                              : <MinuteStepper label="Time per heat" value={item.perHeat} min={5} max={120} disabled={busy} onChange={(n) => void setHeatMinutes(group.list, item, n)} />}
                          </div>
                          <div className="rf-row ops-end">
                            <button type="button" className="rf-btn" disabled={busy} onClick={() => { setEditing(null); setAdding({ group: group.name, after: String(item.session.id) }); }}>Add a break after this</button>
                            {item.isBreak && <button type="button" className="ops-danger-link" disabled={busy} onClick={() => void removeBreak(group.list, item)}>Remove</button>}
                          </div>
                        </div>
                      )}
                    </Fragment>
                  );
                })}
                {adding?.group === group.name
                  ? <BreakForm key={`${group.name}-${adding.after ?? ''}`} list={group.list} initialAfter={adding.after} busy={busy} onCancel={() => setAdding(null)} onAdd={(after, name, minutes) => void addBreak(group.list, group.name, after, name, minutes)} />
                  : <button type="button" className="ops-addbar ops-addrow" disabled={busy} onClick={() => setAdding({ group: group.name })}><Plus className="h-4 w-4" aria-hidden="true" />Add a break</button>}
              </RefineList>
            </Fragment>
          );
        })}

        <h2 className="rf-sec ops-tt-head"><span>Hatbands</span><span>{bands.length}</span></h2>
        <RefineList as="div" label="Hatbands">
          {bands.map((band, i) => (
            <Fragment key={i}>
              <div className="rf-row">
                <span className="ops-lane-badge">{i + 1}</span>
                <span className="ops-dot-colour" aria-hidden="true" style={{ background: hatbandColour(band) }} />
                <span className="rf-grow rf-t1">{hatbandName(band)}</span>
                <button type="button" className="ops-ibtn" aria-label={`Move ${hatbandName(band)} up`} disabled={busy || i === 0} onClick={() => moveBand(i, -1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                <button type="button" className="ops-ibtn" aria-label={`Move ${hatbandName(band)} down`} disabled={busy || i === bands.length - 1} onClick={() => moveBand(i, 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
                <RefineMenu label={`More for ${hatbandName(band)}`} disabled={busy} items={[
                  { label: 'Change colour', onSelect: () => { setAddingBand(false); setChanging(i); } },
                  { label: 'Remove', danger: true, onSelect: () => { setChanging(null); void saveBands(bands.filter((_, j) => j !== i)); } },
                ]} />
              </div>
              {changing === i && <BandEditor band={band} onSave={(value) => void saveBand(i, value)} onDone={() => setChanging(null)} />}
            </Fragment>
          ))}
          {bands.length === 0 && (
            <div className="rf-row"><span className="rf-grow rf-t2">No hatbands</span>
              <button type="button" className="rf-btn" disabled={busy} onClick={() => void saveBands(HATBAND_COLOURS.slice(0, 6))}>Use the usual colours</button></div>
          )}
          {bands.length < MAX_LANES && !addingBand && <button type="button" className="ops-addbar ops-addrow" disabled={busy} onClick={() => { setChanging(null); setAddingBand(true); }}><Plus className="h-4 w-4" aria-hidden="true" />Add a hatband</button>}
          {addingBand && <AddBand busy={busy} onAdd={(value) => { void saveBands([...bands, value]); setAddingBand(false); }} onCancel={() => setAddingBand(false)} />}
        </RefineList>
        {bands.length > 0 && <div className="ops-end-left"><button type="button" className="ops-danger-link" disabled={busy} onClick={() => { setChanging(null); void saveBands([]); }}>Remove all hatbands</button></div>}

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
                  <span className="ops-dot-colour" aria-hidden="true" style={{ background: bands[team.laneIndex - 1] ? hatbandColour(bands[team.laneIndex - 1]) : NO_COLOUR }} />
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
        <output><TickerNumber value={value} format={String} /></output>
        <button type="button" className="ops-ibtn" aria-label={`Longer ${label.toLowerCase()}`} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 5))}><Plus className="h-4 w-4" aria-hidden="true" /></button>
      </span>
    </div>
  );
}

/** Moves this block and everything after it in the arena later or earlier by the minutes chosen. */
function ShiftFrom({ name, busy, onShift }: { name: string; busy: boolean; onShift: (minutes: number) => void }) {
  const [minutes, setMinutes] = useState(15);
  return (
    <div className="rf-row ops-mv">
      <span className="rf-grow rf-t1">From here on</span>
      <span className="ops-step-ctl" role="group" aria-label={`Minutes to move ${name} and later ones`}>
        <button type="button" className="ops-ibtn" aria-label="Fewer minutes from here" disabled={minutes <= 5} onClick={() => setMinutes(Math.max(5, minutes - 5))}><Minus className="h-4 w-4" aria-hidden="true" /></button>
        <output><TickerNumber value={minutes} format={String} /></output>
        <button type="button" className="ops-ibtn" aria-label="More minutes from here" disabled={minutes >= 120} onClick={() => setMinutes(Math.min(120, minutes + 5))}><Plus className="h-4 w-4" aria-hidden="true" /></button>
      </span>
      <span className="rf-t2">min</span>
      <span className="ops-mv-btns">
        <button type="button" className="rf-btn" disabled={busy} aria-label={`Move ${name} and later ones earlier`} onClick={() => onShift(-minutes)}>Earlier</button>
        <button type="button" className="rf-btn" disabled={busy} aria-label={`Move ${name} and later ones later`} onClick={() => onShift(minutes)}>Later</button>
      </span>
    </div>
  );
}

function BreakForm({ list, initialAfter, busy, onAdd, onCancel }: { list: Item[]; initialAfter?: string; busy: boolean; onAdd: (after: Item | null, name: string, minutes: number) => void; onCancel: () => void }) {
  const [after, setAfter] = useState(initialAfter ?? (list.length ? String(list[list.length - 1].session.id) : AT_START));
  const [name, setName] = useState('Lunch');
  const [minutes, setMinutes] = useState(30);
  return (
    <div className="ops-dup">
      <RefineChoiceRow label="After" value={after} options={[{ value: AT_START, label: 'At the start' }, ...list.map((item) => ({ value: String(item.session.id), label: item.session.name }))]} onChange={setAfter} />
      <RefineChoiceRow label="Name" value={name} options={BREAK_NAMES} allowOther onChange={setName} />
      <MinuteStepper label="How long" value={minutes} min={5} max={240} onChange={setMinutes} />
      <div className="rf-actions">
        <button type="button" className="rf-btn rf-btn-primary" disabled={busy} onClick={() => onAdd(list.find((i) => String(i.session.id) === after) ?? null, name, minutes)}>Add break</button>
        <button type="button" className="rf-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** A colour picker with a box beside it for the #RRGGBB. Choosing from either updates the other; only a complete colour is passed on. */
function ColourField({ hex, onChange }: { hex: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(hex);
  function typed(value: string) {
    setText(value);
    const full = /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : value;
    if (isHatbandHex(full)) onChange(full.toUpperCase());
  }
  return (
    <div className="ops-colour-field">
      <input type="color" aria-label="Colour" value={hex.toLowerCase()} onChange={(event) => { setText(event.target.value.toUpperCase()); onChange(event.target.value.toUpperCase()); }} />
      <input aria-label="Colour code" value={text} maxLength={7} spellCheck={false} autoCapitalize="characters" onChange={(event) => typed(event.target.value)}
        onBlur={() => setText(hex)} />
    </div>
  );
}

/** The panel under a hatband row: its name and colour. Edits are sent a moment after the last change, and the last one on Done. */
function BandEditor({ band, onSave, onDone }: { band: string; onSave: (value: string) => void; onDone: () => void }) {
  const [name, setName] = useState(hatbandName(band));
  const [hex, setHex] = useState(hatbandHex(band));
  const timer = useRef<number | null>(null);
  const latest = useRef({ name, hex, onSave, band });
  useEffect(() => { latest.current = { name, hex, onSave, band }; });
  const send = () => {
    timer.current = null;
    const { name: n, hex: h, onSave: save, band: original } = latest.current;
    // An empty name keeps the old one rather than saving a blank.
    const value = formatHatband(n.trim() ? n : parseHatband(original).name || 'Custom colour', h);
    if (value !== original) save(value);
  };
  const soon = () => { if (timer.current !== null) window.clearTimeout(timer.current); timer.current = window.setTimeout(send, 400); };
  useEffect(() => () => { if (timer.current !== null) { window.clearTimeout(timer.current); send(); } }, []);
  return (
    <div className="ops-dup" role="group" aria-label={`Change colour of ${hatbandName(band)}`}>
      <label className="rf-fld">Name<input value={name} maxLength={30} onChange={(event) => { setName(event.target.value); latest.current.name = event.target.value; soon(); }} /></label>
      <ColourField hex={hex} onChange={(value) => { setHex(value); latest.current.hex = value; soon(); }} />
      <div className="rf-actions"><button type="button" className="rf-btn rf-btn-primary" onClick={onDone}>Done</button></div>
    </div>
  );
}

/** Adding a hatband: pick a usual colour or choose your own, name it, and add it. */
function AddBand({ busy, onAdd, onCancel }: { busy: boolean; onAdd: (value: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [hex, setHex] = useState('#C8202F');
  const [pick, setPick] = useState(0);
  const choose = (colour: string) => { setName(colour); setHex(HATBAND_PALETTE[colour]); setPick((n) => n + 1); };
  return (
    <form className="ops-dup" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onAdd(formatHatband(name, hex)); }}>
      <div className="ops-chips" role="group" aria-label="Quick colours">
        {HATBAND_COLOURS.map((colour) => (
          <button key={colour} type="button" className="rf-btn" onClick={() => choose(colour)}><span className="ops-dot-colour" aria-hidden="true" style={{ background: HATBAND_PALETTE[colour] ?? NO_COLOUR }} />{colour}</button>
        ))}
      </div>
      <label className="rf-fld">Name<input value={name} placeholder="Any name" maxLength={30} onChange={(event) => setName(event.target.value)} /></label>
      <ColourField key={pick} hex={hex} onChange={setHex} />
      <div className="rf-actions"><button type="submit" className="rf-btn rf-btn-primary" disabled={busy || !name.trim()}>Add hatband</button><button type="button" className="rf-btn" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}
