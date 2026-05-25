import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Check, X, Trophy, MapPin, CalendarDays, Layers, Users,
  Plus, Trash2, Sparkles, Wand2, Clock, ClipboardList, Search, ArrowUp, ArrowDown, BookOpen,
} from 'lucide-react';
import { api } from '../../api';
import type { Club, CompetitionDetail, CompetitionSection, DeclarationForm, RaceTemplate, Team } from '../../types';

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
  /** 1 or more sessions; the first is created by defaultSection. */
  sessions: SessionConfig[];
  minsPerHeat: number;
  maxTeamsPerHeat: number;
  runoffRaceName: string;
  usesRaceFinals: boolean;
}

interface TeamDraft {
  // Carries the saved id when editing.
  existingId?: number;
  // Index into the sections array (preferred over id so newly-added sections work).
  sectionIndex: number;
  clubId: number;
  suffix: string;
}

const STEPS = ['Basics', 'Sections & races', 'Teams', 'Review'] as const;
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
  };
}

function sectionDisplayName(s: SectionDraft): string {
  // "Teams Under 12" reads awkwardly — drop the format word for the Teams format.
  const prefix = s.format === 2 ? '' : FORMAT_LABEL[s.format];
  return `${prefix} ${s.ageGroup}`.trim();
}

function parseRaces(text: string): string[] {
  return text.split('\n').map((r) => r.trim()).filter(Boolean);
}

