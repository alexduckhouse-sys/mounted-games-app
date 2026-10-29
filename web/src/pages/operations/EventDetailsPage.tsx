import { useT } from '../../i18n/LanguageContext';
import type { MessageKey } from '../../i18n/en';
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
const TACK_OPTIONS: Array<{ value: TackChoice; label: MessageKey }> = [
  { value: 'off', label: 'ops.detail.tack.off' },
  { value: 'pass', label: 'ops.detail.tack.pass' },
  { value: 'table', label: 'ops.detail.tack.table' },
  { value: 'points', label: 'ops.detail.tack.points' },
];
/** What a save was about: the phrase for a failure and the word shown when it worked (both translated where used). */
type What = 'name' | 'organiser' | 'start' | 'end' | 'venue' | 'postcode' | 'indoor' | 'gate' | 'pin' | 'directions' | 'entrance' | 'number' | 'email' | 'notes' | 'passport' | 'cards' | 'tack';
const WHAT: Record<What, { what: MessageKey; saved: MessageKey }> = {
  name: { what: 'ops.detail.what.name', saved: 'ops.detail.saved.name' },
  organiser: { what: 'ops.detail.what.organiser', saved: 'ops.detail.saved.organiser' },
  start: { what: 'ops.detail.what.start', saved: 'ops.detail.saved.start' },
  end: { what: 'ops.detail.what.end', saved: 'ops.detail.saved.end' },
  venue: { what: 'ops.detail.what.venue', saved: 'ops.detail.saved.venue' },
  postcode: { what: 'ops.detail.what.postcode', saved: 'ops.detail.saved.postcode' },
  indoor: { what: 'ops.detail.what.indoor', saved: 'ops.detail.saved.indoor' },
  gate: { what: 'ops.detail.what.gate', saved: 'ops.detail.saved.gate' },
  pin: { what: 'ops.detail.what.pin', saved: 'ops.detail.saved.pin' },
  directions: { what: 'ops.detail.what.directions', saved: 'ops.detail.saved.directions' },
  entrance: { what: 'ops.detail.what.entrance', saved: 'ops.detail.saved.entrance' },
  number: { what: 'ops.detail.what.number', saved: 'ops.detail.saved.number' },
  email: { what: 'ops.detail.what.email', saved: 'ops.detail.saved.email' },
  notes: { what: 'ops.detail.what.notes', saved: 'ops.detail.saved.notes' },
  passport: { what: 'ops.detail.what.passport', saved: 'ops.detail.saved.passport' },
  cards: { what: 'ops.detail.what.cards', saved: 'ops.detail.saved.cards' },
  tack: { what: 'ops.detail.what.tack', saved: 'ops.detail.saved.tack' },
};
const MODE_OF: Record<Exclude<TackChoice, 'off'>, TackCheckMode> = { pass: 0, table: 1, points: 2 };
const choiceOf = (section: TackCheckSection): TackChoice => (!section.isEnabled ? 'off' : section.mode === 0 ? 'pass' : section.mode === 1 ? 'table' : 'points');

