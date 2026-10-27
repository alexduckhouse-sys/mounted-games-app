import { describe, expect, it } from 'vitest';
import { AREAS as EN_AREAS, en } from './en';
import { AREAS as CY_AREAS, cy } from './cy';
import { AREAS as FR_AREAS, fr } from './fr';
import type { Message } from './messages';

/** Keys that deliberately stay in English in a language (and so fall back). Keep this list short and explain each entry. */
const DELIBERATE_FALLBACK: Record<'cy' | 'fr', string[]> = {
  // Apple's and Facebook's own button wording. They publish no Welsh version we could check, and their brand rules ask
  // for their exact text, so Welsh shows the English (see REVIEW.md).
  cy: ['auth.social.appleSignIn', 'auth.social.appleContinue', 'auth.social.facebookContinue'],
  fr: [],
};

const placeholders = (text: string) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]));
const forms = (message: Message): string[] => (typeof message === 'string' ? [message] : Object.values(message).filter((form): form is string => typeof form === 'string'));
const union = (message: Message) => new Set(forms(message).flatMap((text) => [...placeholders(text)]));

const LANGUAGES = [
  { id: 'cy', catalogue: cy, areas: CY_AREAS },
  { id: 'fr', catalogue: fr, areas: FR_AREAS },
] as const;

describe('English catalogue', () => {
  it('keeps every key under its own area prefix and never repeats a key across areas', () => {
    const seen = new Set<string>();
    for (const [area, catalogue] of Object.entries(EN_AREAS)) {
      for (const key of Object.keys(catalogue)) {
        expect(key.startsWith(`${area}.`), `${key} is in the ${area} file`).toBe(true);
        expect(seen.has(key), `${key} is defined twice`).toBe(false);
        seen.add(key);
      }
    }
    expect(seen.size).toBe(Object.keys(en).length);
  });

  it('has text for every key, and an `other` form on every plural', () => {
    for (const [key, message] of Object.entries(en) as [string, Message][]) {
      if (typeof message === 'string') expect(message.length, key).toBeGreaterThan(0);
      else expect(typeof message.other === 'string' && message.other.length > 0, `${key} needs an other form`).toBe(true);
    }
  });
});

describe.each(LANGUAGES)('$id catalogue', ({ id, catalogue, areas }) => {
  it('has the same areas as English', () => {
    expect(Object.keys(areas)).toEqual(Object.keys(EN_AREAS));
  });

  it('keeps each key under its own area prefix', () => {
    for (const [area, part] of Object.entries(areas)) {
      for (const key of Object.keys(part)) expect(key.startsWith(`${area}.`), `${id} ${key} is in the ${area} file`).toBe(true);
    }
  });

  it('translates every English key, apart from the deliberate fallbacks', () => {
    const missing = Object.keys(en).filter((key) => !(key in catalogue) && !DELIBERATE_FALLBACK[id].includes(key));
    expect(missing).toEqual([]);
  });

  it('has no keys that English does not', () => {
    expect(Object.keys(catalogue).filter((key) => !(key in en))).toEqual([]);
  });

  it('keeps every {placeholder} and has an `other` form on every plural', () => {
    for (const [key, message] of Object.entries(catalogue) as [string, Message][]) {
      const source = (en as Record<string, Message>)[key];
      if (!source) continue;
      if (typeof message !== 'string') {
        expect(typeof message.other === 'string' && message.other.length > 0, `${id} ${key} needs an other form`).toBe(true);
      }
      const wanted = union(source);
      const got = union(message);
      for (const name of wanted) expect(got.has(name), `${id} ${key} is missing {${name}}`).toBe(true);
      for (const name of got) expect(wanted.has(name), `${id} ${key} has an unknown {${name}}`).toBe(true);
      if (typeof source === 'string' && typeof message === 'string') expect([...placeholders(message)].sort()).toEqual([...placeholders(source)].sort());
    }
  });

  it('does not leave blank text', () => {
    for (const [key, message] of Object.entries(catalogue) as [string, Message][]) {
      for (const text of forms(message)) expect(text.trim().length, `${id} ${key}`).toBeGreaterThan(0);
    }
  });

  it('does not contain stray key names in place of text', () => {
    for (const [key, message] of Object.entries(catalogue) as [string, Message][]) {
      for (const text of forms(message)) expect(text, `${id} ${key}`).not.toMatch(/^[a-z]+\.[a-zA-Z.]+$/);
    }
  });
});
