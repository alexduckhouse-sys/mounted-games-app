import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CalendarDays, ChevronDown, MapPinCheck, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { CompetitionIcon } from '../../competition/CompetitionIcon';
import { EMOJI_COMPETITION_ICONS, FLAG_COMPETITION_ICONS } from '../../competition/icons';
import { useAuth } from '../../auth/AuthContext';
import type { CompetitionDetail, CompetitionSection } from '../../types';
import { Field } from '../auth/Field';

type Format = 1 | 2 | 3;
const FORMAT_LABEL: Record<Format, string> = { 1: 'Pairs', 2: 'Teams', 3: 'Individual' };
const AGE_GROUPS = [
  'Under 10', 'Under 12', 'Under 14', 'Under 15', 'Under 17', 'Open',
  'Juniors', 'Seniors', 'Novices',
];

// Zone 2026 race lists. "(x2)" in the source means the same race runs twice
// consecutively, so we expand into two entries in the default list.
const ZONE_SENIORS = [
  'Bending',
  'Hollywood Bowl Boule & Bucket',
  'Bottle',
  'Litter',
  'Tally Ho Farm Ball & Socket',
  'STRUK Pole',
  'PGSports UK Shopping Spree',
  'Stepping Stones',
  'Spell EGUK',
  'Big Sack',
];
const ZONE_JUNIORS = [
  'Bending',
  'Hollywood Bowl Old Sock',
  'Tally Ho Farm Ball & Socket',
  'STRUK Pole (JV)',
  'PGSports UK Shopping Spree',
  'Stepping Stones',
  'Spell EGUK (JV)',
  '5 Flag',
];
const ZONE_PAIRS = [
  'Bending',
  'Hollywood Bowl Boule & Bucket',
  'Bottle',
  'Litter', 'Litter',
  'Tally Ho Farm Ball & Socket', 'Tally Ho Farm Ball & Socket',
  'STRUK Pole', 'STRUK Pole',
  'PGSports UK Shopping Spree',
  'Stepping Stones',
  'EGUK Mug Changes',
  '5 Flag', '5 Flag',
];

// Area 2026 race lists — sponsored names + dedicated junior variants. Spare
// race for ties / run-offs at area level is also "2 Flag".
const AREA_SENIORS = [
  'Bending',
  '5 Mug',
  'Old Sock',
  'Tally Ho Farm Ball & Socket',
  'PGUK Pyramid',
  'Hollywood Bowl Bottle',
  'Stepping Stones',
  'EGUK 5 Flag',
];
const AREA_JUNIORS = [
  'Bending',
  'Old Sock (junior version)',
  'Tally Ho Farm Ball & Socket',
  'PGUK Pyramid (junior version)',
  'Hollywood Bowl Bottle (junior version)',
  'Stepping Stones',
  'EGUK 5 Flag',
];
const AREA_PAIRS = [
  'Bending',
  '2 Mug',
  'Old Sock',
  'Tally Ho Farm Ball & Socket', 'Tally Ho Farm Ball & Socket',
  'PGUK Pyramid', 'PGUK Pyramid',
  'Hollywood Bowl Bottle',
  'Stepping Stones',
  'EGUK 5 Flag', 'EGUK 5 Flag',
];

const ZONE_RUNOFF = '2 Flag';
export type SectionScope = 'Zone' | 'Area';

/**
 * Pick a default race list for a section based on (scope, format, ageGroup).
 * Pairs → *_PAIRS; Teams+Juniors/Novices → *_JUNIORS; Teams+Seniors/Open/etc → *_SENIORS.
 */
function defaultRacesFor(scope: SectionScope, format: Format, ageGroup: string): string {
  const isJunior = ageGroup.toLowerCase().includes('junior') || ageGroup.toLowerCase().includes('novice');
  const lists = scope === 'Area'
    ? { pairs: AREA_PAIRS, juniors: AREA_JUNIORS, seniors: AREA_SENIORS }
    : { pairs: ZONE_PAIRS, juniors: ZONE_JUNIORS, seniors: ZONE_SENIORS };
  if (format === 1) return lists.pairs.join('\n');
  if (isJunior) return lists.juniors.join('\n');
  return lists.seniors.join('\n');
}

/** A single named session within a section, with its own race list + scope. */
interface SessionConfig {
  name: string;
  races: string;
  scope: SectionScope;
}

