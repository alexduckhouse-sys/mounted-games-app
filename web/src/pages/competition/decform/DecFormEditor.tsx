import { useEffect, useMemo, useState } from 'react';
import { CircleCheck, Plus, X } from 'lucide-react';
import { api } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { apiErrorMessage } from '../../../lib/apiError';
import { competitionDateText } from '../../../lib/competitionDates';
import {
  blankRider, buildSubmitBody, canSubmit, decDraftKey, emptySlots, firstEmpty, isReserveSlot, normaliseSlotsForFormat, panelTitle, riderFromSaved,
  phoneProblem, riderReady, ridersRequired, savedChoices, slotFlagged, slotLabel, slotMeta, slotsFromForm, statusText, subtitleOf, teamIsFull,
  type DecFormDraft, type DecRider, type Slot,
} from '../../../lib/decForm';
import { asked, STANDARD_CONFIG, type DecFormConfig } from '../../../lib/decFormConfig';
import type { CompetitionDetail, DeclarationForm, SavedRider, Team } from '../../../types';
import { Field } from '../../auth/Field';
import { RiderPanel } from './RiderPanel';
import { TermsDialog } from './TermsDialog';

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
  /** What this competition's dec form asks. The standard form when omitted. */
  config?: DecFormConfig;
}

const wide = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1024px)').matches;

/**
 * One team's dec form: the team's details, five rider slots and an optional non-riding reserve, with a panel
 * for the slot being filled. Replaces the old rider grid (docs/designs/dec-form-handoff.md).
 */