/** The competition's own details, switches and tack checks. Every change saves as it is made. */
export function EventDetailsPage() {
  const { competition, reload } = useCompetition();
  const { hasRole } = useAuth();
  const t = useT();
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
      .then(([p, tc, d]) => { if (cancelled) return; setPassport(p.data.enabled); setTack(tc.data.sections); setCards(Boolean(d.data?.config?.useRefereeCards)); })
      .catch((caught) => { if (!cancelled) setLoadError(apiMessage(caught, t('ops.detail.loadError'))); });
    return () => { cancelled = true; };
  }, [competition.id, t]);

  // Each change saves as you go, so a small toast confirms it wherever you are on the page.
  const savedToast = useSavedToast();
  const showSaved = savedToast.show;

  /** Runs one save, counting it while it is in flight and showing why it failed. Resolves true when it worked. */
  const track = useCallback(async (what: What, work: () => Promise<void>): Promise<boolean> => {
    setSaving((n) => n + 1);
    setError(null);
    try {
      await work();
      showSaved(t(WHAT[what].saved));
      return true;
    }
    catch (caught) { setError(apiMessage(caught, t('ops.detail.saveFail', { what: t(WHAT[what].what) }))); return false; }
    finally { setSaving((n) => n - 1); }
  }, [showSaved, t]);

  const saveBasics = (what: What, patch: Record<string, string | number | boolean | null>) =>
    track(what, async () => {
      await api.put(`/competitions/${competition.id}`, competitionUpdateBody(competition, patch));
      reload();
    });

  async function setPassportCheck(next: boolean) {
    const before = passport;
    setPassport(next);
    const ok = await track('passport', async () => { await api.put(`/event-tools/competitions/${competition.id}/passport-check/settings`, { enabled: next }); });
    if (!ok) setPassport(before);
  }

  async function setRefereeCards(next: boolean) {
    const before = cards;
    setCards(next);
    const ok = await saveBasics('cards', { useRefereeCards: next });
    if (!ok) setCards(before);
  }

  async function saveTack(section: TackCheckSection, patch: Partial<Pick<TackCheckSection, 'isEnabled' | 'mode' | 'maxPoints'>> & { sectors?: Array<{ id: number; name: string }> }): Promise<boolean> {
    const next = { isEnabled: section.isEnabled, mode: section.mode, maxPoints: section.maxPoints, ...patch };
    const sectors = (patch.sectors ?? section.sectors).map((s) => ({ id: s.id || null, name: s.name }));
    return track('tack', async () => {
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
    if (value && !isValidWhat3Words(value)) { setError(t('ops.detail.w3wError')); return false; }
    // A new address replaces the pin, so a pin for the old place can't stay behind.
    return saveBasics('gate', { lorryWhat3Words: value.replace(/^\/+/, ''), lorryLatitude: null, lorryLongitude: null });
  }

  async function saveLorryPin(value: string): Promise<boolean> {
    if (!value) {
      if (lorryPin) setError(t('ops.detail.clearPin'));
      return false;
    }
    const pin = parseCoordinates(value);
    if (!pin) { setError(t('ops.detail.pinFormat')); return false; }
    return saveBasics('pin', { lorryLatitude: pin.lat, lorryLongitude: pin.lon });
  }

  async function removeLorryEntrance() {
    if (!(await confirmDialog({ title: t('ops.detail.removeTitle'), message: t('ops.detail.removeMsg'), confirmLabel: t('ops.detail.removeConfirm'), destructive: true }))) return;
    await saveBasics('entrance', { lorryWhat3Words: '', lorryLatitude: null, lorryLongitude: null, lorryDirectionsNote: '' });
  }

  return (
    <RefinePage>
      <RefineHeader back={`/competitions/${competition.id}/operations`} backLabel={t('ops.hub.back')} context={competition.name} title={t('ops.detail.title')} />
      <div className="ops-cards">
        {error && <Notice>{error}</Notice>}
        {saving > 0 && <p role="status" className="rf-note">{t('common.saving')}</p>}
        {savedToast.node}

        <RefineSection title={t('ops.detail.about')} />
        <div className="ops-fields">
          <TextField key={competition.name} label={t('ops.detail.name')} value={competition.name} required onSave={(value) => saveBasics('name', { name: value })} />
          <TextField key={competition.organiserName ?? ''} label={t('ops.detail.organiser')} value={competition.organiserName ?? ''} onSave={(value) => saveBasics('organiser', { organiserName: value || null })} />
        </div>

        <RefineSection title={t('ops.detail.whenWhere')} />
        <div className="ops-fields-row">
          <DateField key={competition.startDate} label={t('ops.detail.starts')} value={competition.startDate} required other={competition.endDate} onSave={(iso) => saveBasics('start', { startDate: iso })} onProblem={setError} />
          <DateField key={competition.endDate ?? ''} label={t('ops.detail.ends')} value={competition.endDate ?? ''} after={competition.startDate} onSave={(iso) => saveBasics('end', { endDate: iso })} onProblem={setError} />
        </div>
        <div className="ops-fields">
          <TextField key={competition.location ?? ''} label={t('ops.detail.venue')} value={competition.location ?? ''} onSave={(value) => saveBasics('venue', { location: value || null })} />
          {/* Blank is sent as blank, not null: the API leaves a value alone on null and clears it on blank. */}
          <TextField key={`pc-${competition.postcode ?? ''}`} label={t('ops.detail.postcode')} value={competition.postcode ?? ''} onSave={(value) => saveBasics('postcode', { postcode: value })} />
        </div>
        <RefineList as="div">
          <RefineChoiceRow
            label={t('ops.detail.arenaType')}
            value={competition.isIndoor ? 'indoor' : 'outdoor'}
            options={[
              { value: 'outdoor', label: t('ops.detail.outdoor') },
              { value: 'indoor', label: t('ops.detail.indoor') },
            ]}
            onChange={(choice) => void saveBasics('indoor', { isIndoor: choice === 'indoor' })}
          />
        </RefineList>

        <RefineSection title={t('ops.detail.horsebox')} />
        <div className="ops-fields">
          <TextField key={`lw-${competition.lorryWhat3Words ?? ''}`} label={t('ops.detail.w3w')} value={competition.lorryWhat3Words ? `///${competition.lorryWhat3Words.replace(/^\/+/, '')}` : ''} onSave={saveLorryWords} />
          <TextField key={`lc-${competition.lorryLatitude ?? ''}-${competition.lorryLongitude ?? ''}`} label={t('ops.detail.pinLabel')} value={lorryPin} onSave={saveLorryPin} />
          <TextField key={`ln-${competition.lorryDirectionsNote ?? ''}`} label={t('ops.detail.lorryDirections')} value={competition.lorryDirectionsNote ?? ''} multiline onSave={(value) => saveBasics('directions', { lorryDirectionsNote: value })} />
        </div>
        <RefineNote>{t('ops.detail.horseboxNote')}</RefineNote>
        {horseboxEntrance(competition) && (
          <RefineList as="div">
            <div className="rf-row"><span className="rf-grow rf-t1">{t('ops.detail.sameGate')}</span>
              <button type="button" className="ops-danger-link" onClick={() => void removeLorryEntrance()}>{t('ops.detail.removeLink')}</button></div>
          </RefineList>
        )}

        <RefineSection title={t('ops.detail.entries')} />
        <div className="ops-fields">
          <TextField key={`no-${competition.competitionNumber ?? ''}`} label={t('ops.detail.compNumber')} value={competition.competitionNumber ?? ''} onSave={(value) => saveBasics('number', { competitionNumber: value })} />
          <TextField key={`em-${competition.contactEmail ?? ''}`} label={t('ops.detail.contactEmail')} value={competition.contactEmail ?? ''} onSave={(value) => saveBasics('email', { contactEmail: value })} />
        </div>
        <RefineNote>{t('ops.detail.contactNote')}</RefineNote>

        <RefineSection title={t('ops.detail.payment')} />
        <RefineList as="div">
          <div className="rf-row">
            <span className="rf-grow"><span className="rf-t1">{t('ops.detail.fees')}</span><span className="rf-t2">{competition.payoutsTo ? payoutsLine(competition.payoutsTo) : t('ops.detail.payoutsDefault')}{competition.isDemo ? t('ops.detail.testMode') : ''}</span></span>
            {!competition.payoutsTo?.ready && <Link to="/me/payouts" className="rf-btn">{t('ops.detail.setupPayouts')}</Link>}
          </div>
        </RefineList>
        <div className="ops-fields ops-gap">
          <TextField key={competition.description ?? ''} label={t('ops.detail.notes')} value={competition.description ?? ''} multiline onSave={(value) => saveBasics('notes', { description: value || null })} />
        </div>

        <RefineSection title={t('ops.detail.checks')} />
        {loadError && <Notice>{loadError}</Notice>}
        {passport !== null && (
          <RefineList as="div">
            <div className="rf-row">
              <button type="button" role="switch" aria-checked={passport} className="ops-swr" onClick={() => void setPassportCheck(!passport)}>
                <span className="ops-sw" aria-hidden="true" /><span>{t('ops.detail.passportSwitch')}</span>
              </button>
            </div>
            {cards !== null && (
              <div className="rf-row">
                <button type="button" role="switch" aria-checked={cards} className="ops-swr" onClick={() => void setRefereeCards(!cards)}>
                  <span className="ops-sw" aria-hidden="true" /><span>{t('ops.detail.cardsSwitch')}</span>
                </button>
              </div>
            )}
          </RefineList>
        )}
        {tack && tack.length > 0 && (
          <RefineList as="div" label={t('ops.detail.tackChecks')}>
            {tack.map((section) => (
              <div key={section.sectionId}>
                <RefineChoiceRow label={t('ops.detail.tackRow', { section: section.sectionName })} value={choiceOf(section)} options={TACK_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))} onChange={(choice) => chooseTack(section, choice)} />
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
  const t = useT();
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
      {invalid && <span role="alert" className="ops-warn">{t('ops.detail.cantBeEmpty', { label })}</span>}
    </label>
  );
}

/** A date and time box that saves on blur. An end before the start is refused. */
function DateField({ label, value, onSave, onProblem, required = false, after, other }: {
  label: string; value: string; onSave: (iso: string | null) => Promise<boolean>; onProblem: (message: string | null) => void;
  required?: boolean; after?: string | null; other?: string | null;
}) {
  const t = useT();
  const shown = toLocalInput(value);
  const [text, setText] = useState(shown);
  async function blur() {
    if (text === shown) return;
    const when = text ? new Date(text) : null;
    if (!when && required) { onProblem(t('ops.detail.needsDate', { label })); setText(shown); return; }
    if (when && Number.isNaN(when.getTime())) { setText(shown); return; }
    if (when && ((after && when < new Date(after)) || (other && when > new Date(other)))) { onProblem(t('ops.detail.endBefore')); setText(shown); return; }
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
  const t = useT();
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
      ?? (Number.isInteger(points) && points >= 1 && points <= 100 ? null : t('ops.detail.pointsRange'));
    if (issue) { setProblem(issue); return; }
    setProblem(null);
    await onSave(named.map((row) => ({ id: row.id, name: row.name.trim() })), points);
  }

  return (
    <>
      <div className="rf-row">
        <span className="rf-grow"><span className="rf-t1">{t('ops.detail.scoringTable')}</span><span className="rf-t2">{t('ops.detail.sectors', { count })} · {t('ops.detail.points', { count: count * section.maxPoints })}</span></span>
        {open ? <button type="button" className="rf-btn" onClick={() => void done()}>{t('common.done')}</button> : <button type="button" className="rf-btn" onClick={begin}>{t('common.edit')}</button>}
      </div>
      {open && (
        <div className="ops-sectors">
          {rows.map((row, index) => (
            <div key={row.key} className="ops-sector">
              <input aria-label={t('ops.detail.sectorName', { n: index + 1 })} value={row.name} maxLength={MAX_SECTOR_NAME} placeholder={t('ops.detail.sectorPlaceholder')} autoFocus={focusKey === row.key}
                onChange={(event) => setRows((list) => list.map((r) => (r.key === row.key ? { ...r, name: event.target.value } : r)))}
                onBlur={() => setRows((list) => (list.find((r) => r.key === row.key)?.name.trim() ? list : list.filter((r) => r.key !== row.key)))} />
              <button type="button" className="ops-danger-link" aria-label={t('ops.detail.removeSector', { n: index + 1 })} onClick={() => setRows((list) => list.filter((r) => r.key !== row.key))}>{t('ops.detail.removeShort')}</button>
            </div>
          ))}
          {rows.length < MAX_TACK_SECTORS && (
            <div><button type="button" className="rf-btn" onClick={() => { const key = rowKey++; setFocusKey(key); setRows((list) => [...list, { key, id: 0, name: '' }]); }}><Plus className="h-4 w-4" aria-hidden="true" />{t('ops.detail.addSector')}</button></div>
          )}
          <label className="ops-outof">{t('ops.detail.outOf')}<input inputMode="numeric" aria-label={t('ops.detail.pointsPerSector')} value={max} onChange={(event) => setMax(event.target.value)} /></label>
          {problem && <p role="alert" className="ops-warn">{problem}</p>}
        </div>
      )}
    </>
  );
}

/** Duplicate the set-up into a new event. The API copies sections, teams, sessions and heats, never results or payments. */
function DuplicateSetUp({ competition, onError }: { competition: CompetitionDetail; onError: (message: string | null) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ id: number; name: string } | null>(null);

  function begin() {
    setName(t('ops.detail.copyName', { name: competition.name }));
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
    } catch (caught) { onError(apiMessage(caught, t('ops.detail.dupFail'))); }
    finally { setBusy(false); }
  }

  const ready = name.trim().length > 0 && start.length > 0;
  let form: ReactNode = null;
  if (open) {
    form = (
      <div className="ops-dup">
        <label className="rf-fld">{t('ops.detail.newName')}<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div className="ops-fields-row">
          <label className="rf-fld">{t('ops.detail.starts')}<input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} /></label>
          <label className="rf-fld">{t('ops.detail.ends')}<input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
        </div>
        <div className="rf-actions"><button type="button" className="rf-btn rf-btn-primary" disabled={!ready || busy} onClick={() => void duplicate()}>{busy ? t('ops.detail.duplicating') : t('ops.detail.duplicate')}</button><button type="button" className="rf-btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button></div>
      </div>
    );
  }
  return (
    <>
      <RefineSection title={t('ops.detail.copySetup')} />
      <RefineList as="div">
        <div className="rf-row ops-wrap">
          <span className="rf-grow"><span className="rf-t1">{t('ops.detail.forNextYear')}</span><span className="rf-t2">{t('ops.detail.notCopied')}</span></span>
          {!open && <button type="button" className="rf-btn" onClick={begin}>{t('ops.detail.duplicate')}</button>}
        </div>
        {form}
        {made && (
          <div className="rf-row" role="status">
            <span className="rf-grow"><span className="rf-t1">{t('ops.detail.ready', { name: made.name })}</span></span>
            <Link className="rf-btn" to={`/competitions/${made.id}`}>{t('ops.detail.openIt')}</Link>
          </div>
        )}
      </RefineList>
    </>
  );
}