interface SectionDraft {
  // Carries the saved id when editing an existing section.
  existingId?: number;
  format: Format;
  ageGroup: string;
  /** 1 or more sessions; the first is created by defaultSection. KEPT for
   * backwards-compatibility with persisted drafts; the slim creation wizard
   * ignores this and lets the Finalise page configure sessions later. */
  sessions: SessionConfig[];
  minsPerHeat: number;
  maxTeamsPerHeat: number;
  runoffRaceName: string;
  usesRaceFinals: boolean;
  /** Cost in pounds (decimal). Persisted to PriceMinor as pennies. */
  priceGbp: string;
  /** Cap on active signups. Empty string = unlimited. */
  maxParticipants?: string;
  /** How many teams go through to the final. Empty string = not set. */
  finalistCount?: string;
}

interface TeamDraft {
  // Carries the saved id when editing.
  existingId?: number;
  // Index into the sections array (preferred over id so newly-added sections work).
  sectionIndex: number;
  clubId: number;
  suffix: string;
  /** Hors Concours — team competes but is excluded from scoring + standings. */
  isHorsConcours?: boolean;
}

// Slim creation: comp = basics + sections (with price + max participants).
// Teams + races + sessions + heats are configured later via the Finalise / Format
// flow once entries have come in.

interface PersistedDraft {
  icon?: string;
  /** Older drafts remember the wizard step; the page has no steps now. */
  step?: string;
  /** When the draft was last saved (ISO date and time). */
  savedAt?: string;
  name: string;
  location: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  what3Words: string;
  postcode: string;
  appleMapsUrl: string;
  lat: string;
  lon: string;
  description: string;
  organiserName?: string;
  paymentDestination?: string;
  sections: SectionDraft[];
  teams: TeamDraft[];
}

function readPersistedDraft(key: string): PersistedDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDraft;
    if (!parsed || typeof parsed.name !== 'string' || !Array.isArray(parsed.sections)) return null;
    // Migrate older drafts that stored a single race list per section
    // (sessionName + races + scope + sessionCount) into the new per-session
    // structure (sessions: SessionConfig[]).
    parsed.sections = parsed.sections.map((s: unknown) => {
      const sec = s as Record<string, unknown> & Partial<SectionDraft>;
      if (Array.isArray(sec.sessions) && sec.sessions.length > 0) return sec as SectionDraft;
      const legacyName = typeof sec.sessionName === 'string' ? sec.sessionName : 'Session 1';
      const legacyRaces = typeof sec.races === 'string' ? sec.races : '';
      const legacyScope = (sec.scope === 'Area' ? 'Area' : 'Zone') as SectionScope;
      const legacyCount = typeof sec.sessionCount === 'number' ? sec.sessionCount : 1;
      const sessions: SessionConfig[] = Array.from({ length: Math.max(1, legacyCount) }, (_, idx) => ({
        name: idx === 0 ? legacyName : `${legacyName} · Session ${idx + 1}`,
        races: legacyRaces,
        scope: legacyScope,
      }));
      return { ...(sec as SectionDraft), sessions };
    });
    return parsed;
  } catch {
    return null;
  }
}

function defaultSession(scope: SectionScope, format: Format, ageGroup: string, name: string): SessionConfig {
  return { name, races: defaultRacesFor(scope, format, ageGroup), scope };
}

function defaultSection(): SectionDraft {
  return {
    format: 2,
    ageGroup: 'Seniors',
    sessions: [defaultSession('Zone', 2, 'Seniors', 'Seniors')],
    minsPerHeat: 25,
    maxTeamsPerHeat: 6,
    runoffRaceName: ZONE_RUNOFF,
    usesRaceFinals: false,
    priceGbp: '',
  };
}

