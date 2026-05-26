import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Check, Trophy, MapPin, CalendarDays, Layers,
  Trash2, Sparkles, Clock,
} from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import type { CompetitionDetail, CompetitionSection } from '../../types';

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

// Area 2026 race lists â€” sponsored names + dedicated junior variants. Spare
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
 * Pairs â†’ *_PAIRS; Teams+Juniors/Novices â†’ *_JUNIORS; Teams+Seniors/Open/etc â†’ *_SENIORS.
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
}

interface TeamDraft {
  // Carries the saved id when editing.
  existingId?: number;
  // Index into the sections array (preferred over id so newly-added sections work).
  sectionIndex: number;
  clubId: number;
  suffix: string;
  /** Hors Concours â€” team competes but is excluded from scoring + standings. */
  isHorsConcours?: boolean;
}

// Slim creation wizard: comp = basics + sections (with price + max participants).
// Teams + races + sessions + heats are configured later via the Finalise / Format
// flow once entries have come in.
const STEPS = ['Basics', 'Sections', 'Review'] as const;
type Step = typeof STEPS[number];

interface PersistedDraft {
  step: Step;
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
        name: idx === 0 ? legacyName : `${legacyName} Â· Session ${idx + 1}`,
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

/** Parse "12.50" / "12" / "" â†’ integer pennies. Negative values clamp to zero. */
function priceGbpToMinor(input: string): number {
  if (!input || !input.trim()) return 0;
  const n = parseFloat(input);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/** "" / "0" â†’ null (unlimited); positive int otherwise. */
function parseMaxParticipants(input: string | undefined): number | null {
  if (!input || !input.trim()) return null;
  const n = parseInt(input, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function sectionDisplayName(s: SectionDraft): string {
  // "Teams Under 12" reads awkwardly â€” drop the format word for the Teams format.
  const prefix = s.format === 2 ? '' : FORMAT_LABEL[s.format];
  return `${prefix} ${s.ageGroup}`.trim();
}

export function CompetitionEditor() {
  const navigate = useNavigate();
  const { canOrganise } = useAuth();
  const { id } = useParams<{ id: string }>();
  const editingId = id ? parseInt(id, 10) : null;
  const isEdit = editingId != null;
  const storageKey = `competitionEditor:${isEdit ? `edit:${editingId}` : 'new'}`;

  // Pull any persisted draft once so initial useState calls can use it.
  const persisted = readPersistedDraft(storageKey);

  const [step, setStep] = useState<Step>(persisted?.step ?? 'Basics');
  const [loading, setLoading] = useState(isEdit && !persisted);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  // Basics
  const [name, setName] = useState(persisted?.name ?? '');
  const [location, setLocation] = useState(persisted?.location ?? '');
  const [startDate, setStartDate] = useState(
    persisted?.startDate ?? (() => new Date().toISOString().slice(0, 10))()
  );
  const [startTime, setStartTime] = useState(persisted?.startTime ?? '09:00');
  const [endDate, setEndDate] = useState(persisted?.endDate ?? '');
  const [endTime, setEndTime] = useState(persisted?.endTime ?? '17:00');
  const [what3Words, setWhat3Words] = useState(persisted?.what3Words ?? '');
  const [postcode, setPostcode] = useState(persisted?.postcode ?? '');
  const [appleMapsUrl, setAppleMapsUrl] = useState(persisted?.appleMapsUrl ?? '');
  const [lat, setLat] = useState(persisted?.lat ?? '');
  const [lon, setLon] = useState(persisted?.lon ?? '');
  const [description, setDescription] = useState(persisted?.description ?? '');
  const [organiserName, setOrganiserName] = useState(persisted?.organiserName ?? '');
  const [paymentDestination, setPaymentDestination] = useState(persisted?.paymentDestination ?? '');

  // Sections + races
  const [sections, setSections] = useState<SectionDraft[]>(
    persisted?.sections && persisted.sections.length > 0 ? persisted.sections : [defaultSection()]
  );
  // In edit mode, track which previously-existing section ids the admin
  // deleted so we can DELETE them on submit.
  const [removedSectionIds, setRemovedSectionIds] = useState<number[]>([]);

  // Autosave the wizard's full state so a reload (or accidental navigation away)
  // doesn't wipe everything. We persist on every change and clear on submit.
  useEffect(() => {
    const draft: PersistedDraft = {
      step,
      name, location,
      startDate, startTime, endDate, endTime,
      what3Words, postcode, appleMapsUrl, lat, lon,
      description,
      organiserName, paymentDestination,
      sections,
      teams: [],
    };
    try { window.localStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* quota */ }
  }, [storageKey, step, name, location, startDate, startTime, endDate, endTime,
      what3Words, postcode, appleMapsUrl, lat, lon, description,
      organiserName, paymentDestination, sections]);

  useEffect(() => {
    // Skip the server fetch on edit if we already have a local draft â€” the user
    // hasn't finished editing yet and we don't want to clobber their changes.
    if (!isEdit || !editingId || persisted) return;
    api.get<CompetitionDetail>(`/competitions/${editingId}`)
      .then((r) => {
        const c = r.data;
        setName(c.name);
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
        setSections(c.sections.length > 0 ? c.sections.map((s) => existingToDraft(s, c)) : [defaultSection()]);
      })
      .catch(() => setError('Could not load competition.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `persisted` is captured once per render and used only as a one-shot guard.
  }, [isEdit, editingId]);

  const stepIndex = STEPS.indexOf(step);
  const basicsValid = name.trim().length > 0 && startDate.length > 0 && startTime.length > 0;
  const sectionsValid = sections.length > 0 && sections.every((s) => s.ageGroup.trim().length > 0);

  function next() {
    setError(null);
    if (step === 'Basics' && !basicsValid) { setError('Name, start date and start time are required.'); return; }
    if (step === 'Sections' && !sectionsValid) {
      setError('Each section needs an age group.');
      return;
    }
    const i = STEPS.indexOf(step);
    if (i < STEPS.length - 1) setStep(STEPS[i + 1]);
  }
  function back() {
    const i = STEPS.indexOf(step);
    if (i > 0) setStep(STEPS[i - 1]);
  }

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
  }

  function addSection() {
    setSections((cur) => [...cur, defaultSection()]);
  }
  function removeSection(i: number) {
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
      // Finalise â€” keeps the public comp page open for entries quickly.
      setProgress('Creating competitionâ€¦');
      const created = await api.post<{ id: number }>('/competitions', basicsPayload());
      const compId = created.data.id;

      setProgress('Adding sectionsâ€¦');
      for (const s of sections) {
        await api.post(`/competitions/${compId}/sections`, {
          format: s.format,
          ageGroup: s.ageGroup.trim(),
          displayName: sectionDisplayName(s),
          runoffRaceName: null,
          usesRaceFinals: false,
          priceMinor: priceGbpToMinor(s.priceGbp),
          maxParticipants: parseMaxParticipants(s.maxParticipants),
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

  async function submitEditBasics() {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/competitions/${editingId}`, {
        ...basicsPayload(),
        isActive: true,
        isArchived: false,
      });
      try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
      navigate('/admin');
    } catch {
      setError('Could not save changes.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Edit-mode submit: PUTs basics, applies section adds/deletes, syncs
   * price + maxParticipants on existing sections. Races + sessions + heats
   * are owned by the Finalise/Format page now â€” we don't touch them here.
   */
  async function submitEditAll() {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      setProgress('Saving basicsâ€¦');
      await api.put(`/competitions/${editingId}`, {
        ...basicsPayload(),
        isActive: true,
        isArchived: false,
      });

      if (removedSectionIds.length > 0) {
        setProgress(`Removing ${removedSectionIds.length} section${removedSectionIds.length === 1 ? '' : 's'}â€¦`);
        for (const id of removedSectionIds) {
          await api.delete(`/competitions/${editingId}/sections/${id}`).catch(() => {});
        }
      }

      setProgress('Saving sectionsâ€¦');
      for (const s of sections) {
        if (s.existingId) {
          await api.put(`/competitions/${editingId}/sections/${s.existingId}`, {
            runoffRaceName: s.runoffRaceName?.trim() || null,
            usesRaceFinals: s.usesRaceFinals ?? false,
            priceMinor: priceGbpToMinor(s.priceGbp),
            maxParticipants: parseMaxParticipants(s.maxParticipants),
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

  function combinedStartIso(): string {
    return new Date(`${startDate}T${startTime}`).toISOString();
  }

  function basicsPayload() {
    return {
      name: name.trim(),
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
    return <div className="p-6 text-sm text-slate-500">Loadingâ€¦</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Link to="/admin" className="btn-ghost !py-1.5 !px-2.5 text-sm">
          <ChevronLeft className="w-4 h-4" /> Admin
        </Link>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          {isEdit ? <Sparkles className="w-6 h-6 text-brand-600" /> : <Trophy className="w-6 h-6 text-brand-600" />}
          {isEdit ? 'Edit competition' : 'Create competition'}
        </h1>
        <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
          <span className="hidden sm:inline">Draft auto-saved Â· survives reload</span>
          <button
            type="button"
            onClick={() => {
              if (!confirm('Discard this saved draft and start over?')) return;
              try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
              window.location.reload();
            }}
            className="btn-ghost !py-0.5 !px-1.5 text-[11px]"
            title="Wipe the locally-saved wizard state and reset"
          >
            Discard draft
          </button>
        </span>
      </div>

      <StepStrip current={stepIndex} onJump={isEdit ? (i) => setStep(STEPS[i]) : undefined} />

      <div className="card p-4 sm:p-5 space-y-3">
        {step === 'Basics' && (
          <BasicsStep
            name={name} setName={setName}
            location={location} setLocation={setLocation}
            startDate={startDate} setStartDate={setStartDate}
            startTime={startTime} setStartTime={setStartTime}
            endDate={endDate} setEndDate={setEndDate}
            endTime={endTime} setEndTime={setEndTime}
            postcode={postcode} setPostcode={setPostcode}
            what3Words={what3Words} setWhat3Words={setWhat3Words}
            appleMapsUrl={appleMapsUrl} setAppleMapsUrl={setAppleMapsUrl}
            lat={lat} setLat={setLat} lon={lon} setLon={setLon}
            description={description} setDescription={setDescription}
            organiserName={organiserName} setOrganiserName={setOrganiserName}
            paymentDestination={paymentDestination} setPaymentDestination={setPaymentDestination}
          />
        )}
        {step === 'Sections' && (
          <SectionsStep
            sections={sections}
            onAdd={addSection}
            onRemove={removeSection}
            onUpdate={updateSection}
          />
        )}
        {step === 'Review' && (
          <ReviewStep
            name={name} location={location} startDate={startDate} startTime={startTime}
            endDate={endDate} endTime={endTime}
            sections={sections}
          />
        )}

        {error && (
          <div className="text-sm text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/30 p-2 rounded-md">{error}</div>
        )}
      </div>

      <div className="card p-3 flex items-center gap-2">
        <Link to="/admin" className="btn-ghost !py-1.5 !px-3 text-sm">Cancel</Link>
        {stepIndex > 0 && (
          <button onClick={back} className="btn-ghost !py-1.5 !px-3 text-sm">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
        )}
        <div className="ml-auto" />
        {isEdit && step === 'Basics' && canOrganise() && (
          <button onClick={submitEditBasics} disabled={busy} className="btn-primary !py-1.5 !px-3 text-sm">
            <Check className="w-4 h-4" /> {busy ? 'Savingâ€¦' : 'Save basics'}
          </button>
        )}
        {step !== 'Review' ? (
          <button onClick={next} className="btn-primary !py-1.5 !px-3 text-sm">
            Next <ChevronRight className="w-4 h-4" />
          </button>
        ) : isEdit ? (
          canOrganise() ? (
            <button onClick={submitEditAll} disabled={busy} className="btn-primary !py-2 !px-4 text-sm">
              <Check className="w-4 h-4" /> {busy ? (progress ?? 'Savingâ€¦') : 'Save all changes'}
            </button>
          ) : (
            <span className="text-xs text-slate-500 italic">
              View only â€” flip to <span className="font-semibold">Edit mode</span> in the header to save changes.
            </span>
          )
        ) : canOrganise() ? (
          <button onClick={submitCreate} disabled={busy} className="btn-primary !py-2 !px-4 text-sm">
            <Check className="w-4 h-4" /> {busy ? (progress ?? 'Creatingâ€¦') : 'Create competition'}
          </button>
        ) : (
          <span className="text-xs text-slate-500 italic">
            View only â€” flip to <span className="font-semibold">Edit mode</span> in the header to create.
          </span>
        )}
      </div>
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
  };
}

function StepStrip({ current, onJump }: { current: number; onJump?: (i: number) => void }) {
  return (
    <div className="card p-2 flex items-center gap-1 overflow-x-auto">
      {STEPS.map((label, i) => {
        const active = i === current;
        const done = i < current;
        const clickable = onJump != null;
        const Btn = clickable ? 'button' : 'div';
        return (
          <Btn
            key={label}
            onClick={clickable ? () => onJump!(i) : undefined}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md shrink-0 ${
              clickable ? 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800' : ''
            }`}
          >
            <span
              className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                active ? 'bg-brand-600 text-white'
                  : done ? 'bg-emerald-500 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
              }`}
            >
              {done ? <Check className="w-3 h-3" /> : i + 1}
            </span>
            <span className={`text-xs ${active ? 'font-semibold text-brand-700 dark:text-brand-200' : 'text-slate-500'}`}>
              {label}
            </span>
            {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-slate-300" />}
          </Btn>
        );
      })}
    </div>
  );
}

interface BasicsProps {
  name: string; setName: (s: string) => void;
  location: string; setLocation: (s: string) => void;
  startDate: string; setStartDate: (s: string) => void;
  startTime: string; setStartTime: (s: string) => void;
  endDate: string; setEndDate: (s: string) => void;
  endTime: string; setEndTime: (s: string) => void;
  postcode: string; setPostcode: (s: string) => void;
  what3Words: string; setWhat3Words: (s: string) => void;
  appleMapsUrl: string; setAppleMapsUrl: (s: string) => void;
  lat: string; setLat: (s: string) => void;
  lon: string; setLon: (s: string) => void;
  description: string; setDescription: (s: string) => void;
  organiserName: string; setOrganiserName: (s: string) => void;
  paymentDestination: string; setPaymentDestination: (s: string) => void;
}

function BasicsStep(p: BasicsProps) {
  const [lookup, setLookup] = useState<{ busy: boolean; msg: string | null; ok: boolean }>({ busy: false, msg: null, ok: false });

  async function geocode() {
    setLookup({ busy: true, msg: null, ok: false });
    try {
      const { data } = await api.get<{ latitude: number | null; longitude: number | null; source: string | null }>(
        '/geocode',
        { params: { postcode: p.postcode || undefined, w3w: p.what3Words || undefined } }
      );
      if (data.latitude != null && data.longitude != null) {
        p.setLat(String(data.latitude));
        p.setLon(String(data.longitude));
        setLookup({ busy: false, msg: `Found via ${data.source ?? 'lookup'}: ${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)}`, ok: true });
      } else {
        setLookup({ busy: false, msg: 'No coordinates found. Try a more specific postcode or what3words.', ok: false });
      }
    } catch {
      setLookup({ busy: false, msg: 'Lookup failed.', ok: false });
    }
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-sm font-semibold flex items-center gap-1"><Trophy className="w-4 h-4" /> Name</span>
        <input className="input mt-1" placeholder="Spring Open 2026" value={p.name} onChange={(e) => p.setName(e.target.value)} required />
      </label>
      <label className="block">
        <span className="text-sm font-semibold flex items-center gap-1"><MapPin className="w-4 h-4" /> Venue / location</span>
        <input className="input mt-1" placeholder="Stoneleigh Park, Warwickshire" value={p.location} onChange={(e) => p.setLocation(e.target.value)} />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="text-sm font-semibold">Organiser name</span>
          <input
            className="input mt-1"
            placeholder="Warwickshire Pony Club"
            value={p.organiserName}
            onChange={(e) => p.setOrganiserName(e.target.value)}
          />
          <span className="text-[10px] text-slate-500">Shown publicly on the comp and on signup invoices.</span>
        </label>
        <label className="block">
          <span className="text-sm font-semibold">Payment destination (optional)</span>
          <input
            className="input mt-1"
            placeholder="PayPal: me@example.com  â€¢  Bank: 12-34-56 1234 5678"
            value={p.paymentDestination}
            onChange={(e) => p.setPaymentDestination(e.target.value)}
          />
          <span className="text-[10px] text-slate-500">
            Where signup fees should be sent. Free text for now; Stripe Connect integration coming.
          </span>
        </label>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="block">
          <span className="text-sm font-semibold flex items-center gap-1"><CalendarDays className="w-4 h-4" /> Start date</span>
          <input type="date" className="input mt-1" value={p.startDate} onChange={(e) => p.setStartDate(e.target.value)} required />
        </label>
        <label className="block">
          <span className="text-sm font-semibold flex items-center gap-1"><Clock className="w-4 h-4" /> Start time</span>
          <input type="time" className="input mt-1" value={p.startTime} onChange={(e) => p.setStartTime(e.target.value)} required />
        </label>
        <label className="block">
          <span className="text-sm font-semibold">End date</span>
          <input type="date" className="input mt-1" value={p.endDate} onChange={(e) => p.setEndDate(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm font-semibold flex items-center gap-1"><Clock className="w-4 h-4" /> End time</span>
          <input type="time" className="input mt-1" value={p.endTime} onChange={(e) => p.setEndTime(e.target.value)} />
        </label>
      </div>

      <div className="rounded-md border border-slate-200 dark:border-slate-700 p-2 space-y-2">
        <div className="text-sm font-semibold flex items-center gap-1">
          <MapPin className="w-4 h-4" /> Find on the map
          <span className="text-[11px] font-normal text-slate-500 ml-1">â€” postcode or what3words auto-fills coords for weather + map</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-slate-500">Postcode</span>
            <input
              className="input mt-1 text-sm uppercase"
              placeholder="CV8 2LG"
              value={p.postcode}
              onChange={(e) => p.setPostcode(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">what3words</span>
            <input
              className="input mt-1 text-sm"
              placeholder="///filled.count.soap"
              value={p.what3Words}
              onChange={(e) => p.setWhat3Words(e.target.value)}
            />
          </label>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={geocode}
            disabled={lookup.busy || (!p.postcode.trim() && !p.what3Words.trim())}
            className="btn-ghost !py-1 !px-2 text-xs"
          >
            <MapPin className="w-3.5 h-3.5" /> {lookup.busy ? 'Looking upâ€¦' : 'Look up coordinates'}
          </button>
          {lookup.msg && (
            <span className={`text-xs ${lookup.ok ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}`}>
              {lookup.msg}
            </span>
          )}
        </div>
        <details>
          <summary className="cursor-pointer text-xs text-slate-500">More options (Apple Maps URL, manual coords)</summary>
          <div className="space-y-2 mt-2">
            <label className="block">
              <span className="text-xs text-slate-500">Apple Maps URL</span>
              <input className="input mt-1 text-sm" placeholder="https://maps.apple.com/?ll=..." value={p.appleMapsUrl} onChange={(e) => p.setAppleMapsUrl(e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-slate-500">Latitude</span>
                <input className="input mt-1 text-sm" placeholder="52.2569" value={p.lat} onChange={(e) => p.setLat(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Longitude</span>
                <input className="input mt-1 text-sm" placeholder="-1.5398" value={p.lon} onChange={(e) => p.setLon(e.target.value)} />
              </label>
            </div>
          </div>
        </details>
      </div>

      <label className="block">
        <span className="text-sm font-semibold">Description (optional)</span>
        <textarea rows={2} className="input mt-1 text-sm" value={p.description} onChange={(e) => p.setDescription(e.target.value)} />
      </label>
    </div>
  );
}

function SectionsStep({
  sections, onAdd, onRemove, onUpdate,
}: {
  sections: SectionDraft[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  onUpdate: (i: number, patch: Partial<SectionDraft>) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Add the sections you'll offer. Just the basics now â€” format, age group, signup price and an optional cap.
        Races, sessions and heat timings come later in the <span className="font-semibold">Finalise</span> step,
        once you've seen who's signed up.
      </p>
      <div className="space-y-3">
        {sections.map((s, i) => (
          <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <label className="sm:col-span-4">
                <span className="text-xs text-slate-500">Format</span>
                <select
                  className="input mt-1 text-sm"
                  value={s.format}
                  onChange={(e) => onUpdate(i, { format: parseInt(e.target.value, 10) as Format })}
                >
                  {Object.entries(FORMAT_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="sm:col-span-4">
                <span className="text-xs text-slate-500">Age group</span>
                <select
                  className="input mt-1 text-sm"
                  value={s.ageGroup}
                  onChange={(e) => onUpdate(i, { ageGroup: e.target.value })}
                >
                  {AGE_GROUPS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className="text-xs text-slate-500">Price (Â£)</span>
                <input
                  type="number" min={0} step={0.5}
                  className="input mt-1 text-sm"
                  placeholder="0"
                  value={s.priceGbp}
                  onChange={(e) => onUpdate(i, { priceGbp: e.target.value })}
                />
              </label>
              <label className="sm:col-span-2">
                <span className="text-xs text-slate-500" title="Optional cap on active signups">Max people</span>
                <input
                  type="number" min={0}
                  className="input mt-1 text-sm"
                  placeholder="â€”"
                  value={s.maxParticipants ?? ''}
                  onChange={(e) => onUpdate(i, { maxParticipants: e.target.value })}
                />
              </label>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 flex-1">
                {sectionDisplayName(s)} Â· {priceGbpToMinor(s.priceGbp) === 0 ? 'Free' : `Â£${(priceGbpToMinor(s.priceGbp) / 100).toFixed(2)}`}
                {s.maxParticipants && ` Â· max ${parseMaxParticipants(s.maxParticipants)}`}
              </span>
              {sections.length > 1 && (
                <button type="button" onClick={() => onRemove(i)} className="text-rose-500 text-xs hover:underline">
                  <Trash2 className="inline w-3 h-3" /> Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={onAdd} className="btn-ghost !py-2 !px-3 text-sm">
        <Layers className="w-4 h-4" /> Add section
      </button>
    </div>
  );
}


interface ReviewProps {
  name: string; location: string; startDate: string; startTime: string;
  endDate: string; endTime: string;
  sections: SectionDraft[];
}

function ReviewStep(p: ReviewProps) {
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-slate-200 dark:border-slate-700 p-3 space-y-1 text-sm">
        <h4 className="font-semibold flex items-center gap-1"><Trophy className="w-4 h-4 text-brand-600" /> {p.name || '(unnamed)'}</h4>
        <p className="text-slate-600 dark:text-slate-300">
          {p.location || 'No venue'} · {p.startDate} {p.startTime} → {p.endDate || p.startDate} {p.endTime}
        </p>
      </div>

      <div className="rounded-md border border-slate-200 dark:border-slate-700 p-3 space-y-2">
        <h4 className="font-semibold text-sm flex items-center gap-1"><Layers className="w-4 h-4" /> Sections ({p.sections.length})</h4>
        <ul className="text-sm space-y-1">
          {p.sections.map((s, i) => (
            <li key={i} className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold flex-1 truncate">{sectionDisplayName(s)}</span>
              <span className="text-xs text-slate-500">
                {priceGbpToMinor(s.priceGbp) === 0 ? 'Free' : `£${(priceGbpToMinor(s.priceGbp) / 100).toFixed(2)}`}
                {s.maxParticipants && ` · max ${parseMaxParticipants(s.maxParticipants)}`}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-slate-500 flex items-start gap-1">
        <span>
          Clicking Create will publish the comp page so people can start signing up.
          Races, sessions and heat timings are added later via Finalise.
        </span>
      </p>
    </div>
  );
}
