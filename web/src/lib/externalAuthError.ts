import { tr } from '../i18n/translate';

/**
 * What to show when a Google or Apple sign-in is turned away. The API's own message says what to do (use your password,
 * confirm your email with the provider, and so on), so it wins, untranslated like every server message; otherwise
 * the caller's fallback.
 */
export function externalErrorMessage(err: unknown, fallback: string): string {
  const response = (err as { response?: { status?: number; data?: { message?: unknown } } } | null)?.response;
  const message = response?.data?.message;
  if (typeof message === 'string' && message.trim() !== '') return message;
  if (response?.status === 429) return tr('auth.login.tooMany');
  return fallback;
}
