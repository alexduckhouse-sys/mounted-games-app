import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, CircleCheck, Copy, Plus } from 'lucide-react';
import { confirmDialog } from '../../../components/ConfirmDialog';
import { Notice } from '../../../components/Notice';
import { Sheet } from '../../../components/Sheet';
import { useToast } from '../../../components/Toast';
import { api } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { useLanguage, useT } from '../../../i18n/LanguageContext';
import { FLAG_COMPETITION_ICONS } from '../../../competition/icons';
import { apiErrorMessage } from '../../../lib/apiError';
import { parseBibAndFlag } from '../../../lib/bib';
import { competitionDateText } from '../../../lib/competitionDates';
import { formBanner, type LockInfo } from '../../../lib/decFormDeadline';
import {
  addLabel, applySavedTeamToForm, blankRider, buildSubmitBody, canSubmit, decDraftKey, emptySlots, firstEmpty, isReserveSlot, normaliseSlotsForFormat, panelTitle, riderFromSaved,
  phoneProblem, riderReady, ridersCount, ridersRequired, savedChoices, savedTeamSummaryLabel, sendReason, slotFlagged, slotMeta, slotsFromForm, subtitleOf, teamIsFull,
  type DecFormDraft, type DecRider, type SavedTeamAgeWarning, type Slot,
} from '../../../lib/decForm';
import { asked, STANDARD_CONFIG, type DecFormConfig } from '../../../lib/decFormConfig';
import type { CompetitionDetail, DeclarationForm, SavedRider, SavedTeamDeclaration, Team } from '../../../types';
import { RefineChoiceRow } from '../../refine/Refine';
import { RiderPanel } from './RiderPanel';
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

/**
 * One team's dec form: a banner saying when to send it, the team's details, a row for each rider (tap to change one)
 * with one add bar for the next free slot, notes, the terms and Send. A phone shows the rider in a bottom sheet; a
 * laptop shows it beside the form. See docs/designs/dec-form-handoff.md.
 */
