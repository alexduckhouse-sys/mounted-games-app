import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Notice } from '../../components/Notice';
import { useSavedToast } from '../../components/SavedTick';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { competitionUpdateBody } from '../../lib/competitionPayload';
import { payoutsLine } from '../../lib/payouts';
import { MAX_SECTOR_NAME, MAX_TACK_SECTORS, isScored, sectorProblem } from '../../lib/tackCheck';
import type { CompetitionDetail, PassportCheckBoard, TackCheckBoard, TackCheckMode, TackCheckSection } from '../../types';
import { useCompetition } from '../competition/context';
import { RefineChoiceRow, RefineHeader, RefineList, RefineNote, RefinePage, RefineSection } from '../refine/Refine';
import { apiMessage } from './types';
import { confirmDialog } from '../../components/ConfirmDialog';
import { horseboxEntrance, isValidWhat3Words, parseCoordinates } from './lorryEntrance';
import './operations.css';

/** An ISO instant as the `YYYY-MM-DDTHH:mm` a datetime-local box wants, in the device's zone. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type TackChoice = 'off' | 'pass' | 'table' | 'points';
const TACK_OPTIONS: Array<{ value: TackChoice; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'pass', label: 'Pass or fail' },
  { value: 'table', label: 'Own table' },
  { value: 'points', label: 'Adds to points' },
];
const MODE_OF: Record<Exclude<TackChoice, 'off'>, TackCheckMode> = { pass: 0, table: 1, points: 2 };
const choiceOf = (section: TackCheckSection): TackChoice => (!section.isEnabled ? 'off' : section.mode === 0 ? 'pass' : section.mode === 1 ? 'table' : 'points');

/** The competition's own details, switches and tack checks. Every change saves as it is made. */
export function EventDetailsPage() {
  const { competition, reload } = useCompetition();
  const { hasRole } = useAuth();
  const mayDuplicate = Boolean(hasRole?.('Admin') || hasRole?.('Trainer'));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);
  const [passport, setPassport] = useState<boolean | null>(null);
  const [cards, setCards] = useState<boolean | null>(null);
  const [tack, setTack] = useState<TackCheckSection[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scoring, setScoring] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const base = `/event-tools/competitions/${competition.id}`;
    Promise.all([
      api.get<PassportCheckBoard>(`${base}/passport-check`),
      api.get<TackCheckBoard>(`${base}/tack-check`),
      api.get<{ config?: { useRefereeCards?: boolean } }>(`/competitions/${competition.id}/dec-form-config`),
    ])
      .then(([p, t, d]) => { if (cancelled) return; setPassport(p.data.enabled); setTack(t.data.sections); setCards(Boolean(d.data?.config?.useRefereeCards)); })
      .catch((caught) => { if (!cancelled) setLoadError(apiMessage(caught, 'Couldn’t load the checks. Check your signal and try again.')); });
    return () => { cancelled = true; };
  }, [competition.id]);

  // Each change saves as you go, so a small toast confirms it wherever you are on the page.
  const savedToast = useSavedToast();
  const showSaved = savedToast.show;

  /** Runs one save, counting it while it is in flight and showing why it failed. Resolves true when it worked. */
  const track = useCallback(async (what: string, work: () => Promise<void>): Promise<boolean> => {
    setSaving((n) => n + 1);
    setError(null);
    try {
      await work();
      const name = what.replace(/^the /, '');
      showSaved(name.charAt(0).toUpperCase() + name.slice(1));
      return true;
    }
    catch (caught) { setError(apiMessage(caught, `Couldn’t save ${what}. Check your signal and try again.`)); return false; }
    finally { setSaving((n) => n - 1); }
  }, [showSaved]);

  const saveBasics = (what: string, patch: Record<string, string | number | boolean | null>) =>
    track(what, async () => {
      await api.put(`/competitions/${competition.id}`, competitionUpdateBody(competition, patch));
      reload();
    });

  async function setPassportCheck(next: boolean) {
    const before = passport;
    setPassport(next);
    const ok = await track('the passport check', async () => { await api.put(`/event-tools/competitions/${competition.id}/passport-check/settings`, { enabled: next }); });
    if (!ok) setPassport(before);
  }

  async function setRefereeCards(next: boolean) {
    const before = cards;
    setCards(next);
    const ok = await saveBasics('the cards setting', { useRefereeCards: next });
    if (!ok) setCards(before);
  }

  async function saveTack(section: TackCheckSection, patch: Partial<Pick<TackCheckSection, 'isEnabled' | 'mode' | 'maxPoints'>> & { sectors?: Array<{ id: number; name: string }> }): Promise<boolean> {
    const next = { isEnabled: section.isEnabled, mode: section.mode, maxPoints: section.maxPoints, ...patch };
    const sectors = (patch.sectors ?? section.sectors).map((s) => ({ id: s.id || null, name: s.name }));
    return track('the tack check', async () => {
      const { data } = await api.put<TackCheckSection>(`/event-tools/competitions/${competition.id}/tack-check/sections/${section.sectionId}`, { ...next, sectors });
      setTack((list) => (list ? list.map((s) => (s.sectionId === data.sectionId ? { ...s, ...data, teams: data.teams ?? s.teams } : s)) : list));
    });
  }

  function chooseTack(section: TackCheckSection, choice: TackChoice) {
    if (choice === 'off') { setScoring(null); void saveTack(section, { isEnabled: false }); return; }
    void saveTack(section, { isEnabled: true, mode: MODE_OF[choice] });
  }

  const lorryPin = competition.lorryLatitude != null && competition.lorryLongitude != null ? `${competition.lorryLatitude}, ${competition.lorryLongitude}` : '';

  async function saveLorryWords(value: string): Promise<boolean> {
    if (value && !isValidWhat3Words(value)) { setError('A what3words address is three words with dots between, like filled.count.soap.'); return false; }
    // A new address replaces the pin, so a pin for the old place can't stay behind.
    return saveBasics('the horsebox gate', { lorryWhat3Words: value.replace(/^\/+/, ''), lorryLatitude: null, lorryLongitude: null });
  }

  async function saveLorryPin(value: string): Promise<boolean> {
    if (!value) {
      if (lorryPin) setError('To clear the pin, remove the whole horsebox entrance.');
      return false;
    }
    const pin = parseCoordinates(value);
    if (!pin) { setError('Enter the pin as latitude, longitude, like 52.1234, -1.5678.'); return false; }
    return saveBasics('the horsebox pin', { lorryLatitude: pin.lat, lorryLongitude: pin.lon });
  }

  async function removeLorryEntrance() {
    if (!(await confirmDialog({ title: 'Remove the horsebox entrance?', message: 'The Horsebox entrance card disappears from the event page.', confirmLabel: 'Remove entrance', destructive: true }))) return;
    await saveBasics('the horsebox entrance', { lorryWhat3Words: '', lorryLatitude: null, lorryLongitude: null, lorryDirectionsNote: '' });
  }

  return (
    <RefinePage>
      <RefineHeader back={`/competitions/${competition.id}/operations`} backLabel="Back to Before the day" context={competition.name} title="Event details" />
      <div className="ops-cards">
        {error && <Notice>{error}</Notice>}
        {saving > 0 && <p role="status" className="rf-note">Saving…</p>}
        {savedToast.node}

        <RefineSection title="About" />
        <div className="ops-fields">
          <TextField key={competition.name} label="Name" value={competition.name} required onSave={(value) => saveBasics('the name', { name: value })} />
          <TextField key={competition.organiserName ?? ''} label="Organiser" value={competition.organiserName ?? ''} onSave={(value) => saveBasics('the organiser', { organiserName: value || null })} />
        </div>

        <RefineSection title="When and where" />
        <div className="ops-fields-row">
          <DateField key={competition.startDate} label="Starts" value={competition.startDate} required other={competition.endDate} onSave={(iso) => saveBasics('the start', { startDate: iso })} onProblem={setError} />
          <DateField key={competition.endDate ?? ''} label="Ends" value={competition.endDate ?? ''} after={competition.startDate} onSave={(iso) => saveBasics('the end', { endDate: iso })} onProblem={setError} />
        </div>
        <div className="ops-fields">
          <TextField key={competition.location ?? ''} label="Venue" value={competition.location ?? ''} onSave={(value) => saveBasics('the venue', { location: value || null })} />
          {/* Blank is sent as blank, not null: the API leaves a value alone on null and clears it on blank. */}
          <TextField key={`pc-${competition.postcode ?? ''}`} label="Postcode" value={competition.postcode ?? ''} onSave={(value) => saveBasics('the postcode', { postcode: value })} />
        </div>

        <RefineSection title="Horsebox entrance" />
        <div className="ops-fields">
          <TextField key={`lw-${competition.lorryWhat3Words ?? ''}`} label="what3words for the horsebox gate (optional)" value={competition.lorryWhat3Words ? `///${competition.lorryWhat3Words.replace(/^\/+/, '')}` : ''} onSave={saveLorryWords} />
          <TextField key={`lc-${competition.lorryLatitude ?? ''}-${competition.lorryLongitude ?? ''}`} label="Pin for the gate: latitude, longitude (optional)" value={lorryPin} onSave={saveLorryPin} />
          <TextField key={`ln-${competition.lorryDirectionsNote ?? ''}`} label="Directions for lorries (optional)" value={competition.lorryDirectionsNote ?? ''} multiline onSave={(value) => saveBasics('the horsebox directions', { lorryDirectionsNote: value })} />
        </div>
        <RefineNote>Fill this in only if lorries and horseboxes use a different gate. Entrants then see a Horsebox entrance card with map links. Changing the words replaces the pin with one that matches them.</RefineNote>
        {horseboxEntrance(competition) && (
          <RefineList as="div">
            <div className="rf-row"><span className="rf-grow rf-t1">Everyone uses the same gate</span>
              <button type="button" className="ops-danger-link" onClick={() => void removeLorryEntrance()}>Remove the horsebox entrance</button></div>
          </RefineList>
        )}

        <RefineSection title="Entries" />
        <div className="ops-fields">
          <TextField key={`no-${competition.competitionNumber ?? ''}`} label="Competition number" value={competition.competitionNumber ?? ''} onSave={(value) => saveBasics('the competition number', { competitionNumber: value })} />
          <TextField key={`em-${competition.contactEmail ?? ''}`} label="Contact email" value={competition.contactEmail ?? ''} onSave={(value) => saveBasics('the contact email', { contactEmail: value })} />
        </div>
        <RefineNote>The contact email shows on the event page, so entrants can write to you.</RefineNote>

        <RefineSection title="Payment" />
        <RefineList as="div">
          <div className="rf-row">
            <span className="rf-grow"><span className="rf-t1">Entry fees</span><span className="rf-t2">{competition.payoutsTo ? payoutsLine(competition.payoutsTo) : 'Payouts go to your club once it has set them up.'}{competition.isDemo ? ' Test mode.' : ''}</span></span>
            {!competition.payoutsTo?.ready && <Link to="/me/payouts" className="rf-btn">Set up payouts</Link>}
          </div>
        </RefineList>
        <div className="ops-fields ops-gap">
          <TextField key={competition.description ?? ''} label="Notes for riders (optional)" value={competition.description ?? ''} multiline onSave={(value) => saveBasics('the notes', { description: value || null })} />
        </div>

        <RefineSection title="Checks and cards" />
        {loadError && <Notice>{loadError}</Notice>}
        {passport !== null && (
          <RefineList as="div">
            <div className="rf-row">
              <button type="button" role="switch" aria-checked={passport} className="ops-swr" onClick={() => void setPassportCheck(!passport)}>
                <span className="ops-sw" aria-hidden="true" /><span>Passport and vaccination check</span>
              </button>
            </div>
            {cards !== null && (
              <div className="rf-row">
                <button type="button" role="switch" aria-checked={cards} className="ops-swr" onClick={() => void setRefereeCards(!cards)}>
                  <span className="ops-sw" aria-hidden="true" /><span>Yellow and red cards</span>
                </button>
              </div>
            )}
          </RefineList>
        )}
        {tack && tack.length > 0 && (
          <RefineList as="div" label="Tack checks">
            {tack.map((section) => (
              <div key={section.sectionId}>
                <RefineChoiceRow label={`Tack check · ${section.sectionName}`} value={choiceOf(section)} options={TACK_OPTIONS} onChange={(choice) => chooseTack(section, choice)} />
                {section.isEnabled && isScored(section.mode) && (
                  <ScoringTable section={section} open={scoring === section.sectionId} onToggle={(open) => setScoring(open ? section.sectionId : null)}
                    onSave={async (sectors, maxPoints) => {
                      const ok = await saveTack(section, { sectors, maxPoints });
                      if (ok) setScoring(null);
                      return ok;
                    }} />
                )}
              </div>
            ))}
          </RefineList>
        )}

        {mayDuplicate && <DuplicateSetUp competition={competition} onError={setError} />}
      </div>
    </RefinePage>
  );
}