/** Parse "12.50" / "12" / "" → integer pennies. Negative values clamp to zero. */
function priceGbpToMinor(input: string): number {
  if (!input || !input.trim()) return 0;
  const n = parseFloat(input);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/** "" / "0" → null (unlimited); positive int otherwise. */
function parseMaxParticipants(input: string | undefined): number | null {
  if (!input || !input.trim()) return null;
  const n = parseInt(input, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Teams through to the final: whole number 1-50, anything else means "not set". */
function parseFinalistCount(input: string | undefined): number | null {
  if (!input || !input.trim()) return null;
  const n = parseInt(input, 10);
  return Number.isFinite(n) && n >= 1 && n <= 50 ? n : null;
}

function sectionDisplayName(s: SectionDraft): string {
  // "Teams Under 12" reads awkwardly — drop the format word for the Teams format.
  const prefix = s.format === 2 ? '' : FORMAT_LABEL[s.format];
  return `${prefix} ${s.ageGroup}`.trim();
}

interface FormErrors {
  name?: string;
  startDate?: string;
  startTime?: string;
  /** Indexes of the section rows that have no age group. */
  sections?: number[];
}

/** The state that makes up a draft, written to local storage on every change. */
function persistDraft(key: string, draft: PersistedDraft) {
  try { window.localStorage.setItem(key, JSON.stringify(draft)); } catch { /* quota */ }
}

function clockTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function CompetitionEditor() {
  const navigate = useNavigate();
  const { canOrganise } = useAuth();
  const { id } = useParams<{ id: string }>();
  const editingId = id ? parseInt(id, 10) : null;
  const isEdit = editingId != null;
  const [ownership, setOwnership] = useState<{ id: number; owner: string | null } | null>(null);
  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    api.get<CompetitionDetail>(`/competitions/${editingId}`)
      .then(({ data }) => { if (!cancelled) setOwnership({ id: editingId, owner: data.createdByUserId ?? null }); })
      .catch(() => { if (!cancelled) setOwnership({ id: editingId, owner: null }); });
    return () => { cancelled = true; };
  }, [editingId]);
  const mayOrganise = canOrganise(isEdit ? { createdByUserId: ownership?.id === editingId ? ownership.owner : null } : undefined);
  const storageKey = `competitionEditor:${isEdit ? `edit:${editingId}` : 'new'}`;

  // Pull any persisted draft once so initial useState calls can use it.
  const persisted = readPersistedDraft(storageKey);

  const [loading, setLoading] = useState(isEdit && !persisted);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  // Bumped when a save is refused, so the first field with a problem takes focus.
  const [refused, setRefused] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  // About the competition, when and where
  const [name, setName] = useState(persisted?.name ?? '');
  const [icon, setIcon] = useState(persisted?.icon ?? 'flag');
  const [location, setLocation] = useState(persisted?.location ?? '');
  const [startDate, setStartDate] = useState(
    persisted?.startDate ?? (() => new Date().toISOString().slice(0, 10))()
  );
  const [startTime, setStartTime] = useState(persisted?.startTime ?? '09:00');
  const [endDate, setEndDate] = useState(persisted?.endDate ?? '');
  const [endTime, setEndTime] = useState(persisted?.endTime ?? '17:00');
  const [what3Words, setWhat3Words] = useState(persisted?.what3Words ?? '');
  const [postcode, setPostcode] = useState(persisted?.postcode ?? '');
  // No fields on the page for these two, but they are kept and sent so saved values are not lost.
  const [appleMapsUrl, setAppleMapsUrl] = useState(persisted?.appleMapsUrl ?? '');
  const [lat, setLat] = useState(persisted?.lat ?? '');
  const [lon, setLon] = useState(persisted?.lon ?? '');
  const [description, setDescription] = useState(persisted?.description ?? '');
  const [organiserName, setOrganiserName] = useState(persisted?.organiserName ?? '');
  const [paymentDestination, setPaymentDestination] = useState(persisted?.paymentDestination ?? '');
  // The last postcode / what3words pair that was looked up, and how that went.
  const [geo, setGeo] = useState<{ key: string; status: 'ok' | 'none' | 'failed' } | null>(null);

  // Sections
  const [sections, setSections] = useState<SectionDraft[]>(
    persisted?.sections && persisted.sections.length > 0 ? persisted.sections : [defaultSection()]
  );
  // In edit mode, track which previously-existing section ids the admin
  // deleted so we can DELETE them on submit.
  const [removedSectionIds, setRemovedSectionIds] = useState<number[]>([]);

  // Autosave the page's full state so a reload (or accidental navigation away)
  // doesn't wipe everything. We persist on every change and clear on submit.
  const [savedAt, setSavedAt] = useState<string | null>(persisted?.savedAt ?? null);
  const firstSave = useRef(true);
  useEffect(() => {
    // The first run only restores what was there; the time changes once something does.
    const stamp = firstSave.current ? persisted?.savedAt : new Date().toISOString();
    firstSave.current = false;
    persistDraft(storageKey, {
      name, location, icon,
      startDate, startTime, endDate, endTime,
      what3Words, postcode, appleMapsUrl, lat, lon,
      description,
      organiserName, paymentDestination,
      sections,
      teams: [],
      savedAt: stamp,
    });
    if (stamp) setSavedAt(stamp);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `persisted` is only read on the first run.
  }, [storageKey, name, location, icon, startDate, startTime, endDate, endTime,
      what3Words, postcode, appleMapsUrl, lat, lon, description,
      organiserName, paymentDestination, sections]);

  useEffect(() => {
    // Skip the server fetch on edit if we already have a local draft — the user
    // hasn't finished editing yet and we don't want to clobber their changes.
    if (!isEdit || !editingId || persisted) return;
    api.get<CompetitionDetail>(`/competitions/${editingId}`)
      .then((r) => {
        const c = r.data;
        setName(c.name);
        setIcon(c.icon ?? 'flag');
        setLocation(c.location ?? '');
        const start = new Date(c.startDate);
        setStartDate(start.toISOString().slice(0, 10));
        setStartTime(start.toTimeString().slice(0, 5));
        const end = c.endDate ? new Date(c.endDate) : null;
        setEndDate(end ? end.toISOString().slice(0, 10) : '');
        if (end) setEndTime(end.toTimeString().slice(0, 5));
        setWhat3Words(c.what3Words ?? '');
        setAppleMapsUrl(c.appleMapsUrl ?? '');
        setLat(c.latitude != null ? String(c.latitude) : '');
        setLon(c.longitude != null ? String(c.longitude) : '');
        setDescription(c.description ?? '');
        setOrganiserName(c.organiserName ?? '');
        setPaymentDestination(c.paymentDestination ?? '');
        setSections(c.sections.length > 0 ? c.sections.map((s) => existingToDraft(s, c)) : [defaultSection()]);
      })
      .catch(() => setError('Could not load competition.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `persisted` is captured once per render and used only as a one-shot guard.
  }, [isEdit, editingId]);

  useEffect(() => {
    if (refused > 0) pageRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [refused]);

  function validate(): FormErrors {
    const found: FormErrors = {};
    if (!name.trim()) found.name = 'Enter a name.';
    if (!startDate) found.startDate = 'Choose a start date.';
    if (!startTime) found.startTime = 'Choose a start time.';
    const missing = sections.flatMap((s, i) => (s.ageGroup.trim() ? [] : [i]));
    if (missing.length > 0) found.sections = missing;
    return found;
  }

  function saveDraft() {
    const stamp = new Date().toISOString();
    persistDraft(storageKey, {
      name, location, icon,
      startDate, startTime, endDate, endTime,
      what3Words, postcode, appleMapsUrl, lat, lon,
      description,
      organiserName, paymentDestination,
      sections,
      teams: [],
      savedAt: stamp,
    });
    setSavedAt(stamp);
  }

  function discardDraft() {
    if (!confirm('Discard this saved draft and start over?')) return;
    try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
    window.location.reload();
  }

  /** Looks the postcode / what3words up when the person leaves the field. */
  async function lookUp() {
    const key = `${postcode.trim()}|${what3Words.trim()}`;
    if (key === '|' || (geo?.key === key && geo.status === 'ok')) return;
    try {
      const { data } = await api.get<{ latitude: number | null; longitude: number | null; source: string | null }>(
        '/geocode',
        { params: { postcode: postcode.trim() || undefined, w3w: what3Words.trim() || undefined } }
      );
      if (data.latitude != null && data.longitude != null) {
        setLat(String(data.latitude));
        setLon(String(data.longitude));
        setGeo({ key, status: 'ok' });
      } else {
        setGeo({ key, status: 'none' });
      }
    } catch {
      setGeo({ key, status: 'failed' });
    }
  }
  const geoKey = `${postcode.trim()}|${what3Words.trim()}`;
  const geoNow = geo?.key === geoKey ? geo.status : null;

  function updateSection(i: number, patch: Partial<SectionDraft>) {
    setSections((cur) => cur.map((s, idx) => {
      if (idx !== i) return s;
      const merged: SectionDraft = { ...s, ...patch };
      // If the section's format or age group changes, refresh every session's
      // race list IF that session's list is still the default for the old keys.
      if (patch.format !== undefined || patch.ageGroup !== undefined) {
        merged.sessions = merged.sessions.map((sess) => {
          if (sess.races !== defaultRacesFor(sess.scope, s.format, s.ageGroup)) return sess;
          return { ...sess, races: defaultRacesFor(sess.scope, merged.format, merged.ageGroup) };
        });
      }
      // Auto-rename the first session if it's still the auto-name.
      const oldAuto = sectionDisplayName(s);
      const newAuto = sectionDisplayName(merged);
      if (merged.sessions[0] && (merged.sessions[0].name === oldAuto || merged.sessions[0].name.trim().length === 0)) {
        merged.sessions = [{ ...merged.sessions[0], name: newAuto }, ...merged.sessions.slice(1)];
      }
      // Race-finals always uses one session per section.
      if (merged.usesRaceFinals && merged.sessions.length > 1) {
        merged.sessions = [merged.sessions[0]];
      }
      return merged;
    }));
    if (patch.ageGroup !== undefined) setErrors((cur) => ({ ...cur, sections: cur.sections?.filter((n) => n !== i) }));
  }

  function addSection() {
    setSections((cur) => [...cur, defaultSection()]);
  }
  function removeSection(i: number) {
    setErrors((cur) => ({ ...cur, sections: undefined }));
    setSections((cur) => {
      const removed = cur[i];
      if (removed?.existingId) setRemovedSectionIds((ids) => [...ids, removed.existingId!]);
      return cur.filter((_, idx) => idx !== i);
    });
  }

  async function submitCreate() {
    setBusy(true);
    setError(null);
    try {
      // Slim creation: comp + sections (with price + max participants). Teams,
      // sessions, heats and race lists are all configured later via Format /
      // Finalise — keeps the public comp page open for entries quickly.
      setProgress('Creating competition…');
      const created = await api.post<{ id: number }>('/competitions', basicsPayload());
      const compId = created.data.id;

      setProgress('Adding sections…');
      for (const s of sections) {
        await api.post(`/competitions/${compId}/sections`, {
          format: s.format,
          ageGroup: s.ageGroup.trim(),
          displayName: sectionDisplayName(s),
          runoffRaceName: null,
          usesRaceFinals: false,
          priceMinor: priceGbpToMinor(s.priceGbp),
          maxParticipants: parseMaxParticipants(s.maxParticipants),
          finalistCount: parseFinalistCount(s.finalistCount),
        });
      }

      try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
      navigate(`/competitions/${compId}`);
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } | string } }).response?.data;
      setError(typeof msg === 'string' ? msg : msg?.message ?? 'Could not create competition.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  /**
   * Edit-mode submit: PUTs basics, applies section adds/deletes, syncs
   * price + maxParticipants on existing sections. Races + sessions + heats
   * are owned by the Finalise/Format page now — we don't touch them here.
   */
  async function submitEditAll() {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      setProgress('Saving basics…');
      await api.put(`/competitions/${editingId}`, {
        ...basicsPayload(),
        isActive: true,
        isArchived: false,
      });

      if (removedSectionIds.length > 0) {
        setProgress(`Removing ${removedSectionIds.length} section${removedSectionIds.length === 1 ? '' : 's'}…`);
        for (const id of removedSectionIds) {
          await api.delete(`/competitions/${editingId}/sections/${id}`).catch(() => {});
        }
      }

      setProgress('Saving sections…');
      for (const s of sections) {
        if (s.existingId) {
          await api.put(`/competitions/${editingId}/sections/${s.existingId}`, {
            runoffRaceName: s.runoffRaceName?.trim() || null,
            usesRaceFinals: s.usesRaceFinals ?? false,
            priceMinor: priceGbpToMinor(s.priceGbp),
            maxParticipants: parseMaxParticipants(s.maxParticipants),
            finalistCount: parseFinalistCount(s.finalistCount),
          }).catch(() => {});
        } else {
          await api.post(`/competitions/${editingId}/sections`, {
            format: s.format,
            ageGroup: s.ageGroup.trim(),
            displayName: sectionDisplayName(s),
            runoffRaceName: null,
            usesRaceFinals: false,
            priceMinor: priceGbpToMinor(s.priceGbp),
            maxParticipants: parseMaxParticipants(s.maxParticipants),
            finalistCount: parseFinalistCount(s.finalistCount),
          });
        }
      }

      try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
      navigate(`/competitions/${editingId}`);
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } | string } }).response?.data;
      setError(typeof msg === 'string' ? msg : msg?.message ?? 'Could not save changes.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function publish() {
    const found = validate();
    setErrors(found);
    if (found.name || found.startDate || found.startTime || found.sections) {
      setRefused((n) => n + 1);
      return;
    }
    if (isEdit) void submitEditAll(); else void submitCreate();
  }

  function combinedStartIso(): string {
    return new Date(`${startDate}T${startTime}`).toISOString();
  }

  function basicsPayload() {
    return {
      name: name.trim(),
      icon,
      location: location.trim() || null,
      description: description.trim() || null,
      latitude: lat ? parseFloat(lat) : null,
      longitude: lon ? parseFloat(lon) : null,
      what3Words: what3Words.trim() || null,
      postcode: postcode.trim() || null,
      appleMapsUrl: appleMapsUrl.trim() || null,
      organiserName: organiserName.trim() || null,
      paymentDestination: paymentDestination.trim() || null,
      startDate: combinedStartIso(),
      endDate: endDate || endTime
        ? new Date(`${endDate || startDate}T${endTime || '17:00'}`).toISOString()
        : null,
    };
  }

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  }

  const fieldClass = 'mg-field !rounded-lg';
  const savedText = savedAt && clockTime(savedAt) ? `Draft saved ${clockTime(savedAt)}` : '';

  return (
    <div ref={pageRef} className="skin mx-auto flex w-full max-w-[880px] flex-col gap-9 pb-36 pt-6 sm:pt-10">
      <h1 className="mg-display text-[44px] font-bold leading-none text-[rgb(var(--mg-heading))]">{isEdit ? 'Edit competition' : 'New competition'}</h1>

      <section aria-labelledby="ce-about" className="flex flex-col gap-[18px]">
        <PartHead n={1} id="ce-about" title="About the competition" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Field label="Name" error={errors.name}>
            {({ id: fieldId, invalid, describedBy }) => (
              <div className={fieldClass} data-invalid={invalid}>
                <input id={fieldId} value={name} aria-invalid={invalid} aria-describedby={describedBy} autoComplete="off"
                  onChange={(e) => { setName(e.target.value); setErrors((cur) => ({ ...cur, name: undefined })); }} />
              </div>
            )}
          </Field>
          <Field label="Icon">
            {({ id: fieldId }) => (
              <div className={`${fieldClass} relative`}>
                <span className="text-lg text-[rgb(var(--mg-heading))]" data-testid="competition-icon-preview"><CompetitionIcon id={icon} /></span>
                <select id={fieldId} value={icon} onChange={(e) => setIcon(e.target.value)} className="appearance-none pr-6 font-medium">
                  {EMOJI_COMPETITION_ICONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  <optgroup label="Flags">
                    {FLAG_COMPETITION_ICONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </optgroup>
                </select>
                <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 h-4 w-4 text-[rgb(var(--mg-heading))]" />
              </div>
            )}
          </Field>
        </div>
        <Field label="Organiser">
          {({ id: fieldId }) => (
            <div className={fieldClass}><input id={fieldId} value={organiserName} autoComplete="off" onChange={(e) => setOrganiserName(e.target.value)} /></div>
          )}
        </Field>
      </section>

      <section aria-labelledby="ce-when" className="flex flex-col gap-[18px]">
        <PartHead n={2} id="ce-when" title="When" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
          <Field label="Starts" error={errors.startDate}>
            {({ id: fieldId, invalid, describedBy }) => (
              <div className={fieldClass} data-invalid={invalid}>
                <CalendarDays aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[rgb(var(--mg-heading))]" />
                <input id={fieldId} type="date" value={startDate} aria-invalid={invalid} aria-describedby={describedBy}
                  onChange={(e) => { setStartDate(e.target.value); setErrors((cur) => ({ ...cur, startDate: undefined })); }} />
              </div>
            )}
          </Field>
          <Field label="at" error={errors.startTime}>
            {({ id: fieldId, invalid, describedBy }) => (
              <div className={fieldClass} data-invalid={invalid}>
                <input id={fieldId} type="time" value={startTime} aria-label="Start time" aria-invalid={invalid} aria-describedby={describedBy}
                  onChange={(e) => { setStartTime(e.target.value); setErrors((cur) => ({ ...cur, startTime: undefined })); }} />
              </div>
            )}
          </Field>
          <Field label="Ends">
            {({ id: fieldId }) => (
              <div className={`${fieldClass} relative`}>
                <CalendarDays aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[rgb(var(--mg-heading))]" />
                <input id={fieldId} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  className={`peer ${endDate ? '' : '[&::-webkit-datetime-edit]:opacity-0 focus:[&::-webkit-datetime-edit]:opacity-100'}`} />
                {!endDate && <span aria-hidden="true" className="pointer-events-none absolute left-[42px] text-base text-[rgb(var(--mg-faint))] peer-focus:hidden">Same day</span>}
              </div>
            )}
          </Field>
          <Field label="at">
            {({ id: fieldId }) => (
              <div className={fieldClass}><input id={fieldId} type="time" value={endTime} aria-label="End time" onChange={(e) => setEndTime(e.target.value)} /></div>
            )}
          </Field>
        </div>
      </section>

      <section aria-labelledby="ce-where" className="flex flex-col gap-[18px]">
        <PartHead n={3} id="ce-where" title="Where" />
        <Field label="Venue">
          {({ id: fieldId }) => (
            <div className={fieldClass}><input id={fieldId} value={location} autoComplete="off" onChange={(e) => setLocation(e.target.value)} /></div>
          )}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Postcode" error={geoNow === 'none' ? 'No location found for that.' : geoNow === 'failed' ? 'Could not look that up.' : null}>
            {({ id: fieldId, invalid, describedBy }) => (
              <div className={fieldClass} data-invalid={invalid}>
                <input id={fieldId} value={postcode} autoComplete="postal-code" aria-invalid={invalid} aria-describedby={describedBy}
                  className="uppercase" onChange={(e) => setPostcode(e.target.value)} onBlur={lookUp} />
                {geoNow === 'ok' && <MapPinCheck aria-label="Location found" role="img" className="h-[18px] w-[18px] shrink-0 text-[rgb(var(--mg-heading))]" />}
              </div>
            )}
          </Field>
          <Field label={<>what3words <span className="font-normal text-[rgb(var(--mg-muted))]">(optional)</span></>}>
            {({ id: fieldId }) => (
              <div className={fieldClass}>
                <input id={fieldId} value={what3Words} placeholder="///filled.count.soap" autoComplete="off"
                  onChange={(e) => setWhat3Words(e.target.value)} onBlur={lookUp} />
              </div>
            )}
          </Field>
        </div>
      </section>

      <section aria-labelledby="ce-enter" className="flex flex-col gap-[18px]">
        <PartHead n={4} id="ce-enter" title="What people can enter" />
        <div className="mg-card overflow-hidden">
          <div aria-hidden="true" className="hidden gap-3 border-b border-[rgb(var(--mg-rule))] px-4 py-3 text-xs font-semibold uppercase tracking-[0.06em] text-[rgb(var(--mg-muted))] sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_96px_96px_44px]">
            <span>Format</span><span>Age group</span><span>Price</span><span>Max</span><span />
          </div>
          {sections.map((s, i) => {
            const ageGroups = AGE_GROUPS.includes(s.ageGroup) || !s.ageGroup ? AGE_GROUPS : [s.ageGroup, ...AGE_GROUPS];
            const problem = errors.sections?.includes(i);
            // Format and age group are fixed once a section is saved: only price, cap and removal can change.
            const fixed = s.existingId != null;
            return (
              <div key={i} role="group" aria-label={`Section ${i + 1}`} className="grid grid-cols-2 items-end gap-3 border-b border-[rgb(var(--mg-rule-soft))] px-4 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_96px_96px_44px] sm:items-center">
                <RowCell label="Format">
                  <SelectCell label="Format" value={s.format} disabled={fixed} onChange={(v) => updateSection(i, { format: parseInt(v, 10) as Format })}>
                    {Object.entries(FORMAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </SelectCell>
                </RowCell>
                <RowCell label="Age group">
                  <SelectCell label="Age group" value={s.ageGroup} disabled={fixed} invalid={problem} onChange={(v) => updateSection(i, { ageGroup: v })}>
                    {!s.ageGroup && <option value="" disabled>Choose</option>}
                    {ageGroups.map((a) => <option key={a} value={a}>{a}</option>)}
                  </SelectCell>
                </RowCell>
                <RowCell label="Price">
                  <div className="mg-field !min-h-11 !rounded-lg">
                    <span aria-hidden="true" className="text-base font-medium text-[rgb(var(--mg-ink))]">£</span>
                    <input type="number" min={0} step={0.5} inputMode="decimal" aria-label="Price" placeholder="0" value={s.priceGbp}
                      onChange={(e) => updateSection(i, { priceGbp: e.target.value })} />
                  </div>
                </RowCell>
                <RowCell label="Max">
                  <div className="mg-field !min-h-11 !rounded-lg">
                    <input type="number" min={0} inputMode="numeric" aria-label="Max" placeholder="No cap" value={s.maxParticipants ?? ''}
                      onChange={(e) => updateSection(i, { maxParticipants: e.target.value })} />
                  </div>
                </RowCell>
                <div className="col-span-2 flex justify-end sm:col-span-1">
                  <button type="button" onClick={() => removeSection(i)} disabled={sections.length < 2} aria-label={`Remove section ${i + 1}`}
                    className="flex h-11 w-11 items-center justify-center rounded-lg text-[rgb(var(--mg-muted))] hover:bg-[rgb(var(--mg-subtle))] disabled:cursor-not-allowed disabled:opacity-40">
                    <Trash2 aria-hidden="true" className="h-[18px] w-[18px]" />
                  </button>
                </div>
                {problem && <p role="alert" className="col-span-2 text-sm font-medium text-[rgb(var(--mg-elim))] sm:col-span-5">Choose an age group.</p>}
              </div>
            );
          })}
          <button type="button" onClick={addSection} className="flex min-h-[52px] w-full items-center gap-2 px-4 text-base font-semibold text-[rgb(var(--mg-heading))] hover:bg-[rgb(var(--mg-subtle))]">
            <Plus aria-hidden="true" className="h-[18px] w-[18px]" />Add a section
          </button>
        </div>
      </section>

      <section aria-labelledby="ce-notes" className="flex flex-col gap-[18px]">
        <PartHead n={5} id="ce-notes" title="Payment and notes" />
        <Field label={<>Where entry fees go <span className="font-normal text-[rgb(var(--mg-muted))]">(optional)</span></>}>
          {({ id: fieldId }) => (
            <div className={fieldClass}>
              <input id={fieldId} value={paymentDestination} placeholder="Bank details or PayPal" autoComplete="off" onChange={(e) => setPaymentDestination(e.target.value)} />
            </div>
          )}
        </Field>
        <Field label={<>Notes for riders <span className="font-normal text-[rgb(var(--mg-muted))]">(optional)</span></>}>
          {({ id: fieldId }) => (
            <div className={`${fieldClass} !items-start`}>
              <textarea id={fieldId} rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
                className="min-h-[92px] w-full min-w-0 flex-1 resize-y border-0 bg-transparent py-3 font-[inherit] text-base text-[rgb(var(--mg-ink))] outline-none" />
            </div>
          )}
        </Field>
      </section>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))]">
        <div className="mx-auto max-w-5xl px-3 sm:px-4">
        <div className="mx-auto flex max-w-[880px] flex-wrap items-center gap-3 py-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm font-medium text-[rgb(var(--mg-muted))]">
            {!mayOrganise
              ? <span>Only admins and trainers can save changes.</span>
              : savedText && (
                <span>
                  {savedText}
                  {' '}
                  <button type="button" onClick={discardDraft} className="underline">Discard draft</button>
                </span>
              )}
            {error && <span role="alert" className="text-[rgb(var(--mg-elim))]">{error}</span>}
          </div>
          <button type="button" onClick={saveDraft} className="mg-btn mg-btn-secondary !min-h-12">Save draft</button>
          <button type="button" onClick={publish} disabled={busy || !mayOrganise} className="mg-btn mg-btn-primary !min-h-12">
            {busy ? (progress ?? 'Saving…') : isEdit ? 'Save changes' : 'Publish and open entries'}
          </button>
        </div>
        </div>
      </footer>
    </div>
  );
}

