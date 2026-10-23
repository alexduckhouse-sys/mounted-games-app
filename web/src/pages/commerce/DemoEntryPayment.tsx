import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
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
    <div className="mt-3 flex flex-col gap-2 rounded-lg border-2 border-violet-400 bg-violet-50 p-3 text-violet-950">
      <p className="text-sm font-extrabold uppercase tracking-wide">Demo event: test payment only</p>
      <p className="text-sm">No money is taken for this entry.</p>
      <Link className="mg-btn mg-btn-secondary self-start" to={`/me/signups/${signupId}/test-payment`}>
        {pending ? 'Open the test payment page' : 'View the test receipt'}
      </Link>
    </div>
  );
}
