import { describe, expect, it } from 'vitest';
import { externalErrorMessage } from './externalAuthError';

describe('externalErrorMessage', () => {
  it('shows the API’s own message when there is one', () => {
    const err = { response: { status: 403, data: { message: 'Admins need to sign in with their email and password, not Google or Apple.' } } };
    expect(externalErrorMessage(err, 'fallback')).toBe('Admins need to sign in with their email and password, not Google or Apple.');
  });

  it('says to wait when the sign-in limit is hit without a message', () => {
    expect(externalErrorMessage({ response: { status: 429 } }, 'fallback')).toBe('Too many tries. Wait a minute and try again.');
  });

  it('falls back for no reply, a blank or odd message, or something that isn’t an error at all', () => {
    expect(externalErrorMessage(new Error('Network Error'), 'fallback')).toBe('fallback');
    expect(externalErrorMessage({ response: { status: 500, data: { message: '  ' } } }, 'fallback')).toBe('fallback');
    expect(externalErrorMessage({ response: { status: 400, data: { message: 42 } } }, 'fallback')).toBe('fallback');
    expect(externalErrorMessage(null, 'fallback')).toBe('fallback');
  });
});
