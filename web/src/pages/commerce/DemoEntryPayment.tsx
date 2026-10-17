import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { DemoPaymentFlow } from './DemoPaymentFlow';
import { errorMessage, newIdempotencyKey } from './commerceFormat';
import type { DemoEntryPaymentResult, EventCommerceSettings, FakePaymentOutcome, TestPayment } from './types';

export function DemoEntryPayment({
  signupId,
  amountMinor,
  signupStatus = 0,
  onChanged,
}: {
  signupId: number;
  amountMinor: number;
  signupStatus?: 0 | 1 | 2 | 3;
  onChanged: () => void;
}) {
  const [settings, setSettings] = useState<EventCommerceSettings | null>(null);
  const [receipt, setReceipt] = useState<TestPayment | null>(null);
  const [statusOverride, setStatusOverride] = useState<{ base: 0 | 1 | 2 | 3; value: 0 | 1 | 2 | 3 } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);
  const refundAttempt = useRef<string | null>(null);
  const currentStatus = statusOverride?.base === signupStatus ? statusOverride.value : signupStatus;

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      api.get<EventCommerceSettings>(`/commerce/signups/${signupId}/demo-settings`),
      api.get<TestPayment[]>('/commerce/entry-payments/mine'),
    ]).then(([settingsResult, paymentsResult]) => {
      if (!active) return;
      setSettings(settingsResult.status === 'fulfilled' ? settingsResult.value.data : null);
      if (paymentsResult.status === 'fulfilled' && Array.isArray(paymentsResult.value.data)) {
        const latest = paymentsResult.value.data
          .find((payment) => payment.target === 1 && payment.targetId === signupId);
        if (latest) setReceipt(latest);
      }
    });
    return () => { active = false; };
  }, [signupId]);

  async function checkout(outcome: FakePaymentOutcome, idempotencyKey: string) {
    const { data } = await api.post<DemoEntryPaymentResult>(`/commerce/signups/${signupId}/demo-checkout`, {
      idempotencyKey,
      outcome,
    });
    setReceipt(data.payment);
    setStatusOverride({ base: signupStatus, value: data.signupStatus });
    onChanged();
    return data.payment;
  }

  async function refund() {
    refundAttempt.current ??= newIdempotencyKey(`demo-entry-refund-${signupId}`);
    setRefunding(true);
    setError(null);
    try {
      const { data } = await api.post<DemoEntryPaymentResult>(`/commerce/signups/${signupId}/demo-refund`, {
        idempotencyKey: refundAttempt.current,
        outcome: 0,
      });
      refundAttempt.current = null;
      setReceipt(data.payment);
      setStatusOverride({ base: signupStatus, value: data.signupStatus });
      onChanged();
    } catch (requestError) {
      setError(errorMessage(requestError, 'The demo refund could not be checked. Try again.'));
    } finally {
      setRefunding(false);
    }
  }

  if (!settings?.isDemo) return null;
  return (
    <div className="mt-3 flex flex-col gap-3">
      <DemoPaymentFlow
        targetKey={`entry-${signupId}`}
        title={`Competition entry #${signupId}`}
        amountMinor={amountMinor}
        initialPayment={receipt}
        canPay={currentStatus === 0}
        onPay={checkout}
        onPayment={setReceipt}
      />
      {currentStatus === 1 && (
        <button type="button" className="mg-btn mg-btn-secondary self-start" disabled={refunding} onClick={() => void refund()}>
          {refunding ? 'Checking demo refund…' : 'Run demo refund'}
        </button>
      )}
      {error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
    </div>
  );
}
