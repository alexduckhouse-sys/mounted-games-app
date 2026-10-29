import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { CardDropdownRow } from '../components/CardDropdownRow';
import { usePageHeader } from '../components/CompactPageBarContext';
import { DemoPaymentNotice } from '../components/DemoPaymentNotice';
import { Notice } from '../components/Notice';
import { PageSkeleton } from '../components/Skeletons';
import { apiErrorMessage } from '../lib/apiError';
import {
  BUSINESS_TYPES, REGIONS, SCHEDULES, bankLine, businessTypeLabel, regionLabel, scheduleLabel, bankProblems, digitsOnly, emptyBank, formFrom, formatIban, formatSortCode,
  needsRegistrationNumber, payoutStatusLine, registrationLabel, stepProblems,
  type BankForm, type PayoutForm, type Problems,
} from '../lib/payouts';
import { useT } from '../i18n/LanguageContext';
import type { Club, ClubPayouts, PayoutRegion } from '../types';
import { FormSheet, SheetField } from './clubShop/ui';
import '../components/sitePages.css';
import './clubShop/clubShop.css';

/** The shape the API's validation errors come in: `{ message, errors: { field: message } }`. */
function fieldErrors(err: unknown): Problems {
  const errors = (err as { response?: { data?: { errors?: unknown } } } | null)?.response?.data?.errors;
  if (!errors || typeof errors !== 'object') return {};
  return Object.fromEntries(Object.entries(errors).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

function isPayouts(value: unknown): value is ClubPayouts {
  const v = value as Partial<ClubPayouts> | null;
  return !!v && typeof v.clubId === 'number' && typeof v.status === 'number' && Array.isArray(v.missing);
}

type SheetName = 'legal' | 'person' | 'statement' | 'bank';

/** What a failed save hands back to the sheet: the API's field problems, or one message. */
interface SaveFailure { problems: Problems; message: string | null }

const regionText = (region: PayoutRegion) => {
  const found = REGIONS.find((r) => r.value === region);
  return found ? `${regionLabel(found.value)} (${found.currency === 'GBP' ? '£' : '€'})` : '';
};

/**
 * A club's payout set-up on one page: who gets paid, and where the money goes. Each row saves what the matching
 * step of the old wizard saved. It's a stand-in for a payment provider's onboarding: nothing is verified and no
 * money moves yet. Bank numbers are typed here, sent once and never shown again; only the masked version comes back.
 */
export function PayoutsPage() {
  const t = useT();
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole('Admin');
  const [clubs, setClubs] = useState<Club[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const clubId = isAdmin ? picked ?? user?.clubId ?? null : user?.clubId ?? null;
  const [data, setData] = useState<ClubPayouts | null>(null);
  const [loadFailed, setLoadFailed] = useState<number | null>(null);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const current = data && data.clubId === clubId ? data : null;
  usePageHeader({ title: t('acct.payouts.title'), subtitle: current?.clubName ?? user?.clubName ?? undefined, plain: true, backTo: '/me', backLabel: t('acct.members.back') });

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    api.get<Club[]>('/clubs').then((r) => { if (!cancelled && Array.isArray(r.data)) setClubs(r.data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [isAdmin]);

  useEffect(() => {
    if (clubId == null) return;
    let cancelled = false;
    api.get<ClubPayouts>(`/clubs/${clubId}/payouts`).then(({ data: d }) => {
      if (cancelled) return;
      if (!isPayouts(d)) throw new Error('unexpected response');
      setData(d);
      setLoadFailed(null);
    }).catch(() => { if (!cancelled) setLoadFailed(clubId); });
    return () => { cancelled = true; };
  }, [clubId, attempt]);

  if (!user) return null;

  /** Once every detail is in, finish the set-up: there is no separate Finish button any more. */
  async function adopt(d: ClubPayouts) {
    setData(d);
    if (d.missing.length > 0 || d.status === 2) return;
    try {
      const { data: finished } = await api.post<ClubPayouts>(`/clubs/${d.clubId}/payouts/finish`);
      setData(finished);
    } catch (err) {
      setNotice(apiErrorMessage(err, t('acct.payouts.finishFail')));
    }
  }

  /** Saves some of the details. Returns null when it worked, or what went wrong. */
  async function save(body: object): Promise<SaveFailure | null> {
    if (clubId == null) return { problems: {}, message: t('acct.payouts.chooseFirst') };
    setNotice(null);
    try {
      const { data: d } = await api.put<ClubPayouts>(`/clubs/${clubId}/payouts`, body);
      await adopt(d);
      return null;
    } catch (err) {
      const problems = fieldErrors(err);
      return { problems, message: Object.keys(problems).length > 0 ? null : apiErrorMessage(err, t('acct.payouts.saveFail')) };
    }
  }

  async function saveBank(form: BankForm, region: PayoutRegion): Promise<SaveFailure | null> {
    if (clubId == null) return { problems: {}, message: t('acct.payouts.chooseFirst') };
    setNotice(null);
    try {
      const body = region === 0
        ? { accountHolder: form.accountHolder, sortCode: form.sortCode, accountNumber: form.accountNumber }
        : { accountHolder: form.accountHolder, iban: form.iban, bic: form.bic || null };
      const { data: d } = await api.put<ClubPayouts>(`/clubs/${clubId}/payouts/bank`, body);
      await adopt(d);
      return null;
    } catch (err) {
      const problems = fieldErrors(err);
      return { problems, message: Object.keys(problems).length > 0 ? null : apiErrorMessage(err, t('acct.payouts.bankFail')) };
    }
  }

  /** A choice made straight from a row: saved at once, with the reason shown on the page if it fails. */
  async function choose(body: object) {
    const failure = await save(body);
    if (failure) setNotice(failure.message ?? Object.values(failure.problems)[0] ?? t('acct.payouts.cantSave'));
  }

  const status = current ? payoutStatusLine(current) : null;

  return (
    <div className="skin cs-page">
      <h1 className="sr-only">{t('acct.payouts.title')}</h1>

      {isAdmin && (
        <div className="sp-card">
          <CardDropdownRow label={t('acct.payouts.club')} value={clubId == null ? '' : String(clubId)}
            options={[{ value: '', label: t('acct.payouts.chooseClub') }, ...clubs.map((c) => ({ value: String(c.id), label: c.name }))]}
            onChange={(value) => { setPicked(value ? Number(value) : null); setData(null); setSheet(null); setNotice(null); }} />
        </div>
      )}

      {clubId == null && !isAdmin && <p className="sp-note">{t('acct.payouts.noClub')}</p>}
      {clubId != null && !current && (
        <div className="cs-gap">
          {loadFailed === clubId
            ? <Notice actionLabel={t('acct.members.tryAgain')} onAction={() => { setLoadFailed(null); setAttempt((n) => n + 1); }}>{t('acct.payouts.loadFail')}</Notice>
            : <PageSkeleton />}
        </div>
      )}
      {notice && <div className="cs-gap"><Notice>{notice}</Notice></div>}

      {current && status && (
        <>
          <p role="status" className="cs-status" data-tone={status.ready ? 'good' : 'warn'}>{status.text}</p>

          <DemoPaymentNotice what="payout" />

          <h2 className="sp-sec">{t('acct.payouts.whoSection')}</h2>
          <div className="sp-card">
            <CardDropdownRow label={t('acct.payouts.paidTo')} value={current.businessType == null ? '' : String(current.businessType)}
              options={[...(current.businessType == null ? [{ value: '', label: t('acct.payouts.choose') }] : []), ...BUSINESS_TYPES.map((type) => ({ value: String(type), label: businessTypeLabel(type), hint: undefined }))]}
              onChange={(value) => { if (value !== '' && Number(value) !== current.businessType) void choose({ businessType: Number(value) }); }} />
            <CardDropdownRow label={t('acct.payouts.country')} value={String(current.region)}
              options={REGIONS.map((r) => ({ value: String(r.value), label: regionText(r.value) }))}
              onChange={(value) => { if (Number(value) !== current.region) void choose({ region: Number(value) }); }} />
            <DetailRow label={t('acct.payouts.legalRow')} value={current.legalName} onOpen={() => setSheet('legal')} />
            <DetailRow label={t('acct.payouts.personRow')} value={current.personFullName} onOpen={() => setSheet('person')} />
          </div>

          <h2 className="sp-sec">{t('acct.payouts.moneySection')}</h2>
          <div className="sp-card">
            <DetailRow label={t('acct.payouts.bankRow')} value={bankLine(current.bank)} onOpen={() => setSheet('bank')} />
            <DetailRow label={t('acct.payouts.statementRow')} value={current.statementDescriptor} onOpen={() => setSheet('statement')} />
            <CardDropdownRow label={t('acct.payouts.scheduleRow')} value={String(current.schedule)}
              options={SCHEDULES.map((s) => ({ value: String(s), label: scheduleLabel(s) }))}
              onChange={(value) => { if (Number(value) !== current.schedule) void choose({ schedule: Number(value) }); }} />
          </div>

          <p className="sp-note">{t('acct.payouts.online')}</p>

          {sheet === 'legal' && <LegalSheet data={current} save={save} onClose={() => setSheet(null)} />}
          {sheet === 'person' && <PersonSheet data={current} save={save} onClose={() => setSheet(null)} />}
          {sheet === 'statement' && <StatementSheet data={current} save={save} onClose={() => setSheet(null)} />}
          {sheet === 'bank' && <BankSheet data={current} save={saveBank} onClose={() => setSheet(null)} />}
        </>
      )}
    </div>
  );
}

/** A settings row that opens a sheet. A missing value shows a red "Add". */
function DetailRow({ label, value, onOpen }: { label: string; value: string | null; onOpen: () => void }) {
  const t = useT();
  return (
    <button type="button" className="sp-row" onClick={onOpen}>
      <span className="sp-t1 sp-grow">{label}</span>
      <span className="sp-val" data-tone={value ? undefined : 'bad'}>
        <span className="cs-ellip">{value || t('acct.payouts.add')}</span>
        <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
      </span>
    </button>
  );
}

interface SheetProps { data: ClubPayouts; save: (body: object) => Promise<SaveFailure | null>; onClose: () => void }

/** Keeps a sheet's draft, problems and the page's save in one place. */
function useDraft<T extends object>(initial: T, check: (draft: T) => Problems, save: (draft: T) => Promise<SaveFailure | null>) {
  const [draft, setDraft] = useState<T>(initial);
  const [problems, setProblems] = useState<Problems>({});
  const [message, setMessage] = useState<string | null>(null);
  const set = <K extends keyof T>(key: K, value: T[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setProblems((p) => { const next = { ...p }; delete next[key as string]; return next; });
  };
  async function submit(): Promise<boolean> {
    const bad = check(draft);
    if (Object.keys(bad).length > 0) { setProblems(bad); return false; }
    const failure = await save(draft);
    if (!failure) return true;
    setProblems(failure.problems);
    setMessage(failure.message);
    return false;
  }
  return { draft, set, problems, message, submit };
}

const LEGAL_KEYS = ['legalName', 'tradingName', 'addressLine1', 'addressLine2', 'city', 'postcode', 'contactEmail', 'contactPhone', 'registrationNumber', 'vatNumber'] as const;
type LegalDraft = Pick<PayoutForm, typeof LEGAL_KEYS[number]>;

function LegalSheet({ data, save, onClose }: SheetProps) {
  const t = useT();
  const form = formFrom(data);
  const { draft, set, problems, message, submit } = useDraft<LegalDraft>(
    Object.fromEntries(LEGAL_KEYS.map((k) => [k, form[k]])) as LegalDraft,
    (d) => stepProblems(2, { ...form, ...d }, new Date()),
    save,
  );
  const regNeeded = needsRegistrationNumber(data.businessType);
  const box = (key: keyof LegalDraft, label: string, extra: { optional?: boolean; type?: string; inputMode?: 'email' | 'tel'; autoComplete?: string; placeholder?: string; upper?: boolean } = {}) => (
    <SheetField label={extra.optional ? t('acct.payouts.optional', { label }) : label} error={problems[key]}>
      <input type={extra.type ?? 'text'} inputMode={extra.inputMode} autoComplete={extra.autoComplete ?? 'off'} placeholder={extra.placeholder} value={draft[key]}
        aria-invalid={!!problems[key] || undefined} onChange={(e) => set(key, extra.upper ? e.target.value.toUpperCase() : e.target.value)} />
    </SheetField>
  );
  return (
    <FormSheet title={t('acct.payouts.legalRow')} saveLabel={t('acct.payouts.done')} onClose={onClose} onSave={submit} error={message}>
      {box('legalName', t('acct.payouts.legalName'), { autoComplete: 'organization' })}
      {box('tradingName', t('acct.payouts.tradingName'), { optional: true })}
      {box('addressLine1', t('acct.payouts.address1'), { autoComplete: 'address-line1' })}
      {box('addressLine2', t('acct.payouts.address2'), { optional: true, autoComplete: 'address-line2' })}
      {box('city', t('acct.payouts.city'), { autoComplete: 'address-level2' })}
      {box('postcode', t('acct.payouts.postcode'), { autoComplete: 'postal-code', upper: true })}
      {box('contactEmail', t('acct.payouts.contactEmail'), { type: 'email', inputMode: 'email', autoComplete: 'email' })}
      {box('contactPhone', t('acct.payouts.contactPhone'), { type: 'tel', inputMode: 'tel', autoComplete: 'tel' })}
      {(regNeeded || draft.registrationNumber) && box('registrationNumber', registrationLabel(data.businessType), { optional: !regNeeded })}
      {box('vatNumber', t('acct.payouts.vat'), { optional: true, placeholder: data.region === 0 ? 'GB123456789' : undefined, upper: true })}
    </FormSheet>
  );
}

type PersonDraft = Pick<PayoutForm, 'personFullName' | 'personDateOfBirth'>;

function PersonSheet({ data, save, onClose }: SheetProps) {
  const t = useT();
  const form = formFrom(data);
  // Removing a saved date of birth is allowed; finishing the set-up asks for it again.
  const clearing = (d: PersonDraft) => data.personDateOfBirth != null && d.personDateOfBirth === '';
  const { draft, set, problems, message, submit } = useDraft<PersonDraft>(
    { personFullName: form.personFullName, personDateOfBirth: form.personDateOfBirth },
    (d) => {
      const bad = stepProblems(3, { ...form, ...d }, new Date());
      if (clearing(d)) delete bad.personDateOfBirth;
      return bad;
    },
    (d) => save({ personFullName: d.personFullName, personDateOfBirth: d.personDateOfBirth === '' ? null : d.personDateOfBirth, ...(clearing(d) ? { clearPersonDateOfBirth: true } : {}) }),
  );
  return (
    <FormSheet title={t('acct.payouts.personRow')} description={t('acct.payouts.personDesc')} saveLabel={t('acct.payouts.done')} onClose={onClose} onSave={submit} error={message}>
      <SheetField label={t('acct.payouts.fullName')} error={problems.personFullName}>
        <input autoComplete="name" value={draft.personFullName} aria-invalid={!!problems.personFullName || undefined} onChange={(e) => set('personFullName', e.target.value)} />
      </SheetField>
      <SheetField label={t('acct.payouts.dob')} error={problems.personDateOfBirth}>
        <input type="date" autoComplete="bday" value={draft.personDateOfBirth} aria-invalid={!!problems.personDateOfBirth || undefined} onChange={(e) => set('personDateOfBirth', e.target.value)} />
      </SheetField>
    </FormSheet>
  );
}

function StatementSheet({ data, save, onClose }: SheetProps) {
  const t = useT();
  const form = formFrom(data);
  const { draft, set, problems, message, submit } = useDraft<{ statementDescriptor: string }>(
    { statementDescriptor: form.statementDescriptor },
    (d) => stepProblems(5, { ...form, ...d }, new Date()),
    save,
  );
  return (
    <FormSheet title={t('acct.payouts.statementRow')} description={t('acct.payouts.statementDesc')} saveLabel={t('acct.payouts.done')} onClose={onClose} onSave={submit} error={message}>
      <SheetField label={t('acct.payouts.name')} error={problems.statementDescriptor}>
        <input maxLength={22} value={draft.statementDescriptor} aria-invalid={!!problems.statementDescriptor || undefined}
          onChange={(e) => set('statementDescriptor', e.target.value.replace(/[^A-Za-z0-9 ]/g, '').toUpperCase())} />
      </SheetField>
    </FormSheet>
  );
}

function BankSheet({ data, save, onClose }: { data: ClubPayouts; save: (form: BankForm, region: PayoutRegion) => Promise<SaveFailure | null>; onClose: () => void }) {
  const t = useT();
  const region = data.region;
  const { draft, set, problems, message, submit } = useDraft<BankForm>(emptyBank, (d) => bankProblems(d, region), (d) => save(d, region));
  return (
    <FormSheet title={t('acct.payouts.bankRow')} description={data.bank ? t('acct.payouts.bankNow', { bank: bankLine(data.bank) }) : t('acct.payouts.bankDesc')} saveLabel={t('acct.payouts.save')} onClose={onClose} onSave={submit} error={message}>
      <SheetField label={t('acct.payouts.holder')} error={problems.accountHolder}>
        <input value={draft.accountHolder} aria-invalid={!!problems.accountHolder || undefined} onChange={(e) => set('accountHolder', e.target.value)} />
      </SheetField>
      {region === 0 ? (
        <>
          <SheetField label={t('acct.payouts.sortCode')} error={problems.sortCode}>
            <input inputMode="numeric" placeholder="12-34-56" maxLength={8} value={draft.sortCode} aria-invalid={!!problems.sortCode || undefined} onChange={(e) => set('sortCode', formatSortCode(e.target.value))} />
          </SheetField>
          <SheetField label={t('acct.payouts.accountNumber')} error={problems.accountNumber}>
            <input inputMode="numeric" placeholder={t('acct.payouts.eightDigits')} maxLength={8} value={draft.accountNumber} aria-invalid={!!problems.accountNumber || undefined} onChange={(e) => set('accountNumber', digitsOnly(e.target.value, 8))} />
          </SheetField>
        </>
      ) : (
        <>
          <SheetField label={t('acct.payouts.iban')} error={problems.iban}>
            <input placeholder="IE29 AIBK 9311 5212 3456 78" value={draft.iban} aria-invalid={!!problems.iban || undefined} onChange={(e) => set('iban', formatIban(e.target.value))} />
          </SheetField>
          <SheetField label={t('acct.payouts.bicOptional')} error={problems.bic}>
            <input value={draft.bic} aria-invalid={!!problems.bic || undefined} onChange={(e) => set('bic', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))} />
          </SheetField>
        </>
      )}
    </FormSheet>
  );
}
