import { motion, useReducedMotion } from 'framer-motion';
import { CreditCard, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { newIdempotencyKey, pounds } from './commerceFormat';
import { TestReceipt } from './commerceUi';
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
}

const SUCCESS_CARD = '4242424242424242';
const DECLINE_CARD = '4000000000000002';
const DEMO_EXPIRY = '12/34';
const DEMO_CVC = '123';

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
}: DemoPaymentFlowProps) {
  const reducedMotion = Boolean(useReducedMotion());
  const [step, setStep] = useState<Step>(initialPayment ? 'result' : 'review');
  const [payment, setPayment] = useState<TestPayment | null>(initialPayment);
  const [name, setName] = useState('');
  const [card, setCard] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
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
    setName('Demo Rider');
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
    setStep('details');
  }

  async function submitOutcome(outcome: FakePaymentOutcome) {
    if (!attempt.current || attempt.current.outcome !== outcome) {
      attempt.current = { outcome, key: newIdempotencyKey(`demo-payment-${targetKey}`) };
    }
    setRequestError(null);
    setStep('processing');
    try {
      const confirmed = await onPay(outcome, attempt.current.key);
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

  const transition = reducedMotion ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' as const };
  const resultState = payment ? paymentState(payment.status) : 'failed';

  return (
    <section className="demo-pay" data-reduced-motion={reducedMotion ? 'true' : 'false'} aria-label="Demo payment">
      <header className="demo-pay__banner">
        <ShieldCheck aria-hidden="true" className="h-5 w-5 shrink-0" />
        <div>
          <p className="font-extrabold">DEMO — no money is taken</p>
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
                <input value={expiry} onChange={(event) => setExpiry(event.target.value.slice(0, 5))} inputMode="numeric" autoComplete="off" placeholder="MM/YY" />
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
            <h3 className="mg-h2">Checking the demo payment</h3>
            <p>The result will come from the test payment service.</p>
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

function resultTitle(status: TestPaymentStatus): string {
  if (status === 0) return 'Demo payment approved';
  if (status === 1) return 'Demo payment declined';
  if (status === 2) return 'Demo payment cancelled';
  return 'Demo refund recorded';
}

function resultCopy(status: TestPaymentStatus): string {
  if (status === 0) return 'The test service approved this payment. No money was taken.';
  if (status === 1) return 'The test service declined this payment. No money was taken.';
  if (status === 2) return 'You cancelled this test payment. No money was taken.';
  return 'The test service recorded the refund. No money moved.';
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
