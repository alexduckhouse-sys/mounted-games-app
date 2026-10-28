import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import { api } from '../../api';
import { DemoPaymentNotice } from '../../components/DemoPaymentNotice';
import { Notice } from '../../components/Notice';
import { PageProblem } from '../../components/PageProblem';
import type { MySignup } from '../../types';
import { RefineFoot, RefineHeader, RefineList, RefinePage, RefineSection } from '../refine/Refine';
import { OutcomeState, PaidAmount } from './DemoPaymentFlow';
import { EntryRosette } from '../../components/Rosette';
import { displaySectionName } from '../../lib/section';
import { errorMessage, newIdempotencyKey, pounds } from './commerceFormat';
import type { DemoEntryPaymentResult, EventCommerceSettings, FakePaymentOutcome, TestPayment } from './types';

type Load =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'missing' }
  | { state: 'ready'; signup: MySignup; isDemo: boolean; payments: TestPayment[] };

const OUTCOME_LABEL: Record<TestPayment['status'], string> = {
  0: 'Approved (test)',
  1: 'Declined (test)',
  2: 'Cancelled (test)',
  3: 'Refunded (test)',
};

/**
 * The sales-demo checkout for an entry. It only works on demo competitions, asks for no card details at all
 * and sends nothing but the outcome the person picked. The server checks the demo mark again on every call.
 */
export function TestEntryPaymentPage() {
  const { signupId } = useParams();
  const id = Number(signupId);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setLoad({ state: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      api.get<MySignup[]>('/me/signups'),
      api.get<EventCommerceSettings>(`/commerce/signups/${id}/demo-settings`),
      api.get<TestPayment[]>('/commerce/entry-payments/mine'),
    ]).then(([signupsResult, settingsResult, paymentsResult]) => {
      if (!active) return;
      if (signupsResult.status === 'rejected') return setLoad({ state: 'error' });
      const signup = signupsResult.value.data.find((row) => row.id === id);
      if (!signup) return setLoad({ state: 'missing' });
      const payments = paymentsResult.status === 'fulfilled' && Array.isArray(paymentsResult.value.data)
        ? paymentsResult.value.data.filter((payment) => payment.target === 1 && payment.targetId === id)
        : [];
      setLoad({
        state: 'ready',
        signup,
        isDemo: settingsResult.status === 'fulfilled' && settingsResult.value.data.isDemo,
        payments,
      });
    });
    return () => { active = false; };
  }, [id, attempt]);

  if (load.state === 'loading') {
    return <RefinePage><p role="status" className="rf-note">Loading your entry…</p></RefinePage>;
  }
  if (load.state === 'error') {
    return (
      <RefinePage>
        <PageProblem title="Couldn’t load this entry" primaryLabel="Try again" onPrimary={retry} secondaryLabel="My signups" secondaryTo="/me/signups">
          Check your signal and try again.
        </PageProblem>
      </RefinePage>
    );
  }
  if (load.state === 'missing') {
    return (
      <RefinePage>
        <PageProblem title="Couldn’t find that entry" secondaryLabel="My signups" secondaryTo="/me/signups">
          It isn’t on your account.
        </PageProblem>
      </RefinePage>
    );
  }
  return <TestPaymentScreen signup={load.signup} isDemo={load.isDemo} payments={load.payments} />;
}

/** The demo notice, then (if there is one) what this screen adds to it. */
function TestBanner({ children }: { children?: string }) {
  return (
    <div className="mx-4 mt-3">
      <DemoPaymentNotice what="entry" />
      {children && (
        <Notice tone="info" role={null}>
          <span className="block font-extrabold uppercase tracking-wide">Test payment</span>
          {children}
        </Notice>
      )}
    </div>
  );
}