/** A text box that saves when it loses focus, and only if it changed. */
function TextField({ label, value, onSave, multiline = false, required = false }: { label: string; value: string; onSave: (value: string) => Promise<boolean>; multiline?: boolean; required?: boolean }) {
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);
  async function blur() {
    const next = text.trim();
    if (next === value.trim()) { setText(value); return; }
    if (required && !next) { setInvalid(true); setText(value); return; }
    setInvalid(false);
    await onSave(next);
  }
  return (
    <label className="rf-fld">
      {label}
      {multiline
        ? <textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} onBlur={() => void blur()} className="ops-textarea" />
        : <input value={text} onChange={(event) => setText(event.target.value)} onBlur={() => void blur()} aria-invalid={invalid || undefined} />}
      {invalid && <span role="alert" className="ops-warn">{label} can’t be empty.</span>}
    </label>
  );
}

/** A date and time box that saves on blur. An end before the start is refused. */
function DateField({ label, value, onSave, onProblem, required = false, after, other }: {
  label: string; value: string; onSave: (iso: string | null) => Promise<boolean>; onProblem: (message: string | null) => void;
  required?: boolean; after?: string | null; other?: string | null;
}) {
  const shown = toLocalInput(value);
  const [text, setText] = useState(shown);
  async function blur() {
    if (text === shown) return;
    const when = text ? new Date(text) : null;
    if (!when && required) { onProblem(`${label} needs a date and time.`); setText(shown); return; }
    if (when && Number.isNaN(when.getTime())) { setText(shown); return; }
    if (when && ((after && when < new Date(after)) || (other && when > new Date(other)))) { onProblem('The event can’t end before it starts.'); setText(shown); return; }
    onProblem(null);
    await onSave(when ? when.toISOString() : null);
  }
  return <label className="rf-fld">{label}<input type="datetime-local" value={text} onChange={(event) => setText(event.target.value)} onBlur={() => void blur()} /></label>;
}

