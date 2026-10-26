import { describe, expect, it } from 'vitest';
import { POLICIES, policyForLocation } from './policies';

describe('policyForLocation', () => {
  it('opens the policy whose address was used', () => {
    expect(policyForLocation('/privacy')).toBe('privacy');
    expect(policyForLocation('/terms')).toBe('terms');
    expect(policyForLocation('/refunds')).toBe('refunds');
    expect(policyForLocation('/cookies')).toBe('cookies');
    expect(policyForLocation('/safeguarding')).toBe('safeguarding');
    expect(policyForLocation('/terms/')).toBe('terms');
  });

  it('lets a hash from the old one-page address pick the policy', () => {
    expect(policyForLocation('/privacy', '#refunds')).toBe('refunds');
    expect(policyForLocation('/privacy', '#safeguarding')).toBe('safeguarding');
    expect(policyForLocation('/terms', '#cookies')).toBe('cookies');
  });

  it('falls back to Privacy for anything else', () => {
    expect(policyForLocation('/privacy', '#nonsense')).toBe('privacy');
    expect(policyForLocation('/somewhere-else')).toBe('privacy');
    expect(policyForLocation('/')).toBe('privacy');
  });

  it('gives every policy its own path and a sentence-case title', () => {
    expect(new Set(POLICIES.map((policy) => policy.path)).size).toBe(5);
    for (const policy of POLICIES) expect(policy.title).not.toMatch(/^\d\.|[A-Z]{3,}\s[A-Z]{3,}/);
  });
});
