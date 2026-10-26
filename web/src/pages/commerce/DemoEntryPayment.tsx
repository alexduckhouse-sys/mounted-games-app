import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Notice } from '../../components/Notice';
import type { EventCommerceSettings } from './types';

/**
 * On My signups: a demo event's entry gets a clearly marked link to the test payment page. Real events show
 * nothing, because they never use test payments. The payment itself happens on that page, not here.
 */
export function DemoEntryPayment({ signupId, signupStatus = 0 }: { signupId: number; signupStatus?: 0 | 1 | 2 | 3 }) {
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    let active = true;
    api.get<EventCommerceSettings>(`/commerce/signups/${signupId}/demo-settings`)
      .then(({ data }) => { if (active) setIsDemo(Boolean(data.isDemo)); })
      .catch(() => { if (active) setIsDemo(false); });
    return () => { active = false; };
  }, [signupId]);

  if (!isDemo) return null;
  const pending = signupStatus === 0;
  return (
    <div className="mt-3">
      <Notice tone="info" role={null} actionLabel={pending ? 'Open the test payment page' : 'View the test receipt'} actionTo={`/me/signups/${signupId}/test-payment`}>
        <span className="block font-extrabold uppercase tracking-wide">Demo event: test payment only</span>
        No money is taken for this entry.
      </Notice>
    </div>
  );
}
