import { useEffect, useState } from 'react';
import { api } from '../../api';
import { DemoPaymentNotice } from '../../components/DemoPaymentNotice';
import type { EventCommerceSettings } from './types';

/**
 * On My signups, under an entry that has a fee: the demo notice, so nobody thinks the entry has been paid for.
 * A demo event's entry also gets a link to the test payment page (the payment itself happens there, not here); a
 * real event's entry still waiting for money gets the notice alone, because the "How to pay" button above it
 * already says where to go. Nothing shows until we know which kind of event it is, so the link doesn't pop in.
 */
export function DemoEntryPayment({ signupId, signupStatus = 0 }: { signupId: number; signupStatus?: 0 | 1 | 2 | 3 }) {
  const [isDemo, setIsDemo] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    api.get<EventCommerceSettings>(`/commerce/signups/${signupId}/demo-settings`)
      .then(({ data }) => { if (active) setIsDemo(Boolean(data.isDemo)); })
      .catch(() => { if (active) setIsDemo(false); });
    return () => { active = false; };
  }, [signupId]);

  const pending = signupStatus === 0;
  if (isDemo === null || (!isDemo && !pending)) return null;
  return (
    <div className="mt-3">
      {isDemo
        ? <DemoPaymentNotice what="entry" actionLabel={pending ? 'Open the test payment page' : 'View the test receipt'} actionTo={`/me/signups/${signupId}/test-payment`} />
        : <DemoPaymentNotice what="entry" />}
    </div>
  );
}
