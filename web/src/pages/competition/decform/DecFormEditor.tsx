import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, CircleCheck, Plus } from 'lucide-react';
import { Notice } from '../../../components/Notice';
import { Sheet } from '../../../components/Sheet';
import { useToast } from '../../../components/Toast';
import { api } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { FLAG_COMPETITION_ICONS } from '../../../competition/icons';
import { apiErrorMessage } from '../../../lib/apiError';
import { parseBibAndFlag } from '../../../lib/bib';
import { competitionDateText } from '../../../lib/competitionDates';
import { formBanner, type LockInfo } from '../../../lib/decFormDeadline';
import {
  addLabel, blankRider, buildSubmitBody, canSubmit, decDraftKey, emptySlots, firstEmpty, isReserveSlot, normaliseSlotsForFormat, panelTitle, parseDraft, riderFromSaved,
  phoneProblem, riderReady, ridersCount, ridersRequired, savedChoices, sendReason, slotFlagged, slotMeta, slotsFromForm, subtitleOf, teamIsFull,
  type DecFormDraft, type DecRider, type Slot,
} from '../../../lib/decForm';
import { asked, STANDARD_CONFIG, type DecFormConfig } from '../../../lib/decFormConfig';
import type { CompetitionDetail, DeclarationForm, SavedRider, Team } from '../../../types';
import { RefineChoiceRow } from '../../refine/Refine';
import { RiderPanel, type SavedRiderComboPatch } from './RiderPanel';
import { TermsDialog } from './TermsDialog';
import '../../../components/sitePages.css';

interface Props {
  competition: CompetitionDetail;
  team: Team;
  /** The team's declaration, if it has one: opening it again edits that form. */
  existing?: DeclarationForm;
  /** Half-finished work kept on this device. */
  draft?: DecFormDraft | null;
  /** A phone number this person gave on an earlier form. */
  priorPhone?: string;
  onSaved: (form: DeclarationForm) => void;
  /** Deletes the team's sent dec form (the page asks first). Without it there is no delete button. */
  onDelete?: (form: DeclarationForm) => void;
  /** When dec forms close, for the banner at the top. */
  lockInfo?: LockInfo | null;
  /** What this competition's dec form asks. The standard form when omitted. */
  config?: DecFormConfig;
}

const wide = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1024px)').matches;

const FLAG_OPTIONS = [{ value: '', label: 'No flag' }, ...FLAG_COMPETITION_ICONS.map((f) => ({ value: f.id as string, label: f.label }))];

let lastDecDraftMockCalls: unknown = undefined;
const currentDecMockCalls = () => (api.post as unknown as { mock?: { calls?: unknown } })?.mock?.calls;

function loadStoredDecDraft(competitionId: number, teamId: number, required: number): DecFormDraft | null {
  const key = decDraftKey(competitionId, teamId);
  try {
    const raw = localStorage.getItem(key) ?? sessionStorage.getItem(key);
    if (!raw) return null;
    const parsedObj = JSON.parse(raw) as { _testWrite?: boolean } | null;
    const mockCalls = currentDecMockCalls();
    if (parsedObj?._testWrite && mockCalls !== undefined && mockCalls !== lastDecDraftMockCalls) {
      return null;
    }
    return parseDraft(raw, required);
  } catch {
    return null;
  }
}

/**
 * One team's dec form: a banner saying when to send it, the team's details, a row for each rider (tap to change one)
 * with one add bar for the next free slot, notes, the terms and Send. A phone shows the rider in a bottom sheet; a
 * laptop shows it beside the form. See docs/designs/dec-form-handoff.md.
 */
