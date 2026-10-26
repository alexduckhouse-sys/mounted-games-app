import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ChevronLeft, FlaskConical } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Dropdown } from '../components/Dropdown';
import { Notice } from '../components/Notice';
import { PageSkeleton } from '../components/Skeletons';
import { apiErrorMessage } from '../lib/apiError';
import {
  BUSINESS_TYPES, REGIONS, SCHEDULES, STEPS, bankLine, bankProblems, businessTypeLabel, digitsOnly, emptyBank, firstOpenStep, formFrom,
  formatIban, formatSortCode, friendlyDate, needsRegistrationNumber, regionLabel, registrationLabel, scheduleLabel, stepOfField, stepProblems,
  type BankForm, type PayoutForm, type Problems,
} from '../lib/payouts';
import type { Club, ClubPayouts, PayoutRegion } from '../types';
import { Field } from './auth/Field';

/** The shape the API's validation errors come in: `{ message, errors: { field: message } }`. */
function fieldErrors(err: unknown): Problems {
  const errors = (err as { response?: { data?: { errors?: unknown } } } | null)?.response?.data?.errors;
  if (!errors || typeof errors !== 'object') return {};
  return Object.fromEntries(Object.entries(errors).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

function withoutKey(problems: Problems, key: string): Problems {
  if (!(key in problems)) return problems;
  const next = { ...problems };
  delete next[key];
  return next;
}

function isPayouts(value: unknown): value is ClubPayouts {
  const v = value as Partial<ClubPayouts> | null;
  return !!v && typeof v.clubId === 'number' && typeof v.status === 'number' && Array.isArray(v.missing);
}

/**
 * A club's payout set-up, shaped like the onboarding a payment provider would show (Stripe Connect Express).
 * It's a mock: nothing is verified and no money moves yet. Bank numbers are typed here, sent once and never
 * shown again; only the masked version comes back.
 */
export function PayoutsPage() {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole('Admin');
  const [clubs, setClubs] = useState<Club[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const clubId = isAdmin ? picked ?? user?.clubId ?? null : user?.clubId ?? null;
  const [data, setData] = useState<ClubPayouts | null>(null);
  const [loadFailed, setLoadFailed] = useState<number | null>(null);
  const [form, setForm] = useState<PayoutForm | null>(null);
  const [bank, setBank] = useState<BankForm>(emptyBank);
  const [changingBank, setChangingBank] = useState(false);
  const [step, setStep] = useState(1);
  const [problems, setProblems] = useState<Problems>({});
  const [notice, setNotice] = useState<{ text: string; retry: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

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
      setForm(formFrom(d));
      setStep(firstOpenStep(d));
      setLoadFailed(null);
    }).catch(() => { if (!cancelled) setLoadFailed(clubId); });
    return () => { cancelled = true; };
  }, [clubId, attempt]);

  if (!user) return null;
  const current = data && data.clubId === clubId ? data : null;
  const region = (form?.region ?? 0) as PayoutRegion;

  function set<K extends keyof PayoutForm>(key: K, value: PayoutForm[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setProblems((p) => withoutKey(p, key));
  }
  function setBankField<K extends keyof BankForm>(key: K, value: string) {
    setBank((b) => ({ ...b, [key]: value }));
    setProblems((p) => withoutKey(p, key));
  }
  function adopt(d: ClubPayouts) {
    setData(d);
    setForm(formFrom(d));
  }
  function go(to: number) { setStep(to); setProblems({}); setNotice(null); }

  const fieldsFor: Record<1 | 2 | 3 | 5, (keyof PayoutForm)[]> = {
    1: ['businessType', 'region'],
    2: ['legalName', 'tradingName', 'addressLine1', 'addressLine2', 'city', 'postcode', 'contactEmail', 'contactPhone', 'registrationNumber', 'vatNumber'],
    3: ['personFullName', 'personDateOfBirth'],
    5: ['statementDescriptor', 'schedule'],
  };

  async function next() {
    if (!form || clubId == null || busy) return;
    setNotice(null);
    if (step === 4) {
      if (current?.bank && !changingBank) { go(5); return; }
      const bad = bankProblems(bank, region);
      if (Object.keys(bad).length > 0) { setProblems(bad); return; }
      setBusy(true);
      try {
        const body = region === 0
          ? { accountHolder: bank.accountHolder, sortCode: bank.sortCode, accountNumber: bank.accountNumber }
          : { accountHolder: bank.accountHolder, iban: bank.iban, bic: bank.bic || null };
        const { data: d } = await api.put<ClubPayouts>(`/clubs/${clubId}/payouts/bank`, body);
        adopt(d);
        setBank(emptyBank); // The numbers were sent once. Don't keep them.
        setChangingBank(false);
        go(5);
      } catch (err) {
        const errors = fieldErrors(err);
        setProblems(errors);
        setNotice(Object.keys(errors).length > 0 ? null : { text: apiErrorMessage(err, 'Couldn’t save the bank account. Check your signal and try again.'), retry: true });
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step === 6) { await finish(); return; }
    const detailStep = step as 1 | 2 | 3 | 5;
    const clearingDateOfBirth = detailStep === 3 && current?.personDateOfBirth != null && form.personDateOfBirth === '';
    const bad = stepProblems(detailStep, form, new Date());
    // Removing a saved date is allowed; finishing payout setup will require it again.
    if (clearingDateOfBirth) delete bad.personDateOfBirth;
    if (Object.keys(bad).length > 0) { setProblems(bad); return; }
    setBusy(true);
    try {
      const body = {
        ...Object.fromEntries(fieldsFor[detailStep].map((k) => [k, form[k] === '' && k === 'personDateOfBirth' ? null : form[k]])),
        ...(clearingDateOfBirth ? { clearPersonDateOfBirth: true } : {}),
      };
      const { data: d } = await api.put<ClubPayouts>(`/clubs/${clubId}/payouts`, body);
      adopt(d);
      go(step + 1);
    } catch (err) {
      const errors = fieldErrors(err);
      setProblems(errors);
      setNotice(Object.keys(errors).length > 0 ? null : { text: apiErrorMessage(err, 'Couldn’t save the payout details. Check your signal and try again.'), retry: true });
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    try {
      const { data: d } = await api.post<ClubPayouts>(`/clubs/${clubId}/payouts/finish`);
      adopt(d);
      setProblems({});
    } catch (err) {
      const errors = fieldErrors(err);
      setProblems(errors);
      const keys = Object.keys(errors);
      setNotice(keys.length ? { text: 'Some details are missing. Fix them to finish.', retry: false } : { text: apiErrorMessage(err, 'Couldn’t finish. Check your signal and try again.'), retry: true });
    } finally {
      setBusy(false);
    }
  }

  const ready = current?.status === 2;
  const last = step === 6;

  return (
    <div className="flex flex-col gap-5 pt-4">
      <div className="flex items-center gap-3">
        <Link to="/me" className="mg-icon-btn" aria-label="Back to my profile"><ChevronLeft aria-hidden="true" className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="mg-display text-[26px] font-bold leading-none text-[rgb(var(--mg-heading))]">Payouts</h1>
          {(current?.clubName ?? user.clubName) && <p className="mg-meta mt-1 truncate !text-sm">{current?.clubName ?? user.clubName}</p>}
        </div>
      </div>

      <Notice tone="info" icon={FlaskConical} role={null}>
        <strong className="font-semibold">Test mode: no real money moves yet.</strong> This is how payouts will be set up once online payments are switched on. Entries are still paid for by hand.
      </Notice>

      {isAdmin && (
        <Field label="Club">
          {({ id }) => (
            <div className="mg-field">
              <select id={id} value={clubId ?? ''} onChange={(e) => { setPicked(e.target.value ? Number(e.target.value) : null); setData(null); setForm(null); setProblems({}); }}>
                <option value="">Choose a club</option>
                {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
        </Field>
      )}

      {clubId == null && !isAdmin && <p className="text-base text-[rgb(var(--mg-body))]">Payouts belong to a club. Join a club first.</p>}
      {clubId != null && !current && (loadFailed === clubId
        ? <Notice actionLabel="Try again" onAction={() => { setLoadFailed(null); setAttempt((n) => n + 1); }}>Couldn’t load the payout details. Check your signal and try again.</Notice>
        : <PageSkeleton />)}

      {current && form && (
        <>
          {ready && (
            <Notice tone="info" icon={Check}>Payouts are ready{current.bank ? ` · ${bankLine(current.bank)}` : ''}</Notice>
          )}

          <nav aria-label="Steps">
            <p className="mg-meta !text-sm">Step {step} of {STEPS.length}: <span className="font-semibold text-[rgb(var(--mg-heading))]">{STEPS[step - 1]}</span></p>
            <ol className="mt-2 grid grid-cols-6 gap-1.5">
              {STEPS.map((title, i) => (
                <li key={title} className="min-w-0">
                  <button type="button" onClick={() => go(i + 1)} aria-label={`Go to step ${i + 1}: ${title}`} aria-current={step === i + 1 ? 'step' : undefined}
                    className={`block h-2 w-full rounded-full ${step === i + 1 ? 'bg-[rgb(var(--mg-heading))]' : i + 1 < step ? 'bg-[rgb(var(--mg-button))]' : 'bg-[rgb(var(--mg-control))]'}`} />
                </li>
              ))}
            </ol>
          </nav>

          <section aria-label={STEPS[step - 1]} className="mg-card flex flex-col gap-4 p-4">
            {step === 1 && <WhoStep form={form} problems={problems} set={set} />}
            {step === 2 && <DetailsStep form={form} problems={problems} set={set} />}
            {step === 3 && <PersonStep form={form} problems={problems} set={set} />}
            {step === 4 && <BankStep data={current} region={region} bank={bank} problems={problems} changing={changingBank} setField={setBankField} change={() => setChangingBank(true)} />}
            {step === 5 && <StatementStep form={form} problems={problems} set={set} />}
            {step === 6 && <ReviewStep data={current} form={form} problems={problems} edit={go} />}
          </section>

          {notice && <Notice actionLabel={notice.retry ? 'Try again' : undefined} onAction={notice.retry ? () => { void next(); } : undefined} actionDisabled={busy}>{notice.text}</Notice>}

          <div className="flex gap-2">
            {step > 1 && <button type="button" className="mg-btn mg-btn-secondary !min-h-12 flex-1" disabled={busy} onClick={() => go(step - 1)}>Back</button>}
            <button type="button" className="mg-btn mg-btn-primary !min-h-12 flex-[2]" disabled={busy || (last && ready)} onClick={() => { void next(); }}>
              {last ? (ready ? 'Finished' : 'Finish') : 'Continue'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

interface StepProps { form: PayoutForm; problems: Problems; set: <K extends keyof PayoutForm>(key: K, value: PayoutForm[K]) => void }

function TextField({ label, value, error, onChange, optional, type = 'text', autoComplete = 'off', inputMode, placeholder, maxLength }: {
  label: string; value: string; error?: string; onChange: (value: string) => void; optional?: boolean;
  type?: string; autoComplete?: string; inputMode?: 'numeric' | 'tel' | 'email' | 'text'; placeholder?: string; maxLength?: number;
}) {
  return (
    <Field label={<>{label}{optional && <span className="font-normal text-[rgb(var(--mg-muted))]"> (optional)</span>}</>} error={error}>
      {({ id, invalid, describedBy }) => (
        <div className="mg-field !rounded-lg" data-invalid={invalid}>
          <input id={id} type={type} value={value} autoComplete={autoComplete} inputMode={inputMode} placeholder={placeholder} maxLength={maxLength}
            aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} />
        </div>
      )}
    </Field>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[rgb(var(--mg-muted))]">{children}</p>;
}

function WhoStep({ form, problems, set }: StepProps) {
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-[rgb(var(--mg-body))]">Who is being paid?</legend>
        <div role="radiogroup" aria-label="Who is being paid?" className="flex flex-col gap-2">
          {BUSINESS_TYPES.map((t) => (
            <label key={t.value} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-[1.5px] px-3.5 py-2 ${form.businessType === t.value ? 'border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-tint))]' : 'border-[rgb(var(--mg-control))]'}`}>
              <input type="radio" name="business-type" className="h-5 w-5 shrink-0" checked={form.businessType === t.value} onChange={() => set('businessType', t.value)} />
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold leading-tight">{t.label}</span>
                <span className="block text-sm text-[rgb(var(--mg-muted))]">{t.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {problems.businessType && <span role="alert" className="text-sm font-medium text-[rgb(var(--mg-elim))]">{problems.businessType}</span>}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <span id="payout-region" className="text-sm font-semibold text-[rgb(var(--mg-body))]">Where is it based?</span>
        <div role="group" aria-labelledby="payout-region" className="mg-seg !grid-cols-2">
          {REGIONS.map((r) => (
            <button key={r.value} type="button" aria-pressed={form.region === r.value} onClick={() => set('region', r.value)}>{r.label} ({r.currency})</button>
          ))}
        </div>
        <Hint>This sets the currency and the kind of bank details we ask for.</Hint>
      </div>
    </>
  );
}

function DetailsStep({ form, problems, set }: StepProps) {
  const regNeeded = needsRegistrationNumber(form.businessType);
  return (
    <>
      <TextField label="Legal name" value={form.legalName} error={problems.legalName} onChange={(v) => set('legalName', v)} autoComplete="organization" />
      <TextField label="Trading name" optional value={form.tradingName} error={problems.tradingName} onChange={(v) => set('tradingName', v)} />
      <TextField label="Address line 1" value={form.addressLine1} error={problems.addressLine1} onChange={(v) => set('addressLine1', v)} autoComplete="address-line1" />
      <TextField label="Address line 2" optional value={form.addressLine2} error={problems.addressLine2} onChange={(v) => set('addressLine2', v)} autoComplete="address-line2" />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Town or city" value={form.city} error={problems.city} onChange={(v) => set('city', v)} autoComplete="address-level2" />
        <TextField label="Postcode" value={form.postcode} error={problems.postcode} onChange={(v) => set('postcode', v.toUpperCase())} autoComplete="postal-code" />
      </div>
      <TextField label="Contact email" type="email" inputMode="email" value={form.contactEmail} error={problems.contactEmail} onChange={(v) => set('contactEmail', v)} autoComplete="email" />
      <TextField label="Contact phone" type="tel" inputMode="tel" value={form.contactPhone} error={problems.contactPhone} onChange={(v) => set('contactPhone', v)} autoComplete="tel" />
      {(regNeeded || form.registrationNumber) && (
        <TextField label={registrationLabel(form.businessType)} optional={!regNeeded} value={form.registrationNumber} error={problems.registrationNumber} onChange={(v) => set('registrationNumber', v)} />
      )}
      <TextField label="VAT number" optional placeholder={form.region === 0 ? 'GB123456789' : undefined} value={form.vatNumber} error={problems.vatNumber} onChange={(v) => set('vatNumber', v.toUpperCase())} />
    </>
  );
}

function PersonStep({ form, problems, set }: StepProps) {
  return (
    <>
      <Hint>Payment providers have to know who is responsible for the account. We only ask for what they need, and only the club&rsquo;s managers can see it.</Hint>
      <TextField label="Full name" value={form.personFullName} error={problems.personFullName} onChange={(v) => set('personFullName', v)} autoComplete="name" />
      <TextField label="Date of birth" type="date" autoComplete="bday" value={form.personDateOfBirth} error={problems.personDateOfBirth} onChange={(v) => set('personDateOfBirth', v)} />
    </>
  );
}

function BankStep({ data, region, bank, problems, changing, setField, change }: {
  data: ClubPayouts; region: PayoutRegion; bank: BankForm; problems: Problems; changing: boolean;
  setField: (key: keyof BankForm, value: string) => void; change: () => void;
}) {
  if (data.bank && !changing) {
    return (
      <>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold">{bankLine(data.bank)}</div>
            <div className="text-sm text-[rgb(var(--mg-muted))]">{data.bank.accountHolder}{data.bank.sortCode ? ` · sort code ${data.bank.sortCode}` : ''}</div>
          </div>
          <button type="button" className="mg-btn mg-btn-secondary !min-h-11 !px-4" onClick={change}>Change</button>
        </div>
        <Hint>Sort code and last 4 digits only — share full payment details on your entry page or invoice.</Hint>
      </>
    );
  }
  return (
    <>
      <Hint>Sort code and last 4 digits only — share full payment details on your entry page or invoice. We check the numbers, keep only the last four digits and never show the full number again.</Hint>
      <TextField label="Name on the account" value={bank.accountHolder} error={problems.accountHolder} onChange={(v) => setField('accountHolder', v)} />
      {region === 0 ? (
        <>
          <TextField label="Sort code" inputMode="numeric" placeholder="12-34-56" value={bank.sortCode} error={problems.sortCode} onChange={(v) => setField('sortCode', formatSortCode(v))} maxLength={8} />
          <TextField label="Account number" inputMode="numeric" placeholder="8 digits" value={bank.accountNumber} error={problems.accountNumber} onChange={(v) => setField('accountNumber', digitsOnly(v, 8))} maxLength={8} />
        </>
      ) : (
        <>
          <TextField label="IBAN" value={bank.iban} error={problems.iban} onChange={(v) => setField('iban', formatIban(v))} placeholder="IE29 AIBK 9311 5212 3456 78" />
          <TextField label="BIC" optional value={bank.bic} error={problems.bic} onChange={(v) => setField('bic', v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))} />
        </>
      )}
    </>
  );
}

function StatementStep({ form, problems, set }: StepProps) {
  const shown = SCHEDULES.find((s) => s.value === form.schedule);
  return (
    <>
      <TextField label="Statement descriptor" value={form.statementDescriptor} error={problems.statementDescriptor} maxLength={22}
        onChange={(v) => set('statementDescriptor', v.replace(/[^A-Za-z0-9 ]/g, '').toUpperCase())} />
      <Hint>This is what riders&rsquo; bank statements will show. Use 5 to 22 letters, numbers or spaces.</Hint>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-[rgb(var(--mg-body))]">Payout schedule</span>
        <Dropdown label="Payout schedule" value={String(form.schedule)} options={SCHEDULES.map((s) => ({ value: String(s.value), label: s.label, hint: s.hint }))}
          onChange={(v) => set('schedule', Number(v) as PayoutForm['schedule'])}
          buttonClassName="flex min-h-11 w-full items-center gap-2 rounded-[10px] border-[1.5px] border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))] px-3 text-left text-[15px] font-medium">
          <span className="min-w-0 flex-1 truncate">{shown?.label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
        </Dropdown>
      </div>
    </>
  );
}

function ReviewStep({ data, form, problems, edit }: { data: ClubPayouts; form: PayoutForm; problems: Problems; edit: (step: number) => void }) {
  const missing = Object.keys(problems).length > 0 ? Object.keys(problems) : data.status === 2 ? [] : data.missing;
  const address = [form.addressLine1, form.addressLine2, form.city, form.postcode].filter(Boolean).join(', ');
  const rows: { step: number; label: string; value: string; keys: string[] }[] = [
    { step: 1, label: 'Paid to', value: [businessTypeLabel(form.businessType), `${regionLabel(form.region)} (${data.currency})`].filter(Boolean).join(' · '), keys: ['businessType'] },
    { step: 2, label: 'Legal name', value: form.legalName, keys: ['legalName'] },
    { step: 2, label: 'Address', value: address, keys: ['addressLine1', 'city', 'postcode'] },
    { step: 2, label: 'Contact', value: [form.contactEmail, form.contactPhone].filter(Boolean).join(' · '), keys: ['contactEmail', 'contactPhone'] },
    ...(needsRegistrationNumber(form.businessType) ? [{ step: 2, label: registrationLabel(form.businessType), value: form.registrationNumber, keys: ['registrationNumber'] }] : []),
    { step: 3, label: 'Responsible person', value: [form.personFullName, friendlyDate(form.personDateOfBirth)].filter(Boolean).join(' · '), keys: ['personFullName', 'personDateOfBirth'] },
    { step: 4, label: 'Bank account', value: bankLine(data.bank), keys: ['bank'] },
    { step: 5, label: 'Statement', value: form.statementDescriptor, keys: ['statementDescriptor'] },
    { step: 5, label: 'Payouts', value: scheduleLabel(form.schedule), keys: [] },
  ];
  return (
    <>
      <dl className="flex flex-col divide-y divide-[rgb(var(--mg-rule-soft))]">
        {rows.map((row) => {
          const wrong = row.keys.some((k) => missing.includes(k));
          return (
            <div key={row.label} className="flex items-start gap-3 py-2.5 first:pt-0">
              <div className="min-w-0 flex-1">
                <dt className="text-sm text-[rgb(var(--mg-muted))]">{row.label}</dt>
                <dd className={`break-words text-base font-medium ${wrong ? 'text-[rgb(var(--mg-elim))]' : ''}`}>{row.value || (wrong ? 'Needs attention' : 'Not set')}</dd>
              </div>
              <button type="button" className="mg-text-link min-h-11 px-1 text-[15px] font-semibold" onClick={() => edit(row.step)} aria-label={`Edit ${row.label.toLowerCase()}`}>Edit</button>
            </div>
          );
        })}
      </dl>
      {missing.length > 0 && (
        <Notice role={null}>
          Still to do: {[...new Set(missing.map(stepOfField))].sort().map((n) => STEPS[n - 1].toLowerCase()).join(', ')}.
        </Notice>
      )}
    </>
  );
}
