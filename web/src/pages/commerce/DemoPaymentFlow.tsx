import { motion, useReducedMotion } from 'framer-motion';
import { CreditCard, Lock, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { RefineFoot, RefineHeader, RefinePage } from '../refine/Refine';
import { newIdempotencyKey, pounds } from './commerceFormat';
import { TestReceipt } from './commerceUi';
import { CountUp } from '../../components/stream/CountUp';
import type { FakePaymentOutcome, TestPayment, TestPaymentStatus } from './types';
import './demoPayment.css';

type Step = 'review' | 'details' | 'processing' | 'result';

export interface DemoPaymentFlowProps {
  targetKey: string;
  title: string;
  amountMinor: number;
  initialPayment?: TestPayment | null;
  canPay?: boolean;
  onPay: (outcome: FakePaymentOutcome, idempotencyKey: string) => Promise<TestPayment>;
  onPayment?: (payment: TestPayment) => void;
  /** `page` is the full-screen checkout: own header, test details filled in, a result toggle and a sticky Pay button. */
  variant?: 'inline' | 'page';
  /** Page variant: small text in the header's top row while paying, e.g. '2 items · £17.00'. */
  context?: string;
  onBack?: () => void;
  backLabel?: string;
  /** Page variant: header title and context once there is a result. */
  approvedTitle?: string;
  resultContext?: string;
  /** Page variant: everything under the result header. Use OutcomeState for the icon and wording. */
  renderResult?: (result: { payment: TestPayment; retry: () => void }) => ReactNode;
  /** Page variant: how long the padlock screen shows at least, so a fast reply doesn't flash by. */
  minProcessingMs?: number;
}

const SUCCESS_CARD = '4242424242424242';
const DECLINE_CARD = '4000000000000002';
const DEMO_EXPIRY = '12/30';
const DEMO_CVC = '123';
const DEMO_NAME = 'Demo Buyer';

function paymentState(status: TestPaymentStatus): DemoPaymentLockState {
  if (status === 0) return 'success';
  if (status === 2) return 'cancelled';
  if (status === 3) return 'refunded';
  return 'failed';
}

function formatCard(value: string): string {
  return value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
}

export function DemoPaymentFlow({
  targetKey,
  title,
  amountMinor,
  initialPayment = null,
  canPay = true,
  onPay,
  onPayment,
  variant = 'inline',
  context = '',
  onBack,
  backLabel = 'Back',
  approvedTitle = 'Payment approved',
  resultContext,
  renderResult,
  minProcessingMs = 1200,
}: DemoPaymentFlowProps) {
  const page = variant === 'page';
  const reducedMotion = Boolean(useReducedMotion());
  const [step, setStep] = useState<Step>(initialPayment ? 'result' : page ? 'details' : 'review');
  const [payment, setPayment] = useState<TestPayment | null>(initialPayment);
  const [name, setName] = useState(page ? DEMO_NAME : '');
  const [card, setCard] = useState(page ? formatCard(SUCCESS_CARD) : '');
  const [expiry, setExpiry] = useState(page ? DEMO_EXPIRY : '');
  const [cvc, setCvc] = useState(page ? DEMO_CVC : '');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const attempt = useRef<{ outcome: FakePaymentOutcome; key: string } | null>(null);
  const lastIncomingPaymentId = useRef(initialPayment?.id);

  useEffect(() => {
    if (initialPayment && initialPayment.id !== lastIncomingPaymentId.current) {
      lastIncomingPaymentId.current = initialPayment.id;
      setPayment(initialPayment);
      setStep('result');
    }
  }, [initialPayment]);

  function fillDemoDetails(cardNumber = SUCCESS_CARD) {
    setName(page ? DEMO_NAME : 'Demo Rider');
    setCard(formatCard(cardNumber));
    setExpiry(DEMO_EXPIRY);
    setCvc(DEMO_CVC);
    setValidationError(null);
  }

  function resetForAnotherAttempt() {
    attempt.current = null;
    setPayment(null);
    setRequestError(null);
    setValidationError(null);
    if (page) fillDemoDetails();
    setStep('details');
  }

  async function submitOutcome(outcome: FakePaymentOutcome) {
    if (!attempt.current || attempt.current.outcome !== outcome) {
      attempt.current = { outcome, key: newIdempotencyKey(`demo-payment-${targetKey}`) };
    }
    setRequestError(null);
    setStep('processing');
    try {
      const [confirmed] = await Promise.all([
        onPay(outcome, attempt.current.key),
        page && minProcessingMs > 0 ? new Promise((resolve) => setTimeout(resolve, minProcessingMs)) : null,
      ]);
      attempt.current = null;
      setName('');
      setCard('');
      setExpiry('');
      setCvc('');
      setPayment(confirmed);
      setStep('result');
      onPayment?.(confirmed);
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string; detail?: string } | string } }).response?.data;
      setRequestError(typeof message === 'string' ? message : message?.message ?? message?.detail ?? 'The demo payment could not be checked. Try again.');
      setStep('details');
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const digits = card.replace(/\D/g, '');
    if (!name.trim()) {
      setValidationError('Enter a made-up name for this demo.');
      return;
    }
    if (digits !== SUCCESS_CARD && digits !== DECLINE_CARD) {
      setValidationError('Use one of the demo card numbers shown below.');
      return;
    }
    if (expiry !== DEMO_EXPIRY || cvc !== DEMO_CVC) {
      setValidationError(`Use ${DEMO_EXPIRY} and ${DEMO_CVC} for this demo.`);
      return;
    }
    setValidationError(null);
    void submitOutcome(digits === SUCCESS_CARD ? 0 : 1);
  }

  const declining = card.replace(/\D/g, '') === DECLINE_CARD;
  const transition = reducedMotion ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' as const };
  const resultState = payment ? paymentState(payment.status) : 'failed';

  if (page) {
    const amount = pounds(amountMinor);
    const headerTitle = step === 'result' && payment
      ? payment.status === 0 ? approvedTitle : payment.status === 1 ? 'Payment declined' : payment.status === 2 ? 'Checkout cancelled' : 'Payment refunded'
      : 'Payment';
    const headerContext = step === 'result' && resultContext ? resultContext : context;
    return (
      <RefinePage>
        <RefineHeader
          onBack={step === 'details' ? onBack : undefined}
          backLabel={backLabel}
          context={headerContext}
          title={headerTitle}
          demo
        />
        {step === 'processing' && (
          <div className="rf-lockwrap" role="status" aria-live="polite">
            <DemoPaymentLock state="waiting" reducedMotion={reducedMotion} />
            <h2 className="mg-h2">Processing demo payment</h2>
            <p className="rf-note">{amount} · a few seconds</p>
          </div>
        )}
        {step === 'result' && payment && <ResultSlot payment={payment} retry={resetForAnotherAttempt} render={renderResult} />}
        {(step === 'details' || step === 'review') && (
          <>
            <form id="demo-pay-form" className="flex flex-col gap-3 py-3" onSubmit={submit} noValidate>
              <p className="rf-note !py-0">Test card filled in for you. Nothing is sent or charged.</p>
              <label className="rf-fld">Card number
                <input value={card} onChange={(event) => setCard(formatCard(event.target.value))} inputMode="numeric" autoComplete="off" placeholder="0000 0000 0000 0000" />
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                <label className="rf-fld">Expiry
                  <input value={expiry} onChange={(event) => setExpiry(event.target.value.replace(/[^\d/]/g, '').slice(0, 5))} inputMode="numeric" autoComplete="off" placeholder="MM/YY" />
                </label>
                <label className="rf-fld">CVC
                  <input value={cvc} onChange={(event) => setCvc(event.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" autoComplete="off" placeholder="000" />
                </label>
              </div>
              <label className="rf-fld">Name on card
                <input value={name} onChange={(event) => setName(event.target.value.slice(0, 80))} autoComplete="off" spellCheck={false} />
              </label>
              <fieldset className="m-0 border-0 p-0">
                <legend className="rf-fld mb-1 p-0">Demo result</legend>
                <div className="mg-seg">
                  <button type="button" aria-pressed={!declining} onClick={() => fillDemoDetails(SUCCESS_CARD)}>Approve</button>
                  <button type="button" aria-pressed={declining} onClick={() => fillDemoDetails(DECLINE_CARD)}>Decline</button>
                </div>
              </fieldset>
              {validationError && <p role="alert" className="text-sm font-semibold text-[rgb(var(--mg-elim))]">{validationError}</p>}
              {requestError && (
                <div role="alert" className="demo-pay__error">
                  <p>{requestError}</p>
                  <p className="mt-1 text-xs">Your demo details are still here. Trying again will check the same payment attempt.</p>
                </div>
              )}
            </form>
            <RefineFoot column aboveTabs>
              <button type="submit" form="demo-pay-form" className="rf-btn rf-btn-primary"><Lock className="h-4 w-4" aria-hidden="true" />Pay {amount}</button>
              <button type="button" className="rf-btn rf-btn-text" onClick={() => void submitOutcome(2)}>Cancel</button>
            </RefineFoot>
          </>
        )}
      </RefinePage>
    );
  }

  return (
    <section className="demo-pay" data-reduced-motion={reducedMotion ? 'true' : 'false'} aria-label="Demo payment">
      <header className="demo-pay__banner">
        <ShieldCheck aria-hidden="true" className="h-5 w-5 shrink-0" />
        <div>
          <p className="font-extrabold">DEMO · no money is taken</p>
          <p className="text-sm">Use the made-up details on this screen. Never enter real card details here.</p>
        </div>
      </header>

      <>
        {step === 'review' && (
          <motion.div key="review" className="demo-pay__panel" initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? undefined : { opacity: 0, y: -6 }} transition={transition}>
            <div className="flex items-start gap-3">
              <CreditCard className="mt-0.5 h-5 w-5 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h3 className="mg-h2">{title}</h3>
                <p className="mt-1 text-sm text-[rgb(var(--mg-muted))]">Test total</p>
              </div>
              <strong className="text-lg text-[rgb(var(--mg-heading))]">{pounds(amountMinor)}</strong>
            </div>
            {canPay ? (
              <button type="button" className="mg-btn mg-btn-primary w-full" onClick={() => setStep('details')}>Enter demo details</button>
            ) : (
              <p className="mg-notice">This demo payment has already finished.</p>
            )}
          </motion.div>
        )}

        {step === 'details' && (
          <motion.form key="details" className="demo-pay__panel" onSubmit={submit} initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? undefined : { opacity: 0, y: -6 }} transition={transition} noValidate>
            <div className="demo-pay__test-cards">
              <div>
                <p className="font-bold">Made-up details for this demo</p>
                <p className="mt-1 font-mono text-xs">4242 4242 4242 4242 succeeds</p>
                <p className="font-mono text-xs">4000 0000 0000 0002 is declined</p>
                <p className="mt-1 text-xs">Expiry {DEMO_EXPIRY} · CVC {DEMO_CVC}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="mg-btn mg-btn-secondary" onClick={() => fillDemoDetails()}>Use demo details</button>
                <button type="button" className="mg-btn mg-btn-secondary" onClick={() => fillDemoDetails(DECLINE_CARD)}>Use decline card</button>
              </div>
            </div>

            <label className="mg-field">
              <span>Name on demo card</span>
              <input value={name} onChange={(event) => setName(event.target.value.slice(0, 80))} autoComplete="off" spellCheck={false} />
            </label>
            <label className="mg-field">
              <span>Demo card number</span>
              <input value={card} onChange={(event) => setCard(formatCard(event.target.value))} inputMode="numeric" autoComplete="off" placeholder="0000 0000 0000 0000" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="mg-field">
                <span>Demo expiry</span>
                <input value={expiry} onChange={(event) => setExpiry(event.target.value.replace(/[^\d/]/g, '').slice(0, 5))} inputMode="numeric" autoComplete="off" placeholder="MM/YY" />
              </label>
              <label className="mg-field">
                <span>Demo CVC</span>
                <input value={cvc} onChange={(event) => setCvc(event.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" autoComplete="off" placeholder="000" />
              </label>
            </div>
            {validationError && <p role="alert" className="text-sm font-semibold text-rose-700 dark:text-rose-300">{validationError}</p>}
            {requestError && (
              <div role="alert" className="demo-pay__error">
                <p>{requestError}</p>
                <p className="mt-1 text-xs">Your demo details are still here. Trying again will check the same payment attempt.</p>
              </div>
            )}
            <button type="submit" className="mg-btn mg-btn-primary w-full">Run demo payment for {pounds(amountMinor)}</button>
            <button type="button" className="mg-btn mg-btn-secondary w-full" onClick={() => void submitOutcome(2)}>Cancel demo payment</button>
          </motion.form>
        )}

        {step === 'processing' && (
          <motion.div key="processing" className="demo-pay__processing" role="status" aria-live="polite" initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? undefined : { opacity: 0, y: -6 }} transition={transition}>
            <DemoPaymentLock state="waiting" reducedMotion={reducedMotion} />
            <h3 className="mg-h2">Checking demo payment…</h3>
          </motion.div>
        )}

        {step === 'result' && payment && (
          <motion.div key="result" className="demo-pay__panel items-center text-center" role="status" aria-live="polite" initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={transition}>
            <DemoPaymentLock state={resultState} reducedMotion={reducedMotion} />
            <div>
              <h3 className="mg-h2">{resultTitle(payment.status)}</h3>
              <p className="mt-1 text-sm text-[rgb(var(--mg-muted))]">{resultCopy(payment.status)}</p>
            </div>
            <TestReceipt payment={payment} />
            {canPay && (payment.status === 1 || payment.status === 2) && (
              <button type="button" className="mg-btn mg-btn-primary w-full" onClick={resetForAnotherAttempt}>Try another demo payment</button>
            )}
          </motion.div>
        )}
      </>
    </section>
  );
}