function TestPaymentScreen({ signup, isDemo, payments }: { signup: MySignup; isDemo: boolean; payments: TestPayment[] }) {
  const back = `/competitions/${signup.competitionId}/details`;
  const [status, setStatus] = useState(signup.status);
  const [shown, setShown] = useState<TestPayment | null>(payments[0] ?? null);
  const [reviewing, setReviewing] = useState(payments.length > 0 && signup.status !== 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkoutAttempt = useRef<{ outcome: FakePaymentOutcome; key: string } | null>(null);
  const refundAttempt = useRef<string | null>(null);

  if (!isDemo) {
    return (
      <RefinePage>
        <RefineHeader back={back} backLabel="Back to the competition" context={signup.competitionName} title="Payment" />
        <div className="m-4 flex flex-col items-start gap-3">
          <DemoPaymentNotice what="entry" className="w-full" />
          <Notice tone="info" role={null} className="w-full">
            <span className="block font-semibold">Online payment isn’t available for this event.</span>
            Pay the organiser directly. Your entry stays pending until they confirm it.
          </Notice>
          <Link className="mg-btn mg-btn-secondary" to={back}>Back to the competition</Link>
        </div>
      </RefinePage>
    );
  }

  async function pay(outcome: FakePaymentOutcome) {
    if (!checkoutAttempt.current || checkoutAttempt.current.outcome !== outcome) {
      checkoutAttempt.current = { outcome, key: newIdempotencyKey(`test-entry-${signup.id}`) };
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<DemoEntryPaymentResult>(`/commerce/signups/${signup.id}/demo-checkout`, {
        idempotencyKey: checkoutAttempt.current.key,
        outcome,
      });
      checkoutAttempt.current = null;
      setStatus(data.signupStatus);
      setShown(data.payment);
      setReviewing(true);
    } catch (requestError) {
      setError(errorMessage(requestError, 'Couldn’t check the test payment. Check your signal and try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function refund() {
    refundAttempt.current ??= newIdempotencyKey(`test-entry-refund-${signup.id}`);
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<DemoEntryPaymentResult>(`/commerce/signups/${signup.id}/demo-refund`, {
        idempotencyKey: refundAttempt.current,
        outcome: 0,
      });
      refundAttempt.current = null;
      setStatus(data.signupStatus);
      setShown(data.payment);
    } catch (requestError) {
      setError(errorMessage(requestError, 'Couldn’t check the test refund. Check your signal and try again.'));
    } finally {
      setBusy(false);
    }
  }

  const amount = pounds(signup.amountMinor);

  if (reviewing && shown) {
    const failed = shown.status === 1 || shown.status === 2;
    return (
      <RefinePage>
        <RefineHeader
          back={back}
          backLabel="Back to the competition"
          context={signup.competitionName}
          title={failed ? 'Test payment' : 'Test receipt'}
          demo
        />
        <TestBanner>
          {failed
            ? 'Nothing was charged.'
            : 'This is a test receipt, not a real one.'}
        </TestBanner>
        {shown.status === 0 && (
          <EntryRosette team={signup.teamName?.trim() || signup.fullName} section={displaySectionName(signup.sectionName)} year={new Date(signup.competitionStart).getFullYear()} />
        )}
        <OutcomeState
          payment={shown}
          title={shown.status === 0 ? 'Test payment approved' : shown.status === 1 ? 'Test card declined' : shown.status === 2 ? 'Test payment cancelled' : 'Test refund recorded'}
          detail={shown.status === 0 ? <>Test amount <PaidAmount amountMinor={signup.amountMinor} /></> : shown.status === 3 ? 'No money moved.' : 'Nothing was charged.'}
        />
        {!failed && (
          <>
            <RefineSection title="TEST RECEIPT" />
            <RefineList as="div" label="Test receipt">
              {receiptRow('Event', signup.competitionName)}
              {receiptRow('Entry', `${signup.sectionName} · ${signup.fullName}`)}
              {receiptRow('Test amount', amount)}
              {receiptRow('Result', OUTCOME_LABEL[shown.status])}
              {receiptRow('Test reference', shown.receiptReference)}
              {shown.createdAt && receiptRow('Date', new Date(shown.createdAt).toLocaleString('en-GB'))}
            </RefineList>
            <p className="rf-note">
              Test amounts are never counted as money received by the organiser.
            </p>
          </>
        )}
        {error && <div className="mx-4"><Notice>{error}</Notice></div>}
        <RefineFoot column>
          {status === 0 && (
            <button type="button" className="rf-btn rf-btn-primary" onClick={() => { setReviewing(false); setError(null); }}>Back to the test payment</button>
          )}
          {status === 1 && (
            <button type="button" className="rf-btn rf-btn-text" disabled={busy} onClick={() => void refund()}>
              {busy ? 'Checking test refund…' : 'Try a test refund'}
            </button>
          )}
          <Link className={`rf-btn ${status === 0 ? 'rf-btn-text' : 'rf-btn-primary'}`} to={back}>Back to the competition</Link>
        </RefineFoot>
      </RefinePage>
    );
  }

  if (status !== 0) {
    return (
      <RefinePage>
        <RefineHeader back={back} backLabel="Back to the competition" context={signup.competitionName} title="Test payment" demo />
        <TestBanner />
        <p className="rf-note">There is nothing to pay for this entry.</p>
        <RefineFoot column><Link className="rf-btn rf-btn-primary" to={back}>Back to the competition</Link></RefineFoot>
      </RefinePage>
    );
  }

  return (
    <RefinePage>
      <RefineHeader back={back} backLabel="Back to the competition" context={signup.competitionName} title="Test payment" demo />
      <TestBanner>We don’t ask for card details. Pick what you’d like to see happen.</TestBanner>
      <RefineSection title="Your entry" />
      <RefineList as="div" label="Your entry">
        {receiptRow('Event', signup.competitionName)}
        {receiptRow('Entry', `${signup.sectionName} · ${signup.fullName}`)}
        {receiptRow('Test amount', amount)}
      </RefineList>
      <div className="mx-4 mt-3 flex items-center gap-3 rounded-lg border border-dashed border-[rgb(var(--mg-control))] p-3" aria-label="Test card, for show only">
        <CreditCard className="h-6 w-6 shrink-0 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
        <p className="text-sm"><span className="font-bold">TEST CARD</span> · •••• •••• •••• 4242<br /><span className="rf-t2">For show only. Nothing is entered or stored.</span></p>
      </div>
      {error && (
        <div className="mx-4 mt-3">
          <Notice>
            {error}
            <span className="mt-1 block text-xs">Trying again checks the same test payment.</span>
          </Notice>
        </div>
      )}
      <RefineFoot column>
        <button type="button" className="rf-btn rf-btn-primary" disabled={busy} onClick={() => void pay(0)}>
          {busy ? 'Checking the test payment…' : `Pay ${amount} (test)`}
        </button>
        <button type="button" className="rf-btn rf-btn-text" disabled={busy} onClick={() => void pay(1)}>Try a declined card (test)</button>
        <button type="button" className="rf-btn rf-btn-text" disabled={busy} onClick={() => void pay(2)}>Cancel</button>
      </RefineFoot>
    </RefinePage>
  );
}

function receiptRow(label: string, value: string) {
  return (
    <div className="rf-row" key={label}>
      <span className="rf-grow"><span className="rf-t2 !font-bold uppercase tracking-[0.08em]">{label}</span><span className="rf-t1 break-words">{value}</span></span>
    </div>
  );
}