interface SectorRow { key: number; id: number; name: string }
let rowKey = 1;

/** "4 sectors · 40 points" with Edit, opening the list of sectors. Done saves it. */
function ScoringTable({ section, open, onToggle, onSave }: {
  section: TackCheckSection; open: boolean; onToggle: (open: boolean) => void;
  onSave: (sectors: Array<{ id: number; name: string }>, maxPoints: number) => Promise<boolean>;
}) {
  const [rows, setRows] = useState<SectorRow[]>([]);
  const [max, setMax] = useState(String(section.maxPoints));
  const [problem, setProblem] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const count = section.sectors.length;

  function begin() {
    setRows(section.sectors.map((s) => ({ key: rowKey++, id: s.id, name: s.name })));
    setMax(String(section.maxPoints));
    setProblem(null);
    onToggle(true);
  }
  async function done() {
    const named = rows.filter((row) => row.name.trim());
    const points = Number(max);
    const issue = sectorProblem(named.map((row) => row.name))
      ?? (Number.isInteger(points) && points >= 1 && points <= 100 ? null : 'Points per sector must be a whole number from 1 to 100.');
    if (issue) { setProblem(issue); return; }
    setProblem(null);
    await onSave(named.map((row) => ({ id: row.id, name: row.name.trim() })), points);
  }

  return (
    <>
      <div className="rf-row">
        <span className="rf-grow"><span className="rf-t1">Scoring table</span><span className="rf-t2">{count === 1 ? '1 sector' : `${count} sectors`} · {count * section.maxPoints} points</span></span>
        {open ? <button type="button" className="rf-btn" onClick={() => void done()}>Done</button> : <button type="button" className="rf-btn" onClick={begin}>Edit</button>}
      </div>
      {open && (
        <div className="ops-sectors">
          {rows.map((row, index) => (
            <div key={row.key} className="ops-sector">
              <input aria-label={`Sector ${index + 1} name`} value={row.name} maxLength={MAX_SECTOR_NAME} placeholder="Sector name" autoFocus={focusKey === row.key}
                onChange={(event) => setRows((list) => list.map((r) => (r.key === row.key ? { ...r, name: event.target.value } : r)))}
                onBlur={() => setRows((list) => (list.find((r) => r.key === row.key)?.name.trim() ? list : list.filter((r) => r.key !== row.key)))} />
              <button type="button" className="ops-danger-link" aria-label={`Remove sector ${index + 1}`} onClick={() => setRows((list) => list.filter((r) => r.key !== row.key))}>Remove</button>
            </div>
          ))}
          {rows.length < MAX_TACK_SECTORS && (
            <div><button type="button" className="rf-btn" onClick={() => { const key = rowKey++; setFocusKey(key); setRows((list) => [...list, { key, id: 0, name: '' }]); }}><Plus className="h-4 w-4" aria-hidden="true" />Add a sector</button></div>
          )}
          <label className="ops-outof">Each sector is out of<input inputMode="numeric" aria-label="Points per sector" value={max} onChange={(event) => setMax(event.target.value)} /></label>
          {problem && <p role="alert" className="ops-warn">{problem}</p>}
        </div>
      )}
    </>
  );
}