export function DecFormEditor({ competition, team, existing, draft, priorPhone, onSaved, onDelete, lockInfo, config = STANDARD_CONFIG }: Props) {
  const t = useT();
  const { locale } = useLanguage();
  const { user } = useAuth();
  const flagOptions = [{ value: '', label: t('entries.dec.noFlag') }, ...FLAG_COMPETITION_ICONS.map((f) => ({ value: f.id as string, label: f.label }))];
  const section = competition.sections.find((s) => s.id === team.competitionSectionId);
  const required = ridersRequired(section?.format);

  const initialBib = parseBibAndFlag(existing?.bibDescription ?? team.bibDescription ?? '');
  const [slots, setSlots] = useState<Slot[]>(() => draft?.slots
    ? (required < 4 ? normaliseSlotsForFormat(draft.slots, section?.format) : draft.slots)
    : (existing ? slotsFromForm(existing, required, config) : emptySlots(required)));
  const [teamName, setTeamName] = useState(draft?.teamName ?? team.displayName);
  const [bibs, setBibs] = useState(draft?.bibs ?? initialBib.bib);
  const [flag, setFlag] = useState(draft?.flag ?? initialBib.flag ?? '');
  const [trainerName, setTrainerName] = useState(draft?.trainerName ?? existing?.trainerName ?? existing?.submittedByName ?? user?.fullName ?? '');
  const [phone, setPhone] = useState(draft?.phone ?? existing?.trainerPhone ?? existing?.submittedByPhone ?? priorPhone ?? '');
  const [notes, setNotes] = useState(draft?.notes ?? existing?.notes ?? '');
  const [agreed, setAgreed] = useState(false);
  // True while what is on screen is what was sent (nothing changed since); false once anything is touched.
  const [submitted, setSubmitted] = useState(!!existing && !draft);
  // True once this form has been sent, here or before (a deleted form goes back to not sent).
  const [sentBefore, setSentBefore] = useState(!!existing);
  const [active, setActive] = useState<number | null>(() => (wide() ? firstEmpty(slots) : null));
  const [form, setForm] = useState<DecRider>(blankRider);
  const [saved, setSaved] = useState<SavedRider[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Nothing is kept until something has been typed, so just looking at a form leaves no draft behind.
  const [touched, setTouched] = useState(!!draft);
  const [termsOpen, setTermsOpen] = useState(false);
  const [trainerOpen, setTrainerOpen] = useState(false);
  const [trainerDraft, setTrainerDraft] = useState({ name: '', phone: '' });
  const [savedTeams, setSavedTeams] = useState<SavedTeamDeclaration[]>([]);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copied, setCopied] = useState<{ label: string; warnings: SavedTeamAgeWarning[] } | null>(null);
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

  // Teams this person has declared before, for "Copy a previous team". Not offered once this form has been sent.
  useEffect(() => {
    if (sentBefore) return;
    let cancelled = false;
    Promise.resolve(api.get<SavedTeamDeclaration[]>(`/declaration-forms/my-saved-teams?excludeTeamId=${team.id}`))
      .then((r) => {
        if (cancelled || !Array.isArray(r?.data)) return;
        setSavedTeams(r.data.filter((t) => Array.isArray(t?.riders) && t.riders.length > 0));
      })
      .catch(() => { /* the picker just doesn't show */ });
    return () => { cancelled = true; };
  }, [sentBefore, team.id]);

  // Keep the work in progress, so a dropped signal or a reload doesn't lose it. The tick is never kept.
  useEffect(() => {
    if (submitted || !touched) return;
    const draftToKeep: DecFormDraft = { teamId: team.id, teamName, bibs, flag, trainerName, phone, notes, slots };
    try { localStorage.setItem(decDraftKey(competition.id, team.id), JSON.stringify(draftToKeep)); } catch { /* storage full or blocked */ }
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

  function openTrainer() {
    setTrainerDraft({ name: trainerName, phone });
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
      const { data } = await api.post<DeclarationForm>('/declaration-forms',
        buildSubmitBody({ teamId: team.id, teamName, bibs, flag, trainerName, phone, notes }, slots, config));
      try { localStorage.removeItem(decDraftKey(competition.id, team.id)); } catch { /* ignore */ }
      setSubmitted(true);
      setSentBefore(true);
      setActive(null);
      toast.show(t('entries.dec.sentToast'));
      onSaved(data);
    } catch (err) {
      setError(apiErrorMessage(err, t('entries.dec.sendFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function copyTeam(saved: SavedTeamDeclaration) {
    if (slots.some(Boolean) && !(await confirmDialog({
      title: t('entries.dec.replaceTitle'),
      message: t('entries.dec.replaceMessage'),
      confirmLabel: t('entries.dec.replace'),
    }))) return;
    const year = competition.startDate ? new Date(competition.startDate).getFullYear() : null;
    const applied = applySavedTeamToForm(saved, section?.format, config, {
      targetAgeGroup: section?.ageGroup || section?.displayName,
      competitionYear: year,
    });
    setSlots(applied.slots);
    if (!teamName.trim() && applied.teamName) setTeamName(applied.teamName);
    if (applied.bibs) setBibs(applied.bibs);
    if (applied.flag) setFlag(applied.flag);
    if (applied.trainerName) setTrainerName(applied.trainerName);
    if (applied.phone) setPhone(applied.phone);
    setSubmitted(false);
    setTouched(true);
    setError(null);
    setActive(wide() ? firstEmpty(applied.slots) : null);
    setForm(blankRider());
    setCopied({ label: saved.entryTeamName || saved.teamName, warnings: applied.ageWarnings });
  }

  const trainerPhoneBad = trainerDraft.phone.trim() !== '' && phoneProblem(trainerDraft.phone, config) !== null;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="sr-only">{teamName.trim() || t('entries.dec.title')}</h2>
      <p role="status" className="sp-banner m-0" data-tone={banner.tone === 'good' ? 'good' : undefined}>{banner.text}</p>

      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-7">
        <section aria-label={t('entries.dec.title')} className="flex flex-col">
          <h3 className="sp-sec sp-first">{t('entries.dec.team')}<small>{subtitleOf([section?.displayName, competition.name, when])}</small></h3>
          <div className="sp-card">
            <label className="sp-field">
              {t('entries.dec.teamName')}
              <input value={teamName} placeholder={t('entries.dec.teamNamePlaceholder')} maxLength={150} onChange={(e) => changed(setTeamName)(e.target.value)} />
            </label>
            {asked(config.bib) && (
              <label className="sp-field">
                {t('entries.dec.bibs')}
                <input value={bibs} placeholder={t('entries.dec.bibsPlaceholder')} maxLength={200} onChange={(e) => changed(setBibs)(e.target.value)} />
              </label>
            )}
            <RefineChoiceRow label={t('entries.dec.flag')} value={flag} options={flagOptions} onChange={changed(setFlag)} />
            <button type="button" className="sp-row" onClick={openTrainer} aria-label={t('entries.dec.trainerAria', { value: trainerLine || t('entries.dec.notSet') })}>
              <span className="sp-t1 sp-grow">{t('entries.dec.trainer')}</span>
              <span className="sp-val min-w-0 max-w-[60%] truncate">{trainerLine || t('entries.dec.add')}</span>
              <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
          {entryName && entryName.trim().toLowerCase() !== teamName.trim().toLowerCase() && (
            <p className="sp-note">{t('entries.dec.enteredAs', { name: entryName })}</p>
          )}

          {!sentBefore && savedTeams.length > 0 && (
            <div className="sp-card mt-3">
              <button type="button" className="sp-row" onClick={() => setCopyOpen(true)}>
                <Copy aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[rgb(var(--mg-heading))]" strokeWidth={2.25} />
                <span className="sp-grow">
                  <span className="sp-t1">{t('entries.dec.copyTeam')}</span>
                  <span className="sp-t2">{t('entries.dec.copyTeamHelp')}</span>
                </span>
                <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
          )}
          {copied && (
            <div className="mt-2 flex flex-col gap-2">
              <p role="status" className="sp-note m-0">Copied from {copied.label}. Check each rider before you send.</p>
              {copied.warnings.length > 0 && (
                <Notice>
                  {copied.warnings.length === 1 ? copied.warnings[0].message : (
                    <>Some riders may be too old for this section:<ul className="m-0 mt-1 list-disc pl-5">{copied.warnings.map((w) => <li key={w.slotIndex}>{w.message}</li>)}</ul></>
                  )}
                </Notice>
              )}
            </div>
          )}

          <h3 className="sp-sec">{t('entries.dec.riders')}<small>{ridersCount(slots)}</small></h3>
          <div className="sp-card" role="list" aria-label={t('entries.dec.riders')}>
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
                      {slotFlagged(rider, config) && <span className="sp-t2 font-semibold !text-[rgb(var(--mg-elim))]">{t('entries.dec.outsideLimits')}</span>}
                    </span>
                    {isReserve && <span className="sp-chip" data-tone="grey">{t('entries.dec.reserve')}</span>}
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

          <h3 className="sp-sec">{t('entries.dec.forOrganisers')}</h3>
          <div className="sp-card">
            <label className="sp-field">
              {t('entries.dec.notes')}
              <textarea value={notes} placeholder={t('entries.dec.optional')} onChange={(e) => changed(setNotes)(e.target.value)} />
            </label>
            <div className="sp-row">
              <span className="sp-grow"><span className="sp-t1">{t('entries.dec.agreeBefore')}<button type="button" onClick={() => setTermsOpen(true)} className="inline min-h-0 p-0 align-baseline font-semibold text-[rgb(var(--mg-heading))] underline underline-offset-2">{t('entries.dec.agreeTerms')}</button></span></span>
              <button type="button" role="switch" aria-checked={agreed} aria-label={t('entries.dec.agreeAria')} className="rf-sw" onClick={() => { setAgreed(!agreed); setSubmitted(false); }}><span aria-hidden="true" /></button>
            </div>
          </div>

          <div className="mt-4 flex flex-col items-stretch gap-2.5">
            <button type="button" className="kit-pill kit-pill-fill w-full" disabled={!ready || busy || submitted} onClick={() => { void submit(); }}>
              {busy ? t('entries.dec.sending') : sentBefore ? t('entries.dec.sendChanges') : t('entries.dec.send')}
            </button>
            <p aria-live="polite" className="sp-t2 m-0 text-center">{sendReason(slots, agreed, teamName, phoneIssue, sentBefore, submitted)}</p>
            {sentBefore && existing && onDelete && (
              <div className="flex justify-center"><button type="button" className="sp-red" onClick={() => onDelete(existing)}>{t('entries.dec.deleteThis')}</button></div>
            )}
          </div>
          {error && <Notice actionLabel={t('common.tryAgain')} onAction={() => { void submit(); }} actionDisabled={busy}>{error}</Notice>}
        </section>

        {active != null ? (
          <RiderPanel
            key={JSON.stringify([user?.id, user?.roles])}
            title={panelTitle(slots, active)}
            reserve={reserve}
            editing={editing}
            form={form}
            choices={choices}
            addLabel={editing ? t('entries.dec.save') : reserve ? t('entries.dec.addReserveBtn') : t('entries.dec.addRiderBtn')}
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
            onCommit={commit}
            onClose={close}
            onRemove={() => clear(active)}
          />
        ) : (
          <section aria-label={t('entries.dec.nextStep')} className="hidden flex-col items-start gap-3 rounded-xl border-[1.5px] border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-surface))] p-6 lg:flex">
            <CircleCheck aria-hidden="true" className="h-7 w-7 text-[rgb(var(--mg-heading))]" />
            <h3 className="mg-display text-[28px] font-bold leading-none text-[rgb(var(--mg-heading))]">{full ? t('entries.dec.teamComplete') : t('entries.dec.pickSlot')}</h3>
            <p className="text-base leading-snug text-[rgb(var(--mg-body))]">
              {full ? t('entries.dec.teamCompleteHelp') : t('entries.dec.pickSlotHelp')}
            </p>
          </section>
        )}
      </div>

      {toast.node}
      {termsOpen && <TermsDialog termsText={competition.termsText} onClose={() => setTermsOpen(false)} />}
      {copyOpen && (
        <Sheet title={t('entries.dec.copyTeam')} description={t('entries.dec.copySheetHelp')} onClose={() => setCopyOpen(false)}>
          {({ close: closeSheet }) => (
            <div className="sp-card" role="list" aria-label={t('entries.dec.previousTeams')}>
              {savedTeams.map((saved) => (
                <div key={`${saved.competitionId}-${saved.teamId}`} role="listitem">
                  <button type="button" className="sp-row" onClick={() => closeSheet(() => { setCopyOpen(false); void copyTeam(saved); })}>
                    <span className="sp-grow">
                      <span className="sp-t1">{savedTeamSummaryLabel(saved)}</span>
                      {saved.submittedAt && <span className="sp-t2">{t('entries.dec.sentOn', { date: new Date(saved.submittedAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) })}</span>}
                    </span>
                    <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Sheet>
      )}
      {trainerOpen && (
        <Sheet title={t('entries.dec.trainer')} onClose={() => setTrainerOpen(false)} initialFocus="#dec-trainer-name">
          {({ close: closeSheet }) => (
            <form className="kit-sheet-inner" onSubmit={(e) => { e.preventDefault(); if (trainerDraft.name.trim() && !trainerPhoneBad) closeSheet(saveTrainer); }}>
              <label className="kit-sheet-field" htmlFor="dec-trainer-name">
                {t('entries.dec.trainerName')}
                <input id="dec-trainer-name" value={trainerDraft.name} autoComplete="name" maxLength={200} onChange={(e) => setTrainerDraft({ ...trainerDraft, name: e.target.value })} />
              </label>
              {asked(config.trainerPhone) && (
                <label className="kit-sheet-field" htmlFor="dec-trainer-phone">
                  {t('entries.dec.trainerPhone')}
                  <input id="dec-trainer-phone" type="tel" value={trainerDraft.phone} autoComplete="tel" placeholder="07700 900000" aria-invalid={trainerPhoneBad}
                    onChange={(e) => setTrainerDraft({ ...trainerDraft, phone: e.target.value })} />
                </label>
              )}
              {trainerPhoneBad && <Notice>{phoneProblem(trainerDraft.phone, config)}</Notice>}
              <div className="kit-acts">
                <button type="submit" className="kit-pill kit-pill-fill" disabled={!trainerDraft.name.trim() || trainerPhoneBad}>{t('entries.dec.done')}</button>
              </div>
            </form>
          )}
        </Sheet>
      )}
    </div>
  );
}