/** A numbered part of the page with its rule: Barlow Condensed capitals over a 2px line. */
function PartHead({ n, id, title }: { n: number; id: string; title: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b-2 border-[rgb(var(--mg-heading))] pb-2">
      <span aria-hidden="true" className="mg-display text-[15px] font-bold text-[rgb(var(--mg-muted))]">{n}</span>
      <h2 id={id} className="mg-display text-[22px] font-bold uppercase leading-none tracking-[0.03em] text-[rgb(var(--mg-heading))]">{title}</h2>
    </div>
  );
}

/** On a phone the column heading is not there, so each cell names itself. */
function RowCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span aria-hidden="true" className="text-xs font-semibold uppercase tracking-[0.06em] text-[rgb(var(--mg-muted))] sm:hidden">{label}</span>
      {children}
    </div>
  );
}

function SelectCell({ label, value, onChange, disabled, invalid, children }: {
  label: string; value: string | number; onChange: (value: string) => void; disabled?: boolean; invalid?: boolean; children: ReactNode;
}) {
  return (
    <div className="mg-field relative !min-h-11 !rounded-lg" data-invalid={!!invalid}>
      <select aria-label={label} aria-invalid={invalid} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
        className="appearance-none truncate pr-6 font-medium disabled:opacity-100">
        {children}
      </select>
      <ChevronDown aria-hidden="true" className={`pointer-events-none absolute right-3 h-4 w-4 text-[rgb(var(--mg-muted))] ${disabled ? 'opacity-40' : ''}`} />
    </div>
  );
}