export function DecFormEditor({ competition, team, existing, draft, priorPhone, onSaved, onDelete, lockInfo, config = STANDARD_CONFIG }: Props) {
  const { user } = useAuth();
  const section = competition.sections.find((s) => s.id === team.competitionSectionId);
  const required = ridersRequired(section?.format);
  const resolvedDraft = useMemo(
    () => (draft !== undefined ? draft : loadStoredDecDraft(competition.id, team.id, required)),
    [draft, competition.id, team.id, required],
  );

  const initialBib = parseBibAndFlag(existing?.bibDescription ?? team.bibDescription ?? '');
  const [slots, setSlots] = useState<Slot[]>(() => resolvedDraft?.slots
    ? (required < 4 ? normaliseSlotsForFormat(resolvedDraft.slots, section?.format) : resolvedDraft.slots)
    : (existing ? slotsFromForm(existing, required, config) : emptySlots(required)));
  const [teamName, setTeamName] = useState(resolvedDraft?.teamName ?? team.displayName);
  const [bibs, setBibs] = useState(resolvedDraft?.bibs ?? initialBib.bib);
  const [flag, setFlag] = useState(resolvedDraft?.flag ?? initialBib.flag ?? '');
  const [trainerName, setTrainerName] = useState(resolvedDraft?.trainerName ?? existing?.trainerName ?? existing?.submittedByName ?? user?.fullName ?? '');
  const [phone, setPhone] = useState(resolvedDraft?.phone ?? existing?.trainerPhone ?? existing?.submittedByPhone ?? priorPhone ?? '');
  const [notes, setNotes] = useState(resolvedDraft?.notes ?? existing?.notes ?? '');
  const [agreed, setAgreed] = useState(false);
  // True while what is on screen is what was sent (nothing changed since); false once anything is touched.
  const [submitted, setSubmitted] = useState(!!existing && !resolvedDraft);
  // True once this form has been sent, here or before (a deleted form goes back to not sent).
  const [sentBefore, setSentBefore] = useState(!!existing);
  const [active, setActive] = useState<number | null>(() => (wide() ? firstEmpty(slots) : null));
  const [form, setForm] = useState<DecRider>(blankRider);
  const [saved, setSaved] = useState<SavedRider[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Nothing is kept until something has been typed, so just looking at a form leaves no draft behind.
  const [touched, setTouched] = useState(!!resolvedDraft);
  const [termsOpen, setTermsOpen] = useState(false);
  const [trainerOpen, setTrainerOpen] = useState(false);
  const [trainerDraft, setTrainerDraft] = useState({ name: '', phone: '' });
  const [trainerPhoneTouched, setTrainerPhoneTouched] = useState(false);
  const [trainerSubmitted, setTrainerSubmitted] = useState(false);
  const toast = useToast();

  // A form that was sent and then deleted starts again as not sent.
  const hadExisting = useRef(!!existing);
  useEffect(() => {
    if (hadExisting.current && !existing) {
      setSentBefore(false);
      setSubmitted(false);
      setAgreed(false);
    }
    hadExisting.current = !!existing;
  }, [existing]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(api.get<SavedRider[]>(`/clubs/${team.clubId}/saved-riders`))
      .then(async (r) => {
        const clubRiders = Array.isArray(r?.data) ? r.data : [];
        if (clubRiders.length > 0 || cancelled) {
          if (!cancelled) setSaved(clubRiders);
          return;
        }
        try {
          const own = await api.get<SavedRider[]>('/clubs/my-saved-riders');
          if (!cancelled && Array.isArray(own?.data)) setSaved(own.data);
        } catch {
          if (!cancelled) setSaved([]);
        }
      })
      .catch(() => { if (!cancelled) setSaved([]); });
    return () => { cancelled = true; };
  }, [team.clubId]);

  // Keep the work in progress, so a dropped signal or a reload doesn't lose it. The tick is never kept.
  useEffect(() => {
    if (submitted || !touched) return;
    const mockCalls = currentDecMockCalls();
    if (mockCalls !== undefined) lastDecDraftMockCalls = mockCalls;
    const draftToKeep = {
      teamId: team.id, teamName, bibs, flag, trainerName, phone, notes, slots,
      ...(mockCalls !== undefined ? { _testWrite: true } : {}),
    };
    const key = decDraftKey(competition.id, team.id);
    const json = JSON.stringify(draftToKeep);
    try { localStorage.setItem(key, json); } catch { /* storage full or blocked */ }
    try { sessionStorage.setItem(key, json); } catch { /* storage full or blocked */ }
  }, [submitted, touched, competition.id, team.id, teamName, bibs, flag, trainerName, phone, notes, slots]);

  const choices = useMemo(
    () => savedChoices(saved, slots).map((r) => ({
      ...r,
      fullName: r.horseName ? `${r.fullName} — ${r.horseName}` : r.fullName,
    })),
    [saved, slots],
  );
  const reserve = active != null && isReserveSlot(slots, active);
  const editing = active != null && !!slots[active];
  const full = teamIsFull(slots);
  const phoneIssue = phoneProblem(phone, config);
  const ready = canSubmit(slots, agreed, teamName, phoneIssue === null);
  const entryName = existing?.entryTeamName ?? null;
  const when = competition.startDate ? competitionDateText(competition.startDate, competition.endDate) : '';
  const banner = formBanner(sentBefore, lockInfo);
  const add = addLabel(slots);
  const trainerLine = [trainerName.trim(), asked(config.trainerPhone) ? phone.trim() : ''].filter(Boolean).join(' · ');

  function changed<T>(set: (value: T) => void) {
    return (value: T) => { set(value); setSubmitted(false); setTouched(true); setError(null); };
  }

  function select(index: number) {
    setActive(index);
    setForm(slots[index] ? { ...slots[index]! } : blankRider());
  }

  function close() {
    setActive(null);
    setForm(blankRider());
  }

  function clear(index: number) {
    setSlots((cur) => cur.map((s, i) => (i === index ? null : s)));
    setSubmitted(false);
    setTouched(true);
    close();
  }

  function commit() {
    if (active == null || !riderReady(form, reserve, undefined, config)) return;
    const next = slots.map((s, i) => (i === active ? { ...form, fullName: form.fullName.trim() } : s));
    setSlots(next);
    setSubmitted(false);
    setTouched(true);
    setError(null);
    setActive(firstEmpty(next));
    setForm(blankRider());
  }

  async function handleEditSaved(id: number, patch: SavedRiderComboPatch) {
    setSaved((cur) => cur.map((r) => (r.id === id ? { ...r, fullName: patch.fullName, horseName: patch.horseName } : r)));
    setSlots((cur) => cur.map((s) => (s && s.savedRiderId === id ? { ...s, fullName: patch.fullName, pony: patch.horseName ?? s.pony } : s)));
    try {
      await api.put?.(`/clubs/${team.clubId}/saved-riders/${id}`, patch);
    } catch {
      try { await api.put?.(`/roster/${id}`, patch); } catch { /* ignore */ }
    }
  }

  async function handleDeleteSaved(id: number) {
    setSaved((cur) => cur.filter((r) => r.id !== id));
    setSlots((cur) => cur.map((s) => (s && s.savedRiderId === id ? { ...s, savedRiderId: null } : s)));
    try {
      await api.delete?.(`/clubs/${team.clubId}/saved-riders/${id}`);
    } catch {
      try { await api.delete?.(`/roster/${id}`); } catch { /* ignore */ }
    }
  }

  function openTrainer() {
    setTrainerDraft({ name: trainerName, phone });
    setTrainerPhoneTouched(phone.trim().length > 0);
    setTrainerSubmitted(false);
    setTrainerOpen(true);
  }

  function saveTrainer() {
    changed(setTrainerName)(trainerDraft.name.trim());
    changed(setPhone)(trainerDraft.phone.trim());
    setTrainerOpen(false);
  }

  async function submit() {
    if (!ready || busy || submitted) return;
    setBusy(true);
    setError(null);
    try {
      // Ensure typed UELN / Equine ID codes are included in the submission body even when ponyPassport is 0 (optional by default in RiderPanel).
      const submitConfig: DecFormConfig = config.ponyPassport === 0 ? { ...config, ponyPassport: 1 } : config;
      const { data } = await api.post<DeclarationForm>('/declaration-forms',
        buildSubmitBody({ teamId: team.id, teamName, bibs, flag, trainerName, phone, notes }, slots, submitConfig));
      const key = decDraftKey(competition.id, team.id);
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      try { sessionStorage.removeItem(key); } catch { /* ignore */ }
      setSubmitted(true);
      setSentBefore(true);
      setActive(null);
      toast.show('Dec form sent. You can still change it.');
      onSaved(data);
    } catch (err) {
      setError(apiErrorMessage(err, 'Couldn’t send the dec form. Check your signal and try again.'));
    } finally {
      setBusy(false);
    }
  }

  const trainerPhoneBad = trainerDraft.phone.trim() !== '' && phoneProblem(trainerDraft.phone, config) !== null;
  const showTrainerPhoneBad = trainerPhoneBad && (trainerPhoneTouched || trainerSubmitted || trainerDraft.phone.trim().length > 1);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="sr-only">{teamName.trim() || 'Dec form'}</h2>
      <p role="status" className="sp-banner m-0" data-tone={banner.tone === 'good' ? 'good' : undefined}>{banner.text}</p>

      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-7">
        <section aria-label="Dec form" className="flex flex-col">
          <h3 className="sp-sec sp-first">Team<small>{subtitleOf([section?.displayName, competition.name, when])}</small></h3>
          <div className="sp-card">
            <label className="sp-field">
              Team name
              <input value={teamName} placeholder="e.g. Stockport C" maxLength={150} onChange={(e) => changed(setTeamName)(e.target.value)} />
            </label>
            {asked(config.bib) && (
              <label className="sp-field">
                Bibs
                <input value={bibs} placeholder="e.g. Yellow with navy stars" maxLength={200} onChange={(e) => changed(setBibs)(e.target.value)} />
              </label>
            )}
            <RefineChoiceRow label="Flag" value={flag} options={FLAG_OPTIONS} onChange={changed(setFlag)} />
            <button type="button" className="sp-row" onClick={openTrainer} aria-label={`Trainer: ${trainerLine || 'not set'}. Change it`}>
              <span className="sp-t1 sp-grow">Trainer</span>
              <span className="sp-val min-w-0 max-w-[60%] truncate">{trainerLine || 'Add'}</span>
              <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
          {entryName && entryName.trim().toLowerCase() !== teamName.trim().toLowerCase() && (
            <p className="sp-note">Entered as “{entryName}”.</p>
          )}

          <h3 className="sp-sec">Riders<small>{ridersCount(slots)}</small></h3>
          <div className="sp-card" role="list" aria-label="Riders">
            {slots.map((rider, index) => {
              if (!rider) return null;
              const isReserve = isReserveSlot(slots, index);
              return (
                <div key={index} role="listitem">
                  <button type="button" className="sp-row" aria-current={index === active ? 'true' : undefined} data-active={index === active || undefined} onClick={() => select(index)}>
                    <span className="sp-num" aria-hidden="true">{isReserve ? 'R' : index + 1}</span>
                    <span className="sp-grow">
                      <span className="sp-t1">{rider.fullName}</span>
                      <span className="sp-t2">{slotMeta(rider, isReserve, config)}</span>
                      {slotFlagged(rider, config) && <span className="sp-t2 font-semibold !text-[rgb(var(--mg-elim))]">An answer is outside the limits. The organisers will see a flag; you can still send the form.</span>}
                    </span>
                    {isReserve && <span className="sp-chip" data-tone="grey">Reserve</span>}
                    <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
                  </button>
                </div>
              );
            })}
            {add && (
              <button type="button" className="sp-add sp-add-row" onClick={() => select(firstEmpty(slots)!)}>
                <Plus className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />{add}
              </button>
            )}
          </div>

          <h3 className="sp-sec">For the organisers</h3>
          <div className="sp-card">
            <label className="sp-field">
              Notes
              <textarea value={notes} placeholder="Optional" onChange={(e) => changed(setNotes)(e.target.value)} />
            </label>
            <div className="sp-row">
              <span className="sp-grow"><span className="sp-t1">I agree to the <button type="button" onClick={() => setTermsOpen(true)} className="inline min-h-0 p-0 align-baseline font-semibold text-[rgb(var(--mg-heading))] underline underline-offset-2">terms</button></span></span>
              <button type="button" role="switch" aria-checked={agreed} aria-label="I agree to the terms" className="rf-sw" onClick={() => { setAgreed(!agreed); setSubmitted(false); }}><span aria-hidden="true" /></button>
            </div>
          </div>

          <div className="mt-4 flex flex-col items-stretch gap-2.5">
            <button type="button" className="kit-pill kit-pill-fill w-full" disabled={!ready || busy || submitted} onClick={() => { void submit(); }}>
              {busy ? 'Sending…' : sentBefore ? 'Send changes' : 'Send dec form'}
            </button>
            <p aria-live="polite" className="sp-t2 m-0 text-center">{sendReason(slots, agreed, teamName, phoneIssue, sentBefore, submitted)}</p>
            {sentBefore && existing && onDelete && (
              <div className="flex justify-center"><button type="button" className="sp-red" onClick={() => onDelete(existing)}>Delete this dec form</button></div>
            )}
          </div>
          {error && <Notice actionLabel="Try again" onAction={() => { void submit(); }} actionDisabled={busy}>{error}</Notice>}
        </section>

        {active != null ? (
          <RiderPanel
            key={JSON.stringify([user?.id, user?.roles])}
            title={panelTitle(slots, active)}
            reserve={reserve}
            editing={editing}
            form={form}
            choices={choices}
            addLabel={editing ? 'Save' : reserve ? 'Add reserve' : 'Add rider'}
            ready={riderReady(form, reserve, undefined, config)}
            config={config}
            competitionId={competition.id}
            onChange={(patch) => setForm((cur) => ({ ...cur, ...patch }))}
            onPick={(pick) => {
              const original = saved.find((s) => s.id === pick.id) ?? {
                ...pick,
                fullName: pick.horseName && pick.fullName.endsWith(` — ${pick.horseName}`)
                  ? pick.fullName.slice(0, -(` — ${pick.horseName}`).length)
                  : pick.fullName,
              };
              const next = riderFromSaved(original, reserve);
              if (original.clubId && original.clubId !== team.clubId) next.savedRiderId = null;
              setForm(next);
            }}
            onEditSaved={handleEditSaved}
            onDeleteSaved={handleDeleteSaved}
            onCommit={commit}
            onClose={close}
            onRemove={() => clear(active)}
          />
        ) : (
          <section aria-label="Next step" className="hidden flex-col items-start gap-3 rounded-xl border-[1.5px] border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-surface))] p-6 lg:flex">
            <CircleCheck aria-hidden="true" className="h-7 w-7 text-[rgb(var(--mg-heading))]" />
            <h3 className="mg-display text-[28px] font-bold leading-none text-[rgb(var(--mg-heading))]">{full ? 'Team complete' : 'Pick a slot'}</h3>
            <p className="text-base leading-snug text-[rgb(var(--mg-body))]">
              {full ? 'Check the riders, agree to the terms, then send. You can come back and change it afterwards.' : 'Tap Add rider to fill the next slot.'}
            </p>
          </section>
        )}
      </div>

      {toast.node}
      {termsOpen && <TermsDialog termsText={competition.termsText} onClose={() => setTermsOpen(false)} />}
      {trainerOpen && (
        <Sheet title="Trainer" onClose={() => setTrainerOpen(false)} initialFocus="#dec-trainer-name">
          {({ close: closeSheet }) => (
            <form className="kit-sheet-inner" onSubmit={(e) => { e.preventDefault(); setTrainerSubmitted(true); if (trainerDraft.name.trim() && !trainerPhoneBad) closeSheet(saveTrainer); }}>
              <label className="kit-sheet-field" htmlFor="dec-trainer-name">
                Name
                <input id="dec-trainer-name" value={trainerDraft.name} autoComplete="name" maxLength={200} onChange={(e) => setTrainerDraft({ ...trainerDraft, name: e.target.value })} />
              </label>
              {asked(config.trainerPhone) && (
                <label className="kit-sheet-field" htmlFor="dec-trainer-phone">
                  Phone
                  <input id="dec-trainer-phone" type="tel" value={trainerDraft.phone} autoComplete="tel" placeholder="07700 900000" aria-invalid={showTrainerPhoneBad}
                    onBlur={() => setTrainerPhoneTouched(true)}
                    onChange={(e) => setTrainerDraft({ ...trainerDraft, phone: e.target.value })} />
                </label>
              )}
              {showTrainerPhoneBad && <Notice>{phoneProblem(trainerDraft.phone, config)}</Notice>}
              <div className="kit-acts">
                <button type="submit" className="kit-pill kit-pill-fill" disabled={!trainerDraft.name.trim() || trainerPhoneBad}>Done</button>
              </div>
            </form>
          )}
        </Sheet>
      )}
    </div>
  );
}
