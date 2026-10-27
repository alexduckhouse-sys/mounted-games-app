/**
 * Shapes shared by the message catalogues. A message is either plain text with optional `{name}`
 * placeholders, or a set of plural forms chosen with `Intl.PluralRules` from the `count` value.
 * Welsh uses all six plural categories, so every form except `other` is optional.
 */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type Message = string | PluralForms;

/** Values substituted into `{name}` placeholders. `count` also picks the plural form. */
export type MessageValues = Record<string, string | number>;

/**
 * One area's share of a non-English catalogue: any subset of the keys of the matching English area
 * (`AreaCatalogue<typeof enShell>`), so a typo in a key fails the type check. Keys left out fall back to English.
 */
export type AreaCatalogue<T> = Partial<Record<keyof T, Message>>;