export function DecFormEditor({ competition, team, existing, draft, priorPhone, onSaved, config = STANDARD_CONFIG }: Props) {
  const { user } = useAuth();
  const section = competition.sections.find((s) => s.id === team.competitionSectionId);
  const required = ridersRequired(section?.format);

  const [slots, setSlots] = useState<Slot[]>(() => draft?.slots
    ? (required < 4 ? normaliseSlotsForFormat(draft.slots, section?.format) : draft.slots)
    : (existing ? slotsFromForm(existing, required, config) : emptySlots(required)));
  const [teamName, setTeamName] = useState(draft?.teamName ?? team.displayName);
  const [bibs, setBibs] = useState(draft?.bibs ?? existing?.bibDescription ?? team.bibDescription ?? '');
  const [trainerName, setTrainerName] = useState(draft?.trainerName ?? existing?.trainerName ?? existing?.submittedByName ?? user?.fullName ?? '');
  const [phone, setPhone] = useState(draft?.phone ?? existing?.trainerPhone ?? existing?.submittedByPhone ?? priorPhone ?? '');
  const [notes, setNotes] = useState(draft?.notes ?? existing?.notes ?? '');
  const [agreed, setAgreed] = useState(false);
  const [submitted, setSubmitted] = useState(!!existing && !draft);
  const [active, setActive] = useState<number | null>(() => (wide() ? firstEmpty(slots) : null));
  const [form, setForm] = useState<DecRider>(blankRider);
  const [saved, setSaved] = useState<SavedRider[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Nothing is kept until something has been typed, so just looking at a form leaves no draft behind.
  const [touched, setTouched] = useState(!!draft);
  const [termsOpen, setTermsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<SavedRider[]>(`/clubs/${team.clubId}/saved-riders`)
      .then((r) => { if (!cancelled && Array.isArray(r.data)) setSaved(r.data); })
      .catch(() => { if (!cancelled) setSaved([]); });
    return () => { cancelled = true; };
  }, [team.clubId]);

  // Keep the work in progress, so a dropped signal or a reload doesn't lose it. The tick is never kept.
  useEffect(() => {
    if (submitted || !touched) return;
    const draftToKeep: DecFormDraft = { teamId: team.id, teamName, bibs, trainerName, phone, notes, slots };
    try { localStorage.setItem(decDraftKey(competition.id, team.id), JSON.stringify(draftToKeep)); } catch { /* storage full or blocked */ }
  }, [submitted, touched, competition.id, team.id, teamName, bibs, trainerName, phone, notes, slots]);

  const choices = useMemo(() => savedChoices(saved, slots), [saved, slots]);
  const reserve = active != null && isReserveSlot(slots, active);
  const editing = active != null && !!slots[active];
  const full = teamIsFull(slots);
  const phoneIssue = phoneProblem(phone, config);
  const ready = canSubmit(slots, agreed, teamName, phoneIssue === null);
  const entryName = existing?.entryTeamName ?? null;
  const when = competition.startDate ? competitionDateText(competition.startDate, competition.endDate) : '';

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
    setActive(index);
    setForm(blankRider());
  }

  function commit() {
    if (active == null || !riderReady(form, reserve, undefined, config)) return;
    const next = slots.map((s, i) => (i === active ? { ...form, fullName: form.fullName.trim() } : s));
    setSlots(next);
    setSubmitted(false);
    setTouched(true);
    setError(null);
    const following = firstEmpty(next);
    setActive(following);
    setForm(blankRider());
  }

  async function submit() {
    if (!ready || busy || submitted) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<DeclarationForm>('/declaration-forms',
        buildSubmitBody({ teamId: team.id, teamName, bibs, trainerName, phone, notes }, slots, config));
      try { localStorage.removeItem(decDraftKey(competition.id, team.id)); } catch { /* ignore */ }
      setSubmitted(true);
      setActive(null);
      onSaved(data);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not send the dec form. Check your signal and try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="mg-h1 lg:!text-[44px] lg:!leading-none">{teamName.trim() || 'Team name'}</h2>
        <p className="mg-meta !text-base">{subtitleOf([section?.displayName, competition.name, when])}</p>
        {entryName && entryName.trim().toLowerCase() !== teamName.trim().toLowerCase() && (
          <p className="text-sm text-[rgb(var(--mg-muted))]">Entered as “{entryName}”.</p>
        )}
      </div>

      {submitted && (
        <div role="status" className="flex items-center gap-3 rounded-[10px] bg-[rgb(var(--mg-tint))] px-4 py-3.5 text-base font-semibold text-[rgb(var(--mg-heading))]">
          <CircleCheck aria-hidden="true" className="h-5 w-5 shrink-0" />
          <span>Dec form submitted. You can still change it.</span>
        </div>
      )}

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-7">
        <section aria-label="Dec form" className="flex flex-col gap-4">
          <div className="grid gap-4 lg:grid-cols-2 lg:gap-3">
            <Field label="Team name" className="lg:col-span-2">
              {({ id }) => <div className="mg-field"><input id={id} value={teamName} placeholder="e.g. Stockport C" maxLength={150} onChange={(e) => changed(setTeamName)(e.target.value)} /></div>}
            </Field>
            {asked(config.bib) && (
              <Field label="Bibs" className="lg:col-span-2">
                {({ id }) => <div className="mg-field"><input id={id} value={bibs} placeholder="e.g. Yellow with navy stars" maxLength={200} onChange={(e) => changed(setBibs)(e.target.value)} /></div>}
              </Field>
            )}
            <Field label="Trainer name">
              {({ id }) => <div className="mg-field"><input id={id} value={trainerName} autoComplete="name" maxLength={200} onChange={(e) => changed(setTrainerName)(e.target.value)} /></div>}
            </Field>
            {asked(config.trainerPhone) && (
              <Field label="Phone number" error={phone.trim() === '' ? null : phoneIssue}>
                {({ id, invalid }) => <div className="mg-field" data-invalid={invalid}><input id={id} type="tel" value={phone} autoComplete="tel" aria-invalid={invalid} onChange={(e) => changed(setPhone)(e.target.value)} /></div>}
              </Field>
            )}
          </div>

          <ol aria-label="Riders" className="mg-card mg-list m-0 list-none p-0">
            {slots.map((rider, index) => {
              const isActive = index === active;
              const isReserve = isReserveSlot(slots, index);
              return (
                <li key={index} className={isActive ? 'bg-[rgb(var(--mg-tint))] shadow-[inset_4px_0_0_rgb(var(--mg-heading))]' : ''}>
                  {rider ? (
                    <div className="flex min-h-16 items-center gap-1 pl-4 pr-1 lg:min-h-[72px] lg:pl-[18px]">
                      <button type="button" onClick={() => select(index)} className="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-2.5 text-left">
                        <span className="flex items-center gap-2 text-base font-semibold leading-tight lg:text-[17px]">
                          {rider.fullName}
                          {isReserve && <span className="mg-badge mg-badge-outline !h-5">Reserve</span>}
                        </span>
                        <span className="max-w-full truncate text-[13px] text-[rgb(var(--mg-muted))] lg:text-sm">{slotMeta(rider, isReserve, config)}</span>
                        {slotFlagged(rider, config) && <span className="mg-flag mt-1">Above or below the limit. This will be flagged for the organisers.</span>}
                      </button>
                      <button type="button" className="mg-icon-btn !border-0 !bg-transparent text-[rgb(var(--mg-muted))] hover:!text-[rgb(var(--mg-elim))]" aria-label={`Remove ${rider.fullName}`} onClick={() => clear(index)}>
                        <X aria-hidden="true" className="h-[18px] w-[18px]" />
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => select(index)}
                      className="flex min-h-16 w-full items-center gap-3 px-4 text-left lg:min-h-[72px] lg:px-[18px]">
                      <span className={`flex-1 text-base font-semibold lg:text-[17px] ${isActive ? 'text-[rgb(var(--mg-heading))]' : 'text-[rgb(var(--mg-muted))]'}`}>{slotLabel(slots, index)}</span>
                      <span className="flex items-center gap-1.5 text-[15px] font-semibold text-[rgb(var(--mg-heading))]"><Plus aria-hidden="true" className="h-[18px] w-[18px]" />{isActive ? 'Adding' : 'Add'}</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ol>

          <Field label={<>Notes for the organisers <span className="font-normal text-[rgb(var(--mg-muted))]">(optional)</span></>}>
            {({ id }) => <div className="mg-field"><input id={id} value={notes} onChange={(e) => changed(setNotes)(e.target.value)} /></div>}
          </Field>
        </section>

        {active != null ? (
          <RiderPanel
            title={panelTitle(slots, active)}
            reserve={reserve}
            editing={editing}
            form={form}
            choices={choices}
            addLabel={editing ? 'Save' : reserve ? 'Add reserve' : 'Add rider'}
            ready={riderReady(form, reserve, undefined, config)}
            config={config}
            onChange={(patch) => setForm((cur) => ({ ...cur, ...patch }))}
            onPick={(pick) => setForm(riderFromSaved(pick, reserve))}
            onCommit={commit}
            onClose={close}
          />
        ) : (
          <section aria-label="Next step" className="hidden flex-col items-start gap-3 rounded-xl border-[1.5px] border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-surface))] p-6 lg:flex">
            <CircleCheck aria-hidden="true" className="h-7 w-7 text-[rgb(var(--mg-heading))]" />
            <h2 className="mg-display text-[28px] font-bold leading-none text-[rgb(var(--mg-heading))]">{full ? 'Team complete' : 'Pick a slot'}</h2>
            <p className="text-base leading-snug text-[rgb(var(--mg-body))]">
              {full ? 'Check the riders, agree to the terms, then submit. You can come back and change it afterwards.' : 'Click an empty slot to add a rider.'}
            </p>
          </section>
        )}
      </div>

      <div className="flex flex-col gap-2 lg:sticky lg:bottom-[calc(68px+env(safe-area-inset-bottom))] lg:z-10 lg:-mx-4 lg:flex-row lg:items-center lg:gap-6 lg:border-t lg:border-[rgb(var(--mg-rule))] lg:bg-[rgb(var(--mg-surface))] lg:px-4 lg:py-3.5">
        <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))] px-4 text-base font-medium lg:order-2 lg:min-h-11 lg:border-0 lg:px-0 lg:text-[15px]">
          <input type="checkbox" className="h-[22px] w-[22px] shrink-0 cursor-pointer accent-[rgb(var(--mg-button))]" checked={agreed}
            onChange={(e) => { setAgreed(e.target.checked); setSubmitted(false); }} />
          <span>I agree to the <button type="button" onClick={(e) => { e.preventDefault(); setTermsOpen(true); }} className="font-semibold text-[rgb(var(--mg-heading))] underline underline-offset-2">terms and conditions</button></span>
        </label>
        <button type="button" className="mg-btn mg-btn-primary lg:order-3" disabled={!ready || busy || submitted} onClick={() => { void submit(); }}>
          {submitted ? 'Submitted' : 'Submit dec form'}
        </button>
        <span aria-live="polite" className="text-center text-[13px] font-medium text-[rgb(var(--mg-muted))] lg:order-1 lg:flex-1 lg:text-left lg:text-[15px] lg:text-[rgb(var(--mg-body))]">
          {statusText(slots, agreed, submitted)}
        </span>
      </div>
      {error && <p role="alert" className="text-sm font-medium text-[rgb(var(--mg-elim))]">{error}</p>}
      {termsOpen && <TermsDialog termsText={competition.termsText} onClose={() => setTermsOpen(false)} />}
    </div>
  );
}