function existingToDraft(s: CompetitionSection, c: CompetitionDetail): SectionDraft {
  // Map every existing session of this section to a SessionConfig with its
  // own race list (taken from the first heat in that session).
  const sectionSessions = c.sessions.filter((x) => x.competitionSectionId === s.id && x.kind === 0);
  const sortedSessions = sectionSessions.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const sessions: SessionConfig[] = sortedSessions.map((sess) => ({
    name: sess.name,
    races: sess.heats[0]?.races.map((r) => r.name).join('\n')
      ?? defaultRacesFor('Zone', s.format as Format, s.ageGroup),
    scope: 'Zone',
  }));
  if (sessions.length === 0) {
    sessions.push(defaultSession('Zone', s.format as Format, s.ageGroup, s.displayName));
  }

  const first = sortedSessions[0];
  const teamCount = c.teams.filter((t) => t.competitionSectionId === s.id).length;
  const maxLanes = first?.lanesPerHeat ?? Math.max(2, Math.min(6, teamCount));
  const minsPerHeat = first?.minutesPerHeat ?? 25;
  return {
    existingId: s.id,
    format: s.format as Format,
    ageGroup: s.ageGroup,
    sessions,
    minsPerHeat,
    maxTeamsPerHeat: maxLanes,
    runoffRaceName: s.runoffRaceName ?? ZONE_RUNOFF,
    usesRaceFinals: s.usesRaceFinals ?? false,
    priceGbp: s.priceMinor ? (s.priceMinor / 100).toFixed(2) : '',
    maxParticipants: s.maxParticipants != null ? String(s.maxParticipants) : '',
    finalistCount: s.finalistCount ? String(s.finalistCount) : '',
  };
}
