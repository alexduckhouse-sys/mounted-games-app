import { describe, expect, it } from 'vitest';
import { apiErrorMessage, apiErrorStatus } from './apiError';

describe('apiErrorMessage', () => {
  it('uses the message the API sent', () => {
    expect(apiErrorMessage({ response: { data: { message: 'Agree to the terms.' } } }, 'Try again.')).toBe('Agree to the terms.');
  });

  it.each([
    ['no response', new Error('offline')],
    ['an empty message', { response: { data: { message: '  ' } } }],
    ['a message that is not text', { response: { data: { message: 4 } } }],
    ['nothing at all', null],
  ])('falls back with %s', (_name, err) => {
    expect(apiErrorMessage(err, 'Try again.')).toBe('Try again.');
  });
});

describe('apiErrorStatus', () => {
  it('reads the status', () => {
    expect(apiErrorStatus({ response: { status: 409 } })).toBe(409);
  });

  it('is undefined when the server never answered', () => {
    expect(apiErrorStatus(new Error('offline'))).toBeUndefined();
    expect(apiErrorStatus(null)).toBeUndefined();
    expect(apiErrorStatus({ response: { status: 'x' } })).toBeUndefined();
  });
});