/** Duplicate the set-up into a new event. The API copies sections, teams, sessions and heats, never results or payments. */
function DuplicateSetUp({ competition, onError }: { competition: CompetitionDetail; onError: (message: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ id: number; name: string } | null>(null);

  function begin() {
    setName(`${competition.name} copy`);
    setStart(toLocalInput(competition.startDate));
    setEnd(toLocalInput(competition.endDate));
    setMade(null);
    setOpen(true);
  }
  async function duplicate() {
    setBusy(true);
    onError(null);
    try {
      const { data } = await api.post<{ competitionId: number; name: string }>(`/event-tools/competitions/${competition.id}/clone`, {
        name: name.trim(), startDate: new Date(start).toISOString(), endDate: end ? new Date(end).toISOString() : null,
      });
      setMade({ id: data.competitionId, name: data.name });
      setOpen(false);
    } catch (caught) { onError(apiMessage(caught, 'Couldn’t duplicate this event. Check your signal and try again.')); }
    finally { setBusy(false); }
  }

  const ready = name.trim().length > 0 && start.length > 0;
  let form: ReactNode = null;
  if (open) {
    form = (
      <div className="ops-dup">
        <label className="rf-fld">New name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div className="ops-fields-row">
          <label className="rf-fld">Starts<input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} /></label>
          <label className="rf-fld">Ends<input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
        </div>
        <div className="rf-actions"><button type="button" className="rf-btn rf-btn-primary" disabled={!ready || busy} onClick={() => void duplicate()}>{busy ? 'Duplicating…' : 'Duplicate'}</button><button type="button" className="rf-btn" onClick={() => setOpen(false)}>Cancel</button></div>
      </div>
    );
  }
  return (
    <>
      <RefineSection title="Copy this set-up" />
      <RefineList as="div">
        <div className="rf-row ops-wrap">
          <span className="rf-grow"><span className="rf-t1">Duplicate for next year</span><span className="rf-t2">Results and payments aren’t copied.</span></span>
          {!open && <button type="button" className="rf-btn" onClick={begin}>Duplicate</button>}
        </div>
        {form}
        {made && (
          <div className="rf-row" role="status">
            <span className="rf-grow"><span className="rf-t1">{made.name} is ready</span></span>
            <Link className="rf-btn" to={`/competitions/${made.id}`}>Open it</Link>
          </div>
        )}
      </RefineList>
    </>
  );
}
