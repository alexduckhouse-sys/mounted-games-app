/** The five policies on the policies page, each with its own address. */
export type PolicyId = 'privacy' | 'terms' | 'refunds' | 'cookies' | 'safeguarding';

export const POLICIES: { id: PolicyId; path: string; label: string; title: string }[] = [
  { id: 'privacy', path: '/privacy', label: 'Privacy', title: 'Privacy and data protection (UK GDPR)' },
  { id: 'terms', path: '/terms', label: 'Terms of service', title: 'Terms of service and platform rules' },
  { id: 'refunds', path: '/refunds', label: 'Refunds and payments', title: 'Refunds, cancellations and payments' },
  { id: 'cookies', path: '/cookies', label: 'Cookies and storage', title: 'Cookies and offline storage (UK PECR)' },
  { id: 'safeguarding', path: '/safeguarding', label: 'Safeguarding and welfare', title: 'Safeguarding, filming and equine welfare' },
];

/**
 * Which policy an address opens. A link with a hash such as `/privacy#refunds` (the old single-page address)
 * opens that policy; otherwise the path decides, and anything else is Privacy.
 */
export function policyForLocation(pathname: string, hash = ''): PolicyId {
  const fromHash = POLICIES.find((policy) => policy.id === hash.replace(/^#/, ''));
  if (fromHash) return fromHash.id;
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  return POLICIES.find((policy) => policy.path === path)?.id ?? 'privacy';
}
