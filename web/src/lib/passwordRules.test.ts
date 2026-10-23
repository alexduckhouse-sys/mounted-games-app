import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MIN_PASSWORD_LENGTH, PASSWORD_RULES, friendlyPasswordErrors, friendlyPasswordText, passwordMeetsRules, passwordRuleStatus,
} from './passwordRules';

describe('password rules', () => {
  it('mirror the Identity options in api/Program.cs exactly', () => {
    const program = readFileSync(resolve(process.cwd(), '../api/Program.cs'), 'utf8');
    const option = (name: string) => program.match(new RegExp(`o\\.Password\\.${name}\\s*=\\s*([^;]+);`))?.[1].trim();
    expect(option('RequireDigit')).toBe('true');
    expect(option('RequireLowercase')).toBe('true');
    expect(option('RequireUppercase')).toBe('false');
    expect(option('RequireNonAlphanumeric')).toBe('true');
    expect(option('RequiredLength')).toBe(String(MIN_PASSWORD_LENGTH));
    expect(PASSWORD_RULES.map((r) => r.id)).toEqual(['length', 'number', 'lowercase', 'special']);
  });

  it('use the friendly wording', () => {
    expect(PASSWORD_RULES.map((r) => r.label)).toEqual([
      'At least 8 characters', 'A number', 'A lowercase letter', 'A special character (like ! ? # @ £)',
    ]);
  });

  it.each([
    ['', [false, false, false, false]],
    ['abcdefgh', [true, false, true, false]],
    ['abc1!', [false, true, true, true]],
    ['Passw0rd!x', [true, true, true, true]],
    ['passw0rd!x', [true, true, true, true]],
    ['PASSW0RD!X', [true, true, false, true]],
    ['Passw0rd x', [true, true, true, true]],
    ['Passw0rd£x', [true, true, true, true]],
    ['Passw0rdxx', [true, true, true, false]],
    ['Passwordd!', [true, false, true, true]],
  ])('checks %j', (password, expected) => {
    expect(passwordRuleStatus(password).map((r) => r.met)).toEqual(expected);
    expect(passwordMeetsRules(password)).toBe(expected.every(Boolean));
  });

  it('turns Identity error codes into friendly sentences', () => {
    const codes = ['PasswordTooShort', 'PasswordRequiresDigit', 'PasswordRequiresLower', 'PasswordRequiresUpper', 'PasswordRequiresNonAlphanumeric', 'PasswordRequiresUniqueChars'];
    const messages = friendlyPasswordErrors({ errorCodes: codes });
    expect(messages).toHaveLength(6);
    expect(messages).toContain('Your password needs a special character (like ! ? # @ £).');
    expect(messages.join(' ')).not.toMatch(/alphanumeric/i);
  });

  it('falls back to the response text, rewritten, when a code is unknown or missing', () => {
    expect(friendlyPasswordErrors({ errors: ['Needs a Non-Alphanumeric character.', 'Needs a digit.'], errorCodes: ['Mystery'] }))
      .toEqual(['Needs a special character.', 'Needs a digit.']);
    expect(friendlyPasswordErrors({ errors: ['Needs a non alphanumeric one.'] })).toEqual(['Needs a special one.']);
    expect(friendlyPasswordErrors({ errors: [1, 'x'], errorCodes: [2] })).toEqual(['x']);
    expect(friendlyPasswordErrors(undefined)).toEqual([]);
    expect(friendlyPasswordText('non-alphanumeric')).toBe('special');
  });
});