function ResultSlot({ payment, retry, render }: { payment: TestPayment; retry: () => void; render?: DemoPaymentFlowProps['renderResult'] }) {
  return <>{render ? render({ payment, retry }) : <OutcomeState payment={payment} />}</>;
}

/** Round icon plus a title and one line, for the page checkout's outcome screens. */
export function OutcomeState({ payment, title, detail, role }: { payment: TestPayment; title?: string; detail?: ReactNode; role?: 'alert' | 'status' }) {
  const tone = payment.status === 0 ? 'ok' : payment.status === 1 ? 'bad' : 'mut';
  const heading = title ?? (payment.status === 0 ? 'Payment approved' : payment.status === 1 ? 'The demo card was declined' : payment.status === 2 ? 'Payment cancelled' : 'Payment refunded');
  const line = detail ?? (payment.status === 0
    ? <>Paid <PaidAmount amountMinor={payment.amountMinor} /></>
    : payment.status === 1 ? 'Nothing was charged.' : payment.status === 2 ? 'Nothing was charged.' : 'No money moved.');
  // The disc pops in and its mark draws itself; a declined card gives a small shake (see demoPayment.css).
  return (
    <div className={`rf-state mg-outcome mg-outcome-${tone}`} role={role ?? (payment.status === 1 ? 'alert' : 'status')}>
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="19" className={`rf-state-${tone}`} />
        {payment.status === 0 && <path className="mg-outcome-mark" pathLength={1} d="M12 20.5l5 5L28 14.5" fill="none" stroke="rgb(var(--mg-ok))" strokeWidth="3" />}
        {payment.status === 1 && <path d="M20 12v10M20 27v1" fill="none" stroke="rgb(var(--mg-elim))" strokeWidth="3" strokeLinecap="round" />}
        {payment.status > 1 && <path className="mg-outcome-mark" pathLength={1} d="M14 14l12 12M26 14L14 26" fill="none" stroke="rgb(var(--mg-body))" strokeWidth="3" strokeLinecap="round" />}
      </svg>
      <div><div className="rf-t1">{heading}</div><div className="rf-t2">{line}</div></div>
    </div>
  );
}

