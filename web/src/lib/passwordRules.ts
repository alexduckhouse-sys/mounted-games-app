import { tr } from '../i18n/translate';

/**
 * The password rules, mirroring the Identity options in `api/Program.cs` exactly (8 or more characters, a digit,
 * a lowercase letter, a special character, no capital needed). `passwordRules.test.ts` reads `Program.cs` and fails
 * if the two drift apart. Nothing here says "non-alphanumeric": people see "special character".
 */
export const MIN_PASSWORD_LENGTH = 8;

export interface PasswordRule {
  id: 'length' | 'number' | 'lowercase' | 'special';
  /** The checklist row, in the language in use. */
  readonly label: string;
  met: (password: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { id: 'length', get label() { return tr('auth.pw.length', { min: MIN_PASSWORD_LENGTH }); }, met: (p) => p.length >= MIN_PASSWORD_LENGTH },
  { id: 'number', get label() { return tr('auth.pw.number'); }, met: (p) => /[0-9]/.test(p) },
  { id: 'lowercase', get label() { return tr('auth.pw.lowercase'); }, met: (p) => /\p{Ll}/u.test(p) },
  // Identity counts anything that isn't a letter or a decimal digit.
  { id: 'special', get label() { return tr('auth.pw.special'); }, met: (p) => /[^\p{L}\p{Nd}]/u.test(p) },
];

export function passwordRuleStatus(password: string): { rule: PasswordRule; met: boolean }[] {
  return PASSWORD_RULES.map((rule) => ({ rule, met: rule.met(password) }));
}

export function passwordMeetsRules(password: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.met(password));
}

/** Identity's error codes, in plain words (in the language in use). */
function friendlyByCode(code: string): string | undefined {
  switch (code) {
    case 'PasswordTooShort': return tr('auth.pw.err.tooShort', { min: MIN_PASSWORD_LENGTH });
    case 'PasswordRequiresDigit': return tr('auth.pw.err.digit');
    case 'PasswordRequiresLower': return tr('auth.pw.err.lower');
    case 'PasswordRequiresUpper': return tr('auth.pw.err.upper');
    case 'PasswordRequiresNonAlphanumeric': return tr('auth.pw.err.special');
    case 'PasswordRequiresUniqueChars': return tr('auth.pw.err.unique');
    default: return undefined;
  }
}

/** Turns a sentence from an older response into friendly wording: "non-alphanumeric" becomes "special". */
export function friendlyPasswordText(text: string): string {
  return text.replace(/non-?\s?alphanumeric/gi, 'special');
}

/**
 * The messages to show for a failed password, from the API's `errorCodes` when it sent them, otherwise from its
 * `errors` text. Always a list of plain sentences; never contains "non-alphanumeric".
 */
export function friendlyPasswordErrors(data: { errors?: unknown; errorCodes?: unknown } | undefined): string[] {
  const codes = Array.isArray(data?.errorCodes) ? data.errorCodes.filter((c): c is string => typeof c === 'string') : [];
  const fromCodes = codes.map(friendlyByCode).filter((m): m is string => !!m);
  if (fromCodes.length > 0 && fromCodes.length === codes.length) return [...new Set(fromCodes)];
  const texts = Array.isArray(data?.errors) ? data.errors.filter((e): e is string => typeof e === 'string') : [];
  return [...new Set(texts.map(friendlyPasswordText))];
}