export function CompetitionEditor() {
  const navigate = useNavigate();
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

  // Sections + races
  const [sections, setSections] = useState<SectionDraft[]>(
    persisted?.sections && persisted.sections.length > 0 ? persisted.sections : [defaultSection()]
  );

  // Teams
  const [clubs, setClubs] = useState<Club[]>([]);
  const [teams, setTeams] = useState<TeamDraft[]>(persisted?.teams ?? []);
  const [decTeamIds, setDecTeamIds] = useState<Set<number>>(new Set());
  const [showAllClubs, setShowAllClubs] = useState(true);

  // Race templates — used by the picker in the Sections step.
  const [raceTemplates, setRaceTemplates] = useState<RaceTemplate[]>([]);

  useEffect(() => {
    api.get<Club[]>('/clubs').then((r) => setClubs(r.data)).catch(() => {});
    api.get<RaceTemplate[]>('/race-templates').then((r) => setRaceTemplates(r.data)).catch(() => {});
  }, []);

  // Autosave the wizard's full state so a reload (or accidental navigation away)
  // doesn't wipe everything. We persist on every change and clear on submit.
  useEffect(() => {
    const draft: PersistedDraft = {
      step,
      name, location,
      startDate, startTime, endDate, endTime,
      what3Words, postcode, appleMapsUrl, lat, lon,
      description,
      sections,
      teams,
    };
    try { window.localStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* quota */ }
  }, [storageKey, step, name, location, startDate, startTime, endDate, endTime,
      what3Words, postcode, appleMapsUrl, lat, lon, description, sections, teams]);

  useEffect(() => {
    // Skip the server fetch on edit if we already have a local draft — the user
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
        setTeams(c.teams.map((t) => existingTeamToDraft(t, c.sections)));
      })
      .catch(() => setError('Could not load competition.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `persisted` is captured once per render and used only as a one-shot guard.
  }, [isEdit, editingId]);

  // Dec form fetch always runs in edit mode — independent of whether we hydrated
  // form state from localStorage.
  useEffect(() => {
    if (!isEdit || !editingId) return;
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: editingId } })
      .then((r) => setDecTeamIds(new Set(r.data.map((f) => f.teamId))))
      .catch(() => {});
  }, [isEdit, editingId]);

  const stepIndex = STEPS.indexOf(step);
  const basicsValid = name.trim().length > 0 && startDate.length > 0 && startTime.length > 0;
  const sectionsValid = sections.length > 0 && sections.every((s) =>
    s.ageGroup.trim().length > 0
    && s.sessions.length > 0
    && s.sessions.every((sess) => parseRaces(sess.races).length > 0)
    && s.minsPerHeat > 0
  );

  function next() {
    setError(null);
    if (step === 'Basics' && !basicsValid) { setError('Name, start date and start time are required.'); return; }
    if (step === 'Sections & races' && !sectionsValid) {
      setError('Each section needs an age group, at least one race, and a heat duration.');
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

  function updateSession(sectionIdx: number, sessionIdx: number, patch: Partial<SessionConfig>) {
    setSections((cur) => cur.map((s, idx) => {
      if (idx !== sectionIdx) return s;
      const nextSessions = s.sessions.map((sess, j) => {
        if (j !== sessionIdx) return sess;
        const merged = { ...sess, ...patch };
        // If scope changes and the races are still the default for the old
        // scope, refresh them to the new scope's default.
        if (patch.scope !== undefined && sess.races === defaultRacesFor(sess.scope, s.format, s.ageGroup)) {
          merged.races = defaultRacesFor(merged.scope, s.format, s.ageGroup);
        }
        return merged;
      });
      return { ...s, sessions: nextSessions };
    }));
  }

  function addSession(sectionIdx: number) {
    setSections((cur) => cur.map((s, idx) => {
      if (idx !== sectionIdx) return s;
      const last = s.sessions[s.sessions.length - 1];
      const newSess: SessionConfig = {
        name: `${sectionDisplayName(s)} · Session ${s.sessions.length + 1}`,
        races: last?.races ?? defaultRacesFor('Zone', s.format, s.ageGroup),
        scope: last?.scope ?? 'Zone',
      };
      return { ...s, sessions: [...s.sessions, newSess] };
    }));
  }

  function removeSession(sectionIdx: number, sessionIdx: number) {
    setSections((cur) => cur.map((s, idx) => {
      if (idx !== sectionIdx) return s;
      if (s.sessions.length <= 1) return s;
      return { ...s, sessions: s.sessions.filter((_, j) => j !== sessionIdx) };
    }));
  }
  function addSection() {
    setSections((cur) => [...cur, defaultSection()]);
  }
  function removeSection(i: number) {
    setSections((cur) => cur.filter((_, idx) => idx !== i));
    setTeams((cur) => cur
      .filter((t) => t.sectionIndex !== i)
      .map((t) => ({ ...t, sectionIndex: t.sectionIndex > i ? t.sectionIndex - 1 : t.sectionIndex })));
  }

  function addTeam(sectionIndex: number, clubId: number) {
    const sameClub = teams.filter((t) => t.sectionIndex === sectionIndex && t.clubId === clubId);
    const next = String.fromCharCode(65 + sameClub.length);
    setTeams((cur) => [...cur, { sectionIndex, clubId, suffix: next }]);
  }
  function removeTeam(i: number) {
    setTeams((cur) => cur.filter((_, idx) => idx !== i));
  }
  function updateTeam(i: number, patch: Partial<TeamDraft>) {
    setTeams((cur) => cur.map((t, idx) => idx === i ? { ...t, ...patch } : t));
  }

  function combinedStartIso(): string {
    return new Date(`${startDate}T${startTime}`).toISOString();
  }

  // Build cascading session start times for review preview, in round-robin order.
  const sessionPreview = useMemo(() => {
    const start = startDate && startTime ? new Date(`${startDate}T${startTime}`) : null;
    const initialCursor = start ? start.getTime() : null;
    type Row = { idx: number; sessionNumber: number; section: SectionDraft; sessionName: string; teamCount: number; heatCount: number; durationMins: number; start: Date | null };
    const rows: Row[] = [];
    let cursor = initialCursor;
    const maxSessions = sections.reduce((m, s) => Math.max(m, s.sessions.length), 1);
    for (let sessIdx = 0; sessIdx < maxSessions; sessIdx++) {
      for (let i = 0; i < sections.length; i++) {
        const sec = sections[i];
        if (sessIdx >= sec.sessions.length) continue;
        const teamsInSection = teams.filter((t) => t.sectionIndex === i).length;
        const heatCount = Math.max(1, Math.ceil(teamsInSection / Math.max(1, sec.maxTeamsPerHeat)));
        const durationMins = heatCount * sec.minsPerHeat;
        const sessStart = cursor != null ? new Date(cursor) : null;
        rows.push({
          idx: i,
          sessionNumber: sessIdx + 1,
          section: sec,
          sessionName: sec.sessions[sessIdx].name,
          teamCount: teamsInSection,
          heatCount,
          durationMins,
          start: sessStart,
        });
        if (cursor != null) cursor = cursor + durationMins * 60_000;
      }
    }
    return rows;
  }, [sections, teams, startDate, startTime]);

  async function submitCreate() {
    setBusy(true);
    setError(null);
    try {
      setProgress('Creating competition…');
      const created = await api.post<{ id: number }>('/competitions', basicsPayload());
      const compId = created.data.id;

      setProgress('Adding sections…');
      const sectionIds: number[] = [];
      for (const s of sections) {
        const r = await api.post<{ id: number }>(`/competitions/${compId}/sections`, {
          format: s.format,
          ageGroup: s.ageGroup.trim(),
          displayName: sectionDisplayName(s),
          runoffRaceName: s.runoffRaceName.trim() || null,
          usesRaceFinals: s.usesRaceFinals,
        });
        sectionIds.push(r.data.id);
      }

      setProgress('Adding teams…');
      const sectionToTeamIds: Map<number, number[]> = new Map();
      for (let i = 0; i < teams.length; i++) {
        const t = teams[i];
        const sectionId = sectionIds[t.sectionIndex];
        const created = await api.post<{ id: number }>(`/competitions/${compId}/teams`, {
          competitionSectionId: sectionId,
          clubId: t.clubId,
          suffix: t.suffix.trim() || String.fromCharCode(65 + i),
          bibColour: null,
          trainerUserId: null,
        });
        const list = sectionToTeamIds.get(t.sectionIndex) ?? [];
        list.push(created.data.id);
        sectionToTeamIds.set(t.sectionIndex, list);
      }

      setProgress('Creating sessions & heats…');
      // Round-robin by session index: section1 sess1, section2 sess1, …, then section1 sess2, etc.
      // Each session can have its own race list (sec.sessions[sessIdx].races).
      let cursor = new Date(combinedStartIso()).getTime();
      let orderIndex = 1;
      const maxSessions = sections.reduce((m, s) => Math.max(m, s.sessions.length), 1);
      for (let sessIdx = 0; sessIdx < maxSessions; sessIdx++) {
        for (let i = 0; i < sections.length; i++) {
          const sec = sections[i];
          if (sessIdx >= sec.sessions.length) continue; // this section is done
          const sessionConfig = sec.sessions[sessIdx];
          const sectionId = sectionIds[i];
          const teamIds = sectionToTeamIds.get(i) ?? [];
          const heatCount = Math.max(1, Math.ceil(Math.max(1, teamIds.length) / Math.max(1, sec.maxTeamsPerHeat)));
          const durationMins = heatCount * sec.minsPerHeat;
          const displayName = sessionConfig.name.trim() || sectionDisplayName(sec);
          const session = await api.post<{ id: number }>(`/competitions/${compId}/sessions`, {
            competitionSectionId: sectionId,
            name: displayName,
            arenaName: null,
            scheduledStart: new Date(cursor).toISOString(),
            orderIndex,
            notes: null,
            isBreak: false,
            durationMinutes: durationMins,
            kind: 0,
            location: null,
          });
          orderIndex += 1;
          cursor += durationMins * 60_000;

          if (teamIds.length > 0) {
            const raceNames = parseRaces(sessionConfig.races);
            if (sec.usesRaceFinals) {
              // One race per heat; 3 heats per race (Q1, Q2, Final scaffold).
              await api.post(`/competitions/${compId}/sessions/${session.data.id}/generate-race-finals`, {
                teamIds,
                raceNames,
                lanesPerHeat: sec.maxTeamsPerHeat,
                replaceExisting: true,
              });
            } else {
              await api.post(`/competitions/${compId}/sessions/${session.data.id}/generate-heats`, {
                teamIds,
                raceNames,
                lanesPerHeat: sec.maxTeamsPerHeat,
                replaceExisting: true,
              });
            }
          }
          // Record minutesPerHeat on the session so the timetable knows how long heats run.
          await api.put(`/competitions/${compId}/sessions/${session.data.id}/settings`, {
            minutesPerHeat: sec.minsPerHeat,
            raceOrderAlternating: null,
          });
        }
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
      startDate: combinedStartIso(),
      endDate: endDate || endTime
        ? new Date(`${endDate || startDate}T${endTime || '17:00'}`).toISOString()
        : null,
    };
  }

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Loading…</div>;
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
          <span className="hidden sm:inline">Draft auto-saved · survives reload</span>
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
          />
        )}
        {step === 'Sections & races' && (
          <SectionsStep
            sections={sections}
            onAdd={addSection}
            onRemove={removeSection}
            onUpdate={updateSection}
            onUpdateSession={updateSession}
            onAddSession={addSession}
            onRemoveSession={removeSession}
            raceTemplates={raceTemplates}
            disabled={isEdit /* destructive edits to existing sections not yet supported */}
          />
        )}
        {step === 'Teams' && (
          <TeamsStep
            sections={sections}
            clubs={clubs}
            teams={teams}
            onAdd={addTeam}
            onRemove={removeTeam}
            onUpdate={updateTeam}
            showAllClubs={showAllClubs}
            setShowAllClubs={setShowAllClubs}
            decTeamIds={decTeamIds}
            disabled={isEdit}
            onClubsChanged={() => {
              api.get<Club[]>('/clubs').then((r) => setClubs(r.data)).catch(() => {});
            }}
          />
        )}
        {step === 'Review' && (
          <ReviewStep
            name={name} location={location} startDate={startDate} startTime={startTime}
            endDate={endDate} endTime={endTime}
            sections={sections} teams={teams} clubs={clubs}
            sessionPreview={sessionPreview}
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
        {isEdit && step === 'Basics' && (
          <button onClick={submitEditBasics} disabled={busy} className="btn-primary !py-1.5 !px-3 text-sm">
            <Check className="w-4 h-4" /> {busy ? 'Saving…' : 'Save basics'}
          </button>
        )}
        {step !== 'Review' ? (
          <button onClick={next} className="btn-primary !py-1.5 !px-3 text-sm">
            Next <ChevronRight className="w-4 h-4" />
          </button>
        ) : isEdit ? (
          <span className="text-xs text-slate-500 italic">
            Edit-mode timetable rebuilds aren't supported yet — use the timetable tab on the comp.
          </span>
        ) : (
          <button onClick={submitCreate} disabled={busy} className="btn-primary !py-2 !px-4 text-sm">
            <Check className="w-4 h-4" /> {busy ? (progress ?? 'Creating…') : 'Create competition'}
          </button>
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
  };
}

function existingTeamToDraft(t: Team, sections: CompetitionSection[]): TeamDraft {
  const idx = Math.max(0, sections.findIndex((s) => s.id === t.competitionSectionId));
  return { existingId: t.id, sectionIndex: idx, clubId: t.clubId, suffix: t.suffix };
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
          <span className="text-[11px] font-normal text-slate-500 ml-1">— postcode or what3words auto-fills coords for weather + map</span>
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
            <MapPin className="w-3.5 h-3.5" /> {lookup.busy ? 'Looking up…' : 'Look up coordinates'}
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
  sections, onAdd, onRemove, onUpdate, onUpdateSession, onAddSession, onRemoveSession,
  raceTemplates, disabled,
}: {
  sections: SectionDraft[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  onUpdate: (i: number, patch: Partial<SectionDraft>) => void;
  onUpdateSession: (sectionIdx: number, sessionIdx: number, patch: Partial<SessionConfig>) => void;
  onAddSession: (sectionIdx: number) => void;
  onRemoveSession: (sectionIdx: number, sessionIdx: number) => void;
  raceTemplates: RaceTemplate[];
  disabled: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Each section gets one or more sessions. Each session has its own race list — useful for splitting morning/afternoon heats with different race cards.
      </p>
      {disabled && (
        <div className="text-xs text-amber-700 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 p-2 rounded-md">
          Edit mode: section changes here aren't applied yet — use the comp page tabs for section/team tweaks.
        </div>
      )}
      <div className="space-y-3">
        {sections.map((s, i) => (
          <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <label className="sm:col-span-3">
                <span className="text-xs text-slate-500">Format</span>
                <select
                  className="input mt-1 text-sm"
                  value={s.format}
                  onChange={(e) => onUpdate(i, { format: parseInt(e.target.value, 10) as Format })}
                  disabled={disabled}
                >
                  {Object.entries(FORMAT_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="sm:col-span-3">
                <span className="text-xs text-slate-500">Age group</span>
                <select
                  className="input mt-1 text-sm"
                  value={s.ageGroup}
                  onChange={(e) => onUpdate(i, { ageGroup: e.target.value })}
                  disabled={disabled}
                >
                  {AGE_GROUPS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className="text-xs text-slate-500">Mins / heat</span>
                <input
                  type="number" min={1} max={120}
                  className="input mt-1 text-sm"
                  value={s.minsPerHeat}
                  onChange={(e) => onUpdate(i, { minsPerHeat: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  disabled={disabled}
                />
              </label>
              <label className="sm:col-span-2">
                <span className="text-xs text-slate-500">Max teams / heat</span>
                <input
                  type="number" min={2} max={20}
                  className="input mt-1 text-sm"
                  value={s.maxTeamsPerHeat}
                  onChange={(e) => onUpdate(i, { maxTeamsPerHeat: Math.max(2, parseInt(e.target.value, 10) || 2) })}
                  disabled={disabled}
                />
              </label>
              <div className="sm:col-span-2 flex items-end justify-end">
                {sections.length > 1 && !disabled && (
                  <button type="button" onClick={() => onRemove(i)} className="text-rose-500 text-xs hover:underline">
                    <Trash2 className="inline w-3 h-3" /> Remove
                  </button>
                )}
              </div>
            </div>

            {/* Per-session race lists */}
            <div className="space-y-2">
              {s.sessions.map((sess, si) => (
                <div key={si} className="rounded-md border border-slate-200 dark:border-slate-700/60 bg-slate-50/60 dark:bg-slate-800/30 p-2 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase tracking-wide font-bold text-slate-500 dark:text-slate-400 shrink-0">
                      Session {si + 1}
                    </span>
                    <input
                      className="input !py-1 text-sm flex-1 min-w-[120px]"
                      value={sess.name}
                      placeholder="Session name"
                      onChange={(e) => onUpdateSession(i, si, { name: e.target.value })}
                      disabled={disabled}
                    />
                    <select
                      className="input !py-1 text-sm w-32"
                      value={sess.scope}
                      onChange={(e) => onUpdateSession(i, si, { scope: e.target.value as SectionScope })}
                      disabled={disabled}
                      title="Switching auto-fills the default race list — your edits are preserved"
                    >
                      <option value="Zone">Zone 2026</option>
                      <option value="Area">Area 2026</option>
                    </select>
                    {s.sessions.length > 1 && !disabled && !s.usesRaceFinals && (
                      <button
                        type="button"
                        onClick={() => onRemoveSession(i, si)}
                        className="btn-ghost !py-0.5 !px-1.5 text-[11px] text-rose-500"
                        title="Remove this session"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Races (in order)</span>
                    <RacePicker
                      value={sess.races}
                      onChange={(next) => onUpdateSession(i, si, { races: next })}
                      templates={raceTemplates}
                      disabled={disabled}
                    />
                    <div className="text-[11px] text-slate-500 mt-1">
                      → {parseRaces(sess.races).length} race{parseRaces(sess.races).length === 1 ? '' : 's'} per heat
                    </div>
                  </div>
                </div>
              ))}
              {!disabled && !s.usesRaceFinals && (
                <button
                  type="button"
                  onClick={() => onAddSession(i)}
                  className="btn-ghost !py-1 !px-2 text-[11px]"
                >
                  <Plus className="w-3 h-3" /> Add another session
                </button>
              )}
            </div>

            {/* Section-wide options */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-700/60">
              <label className="block">
                <span className="text-xs text-slate-500">Run-off race (for ties)</span>
                <input
                  list={`runoff-templates-${i}`}
                  className="input mt-1 text-sm"
                  placeholder={ZONE_RUNOFF}
                  value={s.runoffRaceName}
                  onChange={(e) => onUpdate(i, { runoffRaceName: e.target.value })}
                />
                <datalist id={`runoff-templates-${i}`}>
                  {raceTemplates.map((t) => <option key={t.id} value={t.name} />)}
                </datalist>
              </label>
              <label className="flex items-start gap-2 text-xs cursor-pointer p-2 rounded-md bg-slate-50 dark:bg-slate-800/60">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={s.usesRaceFinals}
                  onChange={(e) => onUpdate(i, { usesRaceFinals: e.target.checked })}
                  disabled={disabled}
                />
                <span>
                  <span className="font-semibold">Race-finals format.</span>{' '}
                  <span className="text-slate-500 dark:text-slate-300">
                    Each race becomes 3 heats: two random qualifier heats (1 pt per finisher, 0 if eliminated)
                    and a final with the top X from each qualifier. Pins the section to a single session.
                  </span>
                </span>
              </label>
            </div>
          </div>
        ))}
      </div>
      {!disabled && (
        <button type="button" onClick={onAdd} className="btn-ghost !py-2 !px-3 text-sm">
          <Layers className="w-4 h-4" /> Add section
        </button>
      )}
    </div>
  );
}

function TeamsStep({
  sections, clubs, teams, onAdd, onRemove, onUpdate, showAllClubs, setShowAllClubs, decTeamIds, disabled,
  onClubsChanged,
}: {
  sections: SectionDraft[];
  clubs: Club[];
  teams: TeamDraft[];
  onAdd: (sectionIndex: number, clubId: number) => void;
  onRemove: (i: number) => void;
  onUpdate: (i: number, patch: Partial<TeamDraft>) => void;
  showAllClubs: boolean;
  setShowAllClubs: (v: boolean) => void;
  decTeamIds: Set<number>;
  disabled: boolean;
  onClubsChanged: () => void;
}) {
  const [sectionFilter, setSectionFilter] = useState<number>(0);
  const [search, setSearch] = useState('');
  const [customName, setCustomName] = useState('');
  const [customBusy, setCustomBusy] = useState(false);

  const pool = useMemo(() => {
    if (showAllClubs) return clubs;
    // Filter to clubs that already have at least one dec-formed team in this comp.
    const clubIdsWithDec = new Set(
      teams.filter((t) => t.existingId != null && decTeamIds.has(t.existingId)).map((t) => t.clubId)
    );
    return clubs.filter((c) => clubIdsWithDec.has(c.id));
  }, [clubs, showAllClubs, teams, decTeamIds]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length === 0) return pool.slice(0, 10);
    return pool
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [pool, search]);

  async function addCustomTeam() {
    const name = customName.trim();
    if (!name) return;
    setCustomBusy(true);
    try {
      const { data } = await api.post<Club>('/clubs', { name, region: 'Custom' });
      onAdd(sectionFilter, data.id);
      setCustomName('');
      onClubsChanged();
    } catch {
      alert('Could not add custom team.');
    } finally {
      setCustomBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Add teams to each section. You can keep this minimal now — trainers submit dec forms separately and they'll appear over time.
      </p>
      {disabled && (
        <div className="text-xs text-amber-700 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 p-2 rounded-md">
          Edit mode: team changes here aren't applied yet — add or remove teams via the comp's Teams tab.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-semibold">Add to:</label>
        <select
          className="input !py-1.5 text-sm"
          value={sectionFilter}
          onChange={(e) => setSectionFilter(parseInt(e.target.value, 10))}
          disabled={disabled}
        >
          {sections.map((s, i) => (
            <option key={i} value={i}>{sectionDisplayName(s)}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer ml-auto">
          <input
            type="checkbox"
            checked={showAllClubs}
            onChange={(e) => setShowAllClubs(e.target.checked)}
          />
          Show all pony clubs
        </label>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            className="input !py-1.5 text-sm flex-1"
            placeholder={`Search ${pool.length} clubs…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-64 overflow-auto p-2 border border-slate-200 dark:border-slate-700 rounded-md">
          {matches.length === 0 ? (
            <p className="col-span-full text-xs text-slate-500">
              No clubs match "{search}". Add a custom team below.
            </p>
          ) : matches.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={disabled}
              onClick={() => onAdd(sectionFilter, c.id)}
              className="text-left px-2 py-1.5 rounded-md text-xs bg-slate-50 dark:bg-slate-800 hover:bg-brand-50 dark:hover:bg-brand-900/30 border border-slate-200 dark:border-slate-700 disabled:opacity-50"
            >
              <Plus className="inline w-3 h-3 mr-1" /> {c.name}
              {c.region === 'Custom' && (
                <span className="ml-1 text-[9px] uppercase tracking-wide text-slate-400">custom</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 mt-1">
          <Plus className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            className="input !py-1.5 text-sm flex-1"
            placeholder="Custom team name (e.g. Visiting — Local PC)"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTeam(); } }}
            disabled={disabled || customBusy}
          />
          <button
            type="button"
            onClick={addCustomTeam}
            disabled={disabled || customBusy || !customName.trim()}
            className="btn-ghost !py-1.5 !px-2 text-xs disabled:opacity-30"
          >
            {customBusy ? '…' : 'Add custom'}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {sections.map((sec, si) => {
          const list = teams
            .map((t, i) => ({ t, i }))
            .filter(({ t }) => t.sectionIndex === si);
          return (
            <div key={si} className="rounded-md border border-slate-200 dark:border-slate-700 p-2">
              <div className="flex items-center gap-2 mb-1.5">
                <Users className="w-4 h-4 text-brand-600" />
                <h4 className="text-sm font-semibold">{sectionDisplayName(sec)}</h4>
                <span className="text-xs text-slate-500">{list.length} team{list.length === 1 ? '' : 's'}</span>
              </div>
              {list.length === 0 ? (
                <p className="text-xs text-slate-500">No teams yet.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {list.map(({ t, i }) => {
                    const club = clubs.find((c) => c.id === t.clubId);
                    const hasDec = t.existingId != null && decTeamIds.has(t.existingId);
                    return (
                      <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-slate-50 dark:bg-slate-800">
                        <span className="text-sm flex-1 truncate">{club?.name ?? `Club #${t.clubId}`}</span>
                        <input
                          className="input !py-0.5 !px-1 text-xs w-12 uppercase"
                          maxLength={4}
                          value={t.suffix}
                          onChange={(e) => onUpdate(i, { suffix: e.target.value })}
                          disabled={disabled}
                        />
                        {hasDec && (
                          <span title="Dec form submitted" className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200 text-[9px] font-semibold">
                            <ClipboardList className="w-2.5 h-2.5" /> DEC
                          </span>
                        )}
                        {!disabled && (
                          <button type="button" onClick={() => onRemove(i)} className="text-rose-500 hover:text-rose-700" title="Remove">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ReviewProps {
  name: string; location: string; startDate: string; startTime: string;
  endDate: string; endTime: string;
  sections: SectionDraft[]; teams: TeamDraft[]; clubs: Club[];
  sessionPreview: { idx: number; sessionNumber: number; section: SectionDraft; sessionName: string; teamCount: number; heatCount: number; durationMins: number; start: Date | null }[];
}

function ReviewStep(p: ReviewProps) {
  const totalMins = p.sessionPreview.reduce((m, s) => m + s.durationMins, 0);
  const finishesAt = p.sessionPreview.length > 0 && p.sessionPreview[p.sessionPreview.length - 1].start
    ? new Date(p.sessionPreview[p.sessionPreview.length - 1].start!.getTime() + p.sessionPreview[p.sessionPreview.length - 1].durationMins * 60_000)
    : null;
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-slate-200 dark:border-slate-700 p-3 space-y-1 text-sm">
        <h4 className="font-semibold flex items-center gap-1"><Trophy className="w-4 h-4 text-brand-600" /> {p.name || '(unnamed)'}</h4>
        <p className="text-slate-600 dark:text-slate-300">
          {p.location || 'No venue'} · {p.startDate} {p.startTime} → {p.endDate || p.startDate} {p.endTime}
        </p>
      </div>

      <div className="rounded-md border border-slate-200 dark:border-slate-700 p-3 space-y-2">
        <h4 className="font-semibold text-sm flex items-center gap-1"><Layers className="w-4 h-4" /> Schedule</h4>
        <ul className="text-sm space-y-1">
          {p.sessionPreview.map((s, i) => (
            <li key={`${s.idx}-${s.sessionNumber}-${i}`} className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs tabular-nums w-12">
                {s.start ? s.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
              </span>
              <span className="font-semibold flex-1 truncate">
                {s.sessionName || sectionDisplayName(s.section)}
                {s.section.sessions.length > 1 && (
                  <span className="text-slate-500 font-normal"> · Session {s.sessionNumber}</span>
                )}
              </span>
              <span className="text-xs text-slate-500">
                {s.teamCount} team{s.teamCount === 1 ? '' : 's'} · {s.heatCount} heat{s.heatCount === 1 ? '' : 's'} · {s.durationMins} min
              </span>
            </li>
          ))}
        </ul>
        {p.sections.some((s) => s.runoffRaceName.trim()) && (
          <p className="text-[11px] text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-700/60">
            Run-off:{' '}
            {Array.from(new Set(p.sections.map((s) => s.runoffRaceName.trim()).filter(Boolean))).join(' · ')}
          </p>
        )}
        {finishesAt && (
          <p className="text-xs text-slate-500">
            Total runtime ~{Math.round(totalMins)} min · ends ~{finishesAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>

      <div className="rounded-md border border-slate-200 dark:border-slate-700 p-3">
        <h4 className="font-semibold text-sm flex items-center gap-1 mb-1.5"><Users className="w-4 h-4" /> Teams ({p.teams.length})</h4>
        {p.teams.length === 0 ? (
          <p className="text-xs text-slate-500">No teams added yet — you can still create and add them later.</p>
        ) : (
          <ul className="text-xs grid grid-cols-1 sm:grid-cols-2 gap-0.5">
            {p.teams.map((t, i) => {
              const club = p.clubs.find((c) => c.id === t.clubId);
              const sec = p.sections[t.sectionIndex];
              return (
                <li key={i} className="truncate">
                  <span className="font-medium">{club?.name ?? `Club #${t.clubId}`} {t.suffix}</span>
                  <span className="text-slate-500"> · {sectionDisplayName(sec)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-xs text-slate-500 flex items-center gap-1">
        <Wand2 className="w-3 h-3" /> Clicking Create will set up the comp, sections, teams, sessions and heats in one go.
      </p>
    </div>
  );
}

/**
 * Race picker: search the race library, click to add, build an ordered list.
 * `value` is the newline-separated string used everywhere else; we round-trip
 * via parseRaces / join('\n') so the rest of the wizard is unchanged.
 */
function RacePicker({
  value, onChange, templates, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  templates: RaceTemplate[];
  disabled: boolean;
}) {
  const list = parseRaces(value);
  const [search, setSearch] = useState('');
  const [custom, setCustom] = useState('');

  function setList(next: string[]) {
    onChange(next.join('\n'));
  }
  function addRace(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (list.some((r) => r.toLowerCase() === trimmed.toLowerCase())) return;
    setList([...list, trimmed]);
    setSearch('');
    setCustom('');
  }
  function removeAt(i: number) {
    setList(list.filter((_, idx) => idx !== i));
  }
  function moveBy(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    const next = list.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
  }

  const q = search.trim().toLowerCase();
  const notInList = (t: RaceTemplate) => !list.some((r) => r.toLowerCase() === t.name.toLowerCase());
  // With an empty query, show the first few alphabetical suggestions so the
  // user knows the library is wired up. With a query, filter by name/category.
  const matches = q.length === 0
    ? templates.filter(notInList).slice(0, 8)
    : templates
        .filter((t) => t.name.toLowerCase().includes(q) || (t.category ?? '').toLowerCase().includes(q))
        .filter(notInList)
        .slice(0, 10);

  return (
    <div className="space-y-1.5">
      {list.length === 0 ? (
        <p className="text-[11px] italic text-slate-500 px-2 py-1.5 rounded-md bg-slate-50 dark:bg-slate-800/60">
          No races yet — pick from the library below.
        </p>
      ) : (
        <ol className="space-y-1">
          {list.map((race, i) => (
            <li key={`${race}-${i}`} className="flex items-center gap-1 text-sm bg-slate-50 dark:bg-slate-800 rounded-md px-2 py-1">
              <span className="font-mono text-[10px] text-slate-400 w-4">{i + 1}.</span>
              <span className="flex-1 truncate">{race}</span>
              {!disabled && (
                <>
                  <button
                    type="button" onClick={() => moveBy(i, -1)} disabled={i === 0}
                    className="btn-ghost !py-0.5 !px-1 text-[10px] disabled:opacity-30"
                    title="Move up"
                  ><ArrowUp className="w-3 h-3" /></button>
                  <button
                    type="button" onClick={() => moveBy(i, 1)} disabled={i === list.length - 1}
                    className="btn-ghost !py-0.5 !px-1 text-[10px] disabled:opacity-30"
                    title="Move down"
                  ><ArrowDown className="w-3 h-3" /></button>
                  <button
                    type="button" onClick={() => removeAt(i)}
                    className="btn-ghost !py-0.5 !px-1 text-[10px] text-rose-500"
                    title="Remove"
                  ><X className="w-3 h-3" /></button>
                </>
              )}
            </li>
          ))}
        </ol>
      )}

      {!disabled && (
        <>
          <div className="flex items-center gap-1 mt-1.5">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              className="input !py-1 text-xs flex-1"
              placeholder={`Search ${templates.length} races…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {matches.length > 0 && (
            <div className="rounded-md border border-slate-200 dark:border-slate-700 max-h-40 overflow-auto">
              {matches.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => addRace(t.name)}
                  className="w-full text-left px-2 py-1 text-xs hover:bg-brand-50 dark:hover:bg-brand-900/30 flex items-center gap-1.5"
                >
                  <BookOpen className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="font-semibold">{t.name}</span>
                  {t.category && <span className="text-[10px] text-slate-500">{t.category}</span>}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1 mt-1">
            <Plus className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              className="input !py-1 text-xs flex-1"
              placeholder="Or add a custom race name…"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addRace(custom); }
              }}
            />
            <button
              type="button"
              onClick={() => addRace(custom)}
              disabled={!custom.trim()}
              className="btn-ghost !py-1 !px-2 text-[11px] disabled:opacity-30"
            >Add</button>
          </div>
        </>
      )}
    </div>
  );
}