/** A paid amount that counts up from £0.00 as the approval lands. */
export function PaidAmount({ amountMinor }: { amountMinor: number }) {
  return <CountUp from={0} to={amountMinor} delay={0.25} duration={0.7} round={Math.round} format={pounds} />;
}

function resultTitle(status: TestPaymentStatus): string {
  if (status === 0) return 'Demo payment approved';
  if (status === 1) return 'Demo payment declined';
  if (status === 2) return 'Demo payment cancelled';
  return 'Demo refund recorded';
}

function resultCopy(status: TestPaymentStatus): string {
  if (status === 0) return 'Approved. No money was taken.';
  if (status === 1) return 'Declined. No money was taken.';
  if (status === 2) return 'Cancelled. No money was taken.';
  return 'Refund recorded. No money moved.';
}

export type DemoPaymentLockState = 'waiting' | 'success' | 'failed' | 'cancelled' | 'refunded';

export function DemoPaymentLock({ state, reducedMotion }: { state: DemoPaymentLockState; reducedMotion: boolean }) {
  return (
    <svg className="demo-lock" data-state={state} data-reduced-motion={reducedMotion ? 'true' : 'false'} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <circle className="demo-lock__ring" cx="60" cy="60" r="53" />
      <g className="demo-lock__group">
        <path className="demo-lock__shackle" d="M42 58 V42 a18 18 0 0 1 36 0 V58" />
        <rect className="demo-lock__body" x="30" y="54" width="60" height="48" rx="11" />
        <circle className="demo-lock__key" cx="60" cy="74" r="6" />
        <rect className="demo-lock__key" x="57" y="76" width="6" height="12" rx="3" />
        <path className="demo-lock__tick" d="M45 78 l10 10 l21 -21" />
      </g>
    </svg>
  );
}
