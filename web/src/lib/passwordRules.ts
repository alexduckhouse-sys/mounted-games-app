/**
 * The password rules, mirroring the Identity options in `api/Program.cs` exactly (8 or more characters, a digit,
 * a lowercase letter, a special character, no capital needed). `passwordRules.test.ts` reads `Program.cs` and fails
 * if the two drift apart. Nothing here says "non-alphanumeric": people see "special character".
 */
export const MIN_PASSWORD_LENGTH = 8;

export interface PasswordRule {
  id: 'length' | 'number' | 'lowercase' | 'special';
  /** The checklist row. */
  label: string;
  met: (password: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { id: 'length', label: `At least ${MIN_PASSWORD_LENGTH} characters`, met: (p) => p.length >= MIN_PASSWORD_LENGTH },
  { id: 'number', label: 'A number', met: (p) => /[0-9]/.test(p) },
  { id: 'lowercase', label: 'A lowercase letter', met: (p) => /\p{Ll}/u.test(p) },
  // Identity counts anything that isn't a letter or a decimal digit.
  { id: 'special', label: 'A special character (like ! ? # @ £)', met: (p) => /[^\p{L}\p{Nd}]/u.test(p) },
];

export function passwordRuleStatus(password: string): { rule: PasswordRule; met: boolean }[] {
  return PASSWORD_RULES.map((rule) => ({ rule, met: rule.met(password) }));
}

export function passwordMeetsRules(password: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.met(password));
}

/** Identity's error codes, in the same words the API uses. */
const FRIENDLY_BY_CODE: Record<string, string> = {
  PasswordTooShort: `Your password needs at least ${MIN_PASSWORD_LENGTH} characters.`,
  PasswordRequiresDigit: 'Your password needs a number.',
  PasswordRequiresLower: 'Your password needs a lowercase letter.',
  PasswordRequiresUpper: 'Your password needs a capital letter.',
  PasswordRequiresNonAlphanumeric: 'Your password needs a special character (like ! ? # @ £).',
  PasswordRequiresUniqueChars: 'Your password needs a wider mix of characters.',
};

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
  const fromCodes = codes.map((c) => FRIENDLY_BY_CODE[c]).filter((m): m is string => !!m);
  if (fromCodes.length > 0 && fromCodes.length === codes.length) return [...new Set(fromCodes)];
  const texts = Array.isArray(data?.errors) ? data.errors.filter((e): e is string => typeof e === 'string') : [];
  return [...new Set(texts.map(friendlyPasswordText))];
}
