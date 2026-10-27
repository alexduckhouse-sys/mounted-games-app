/**
 * Tap-to-contact links for a trainer's phone number (staff only; the number comes from the private declaration
 * response and is never put in a public payload, print, cache or live message).
 *
 * Rule: a number is "international" only when it already says so, with a leading + or 00 followed by 8 to 15
 * digits that do not start with 0. We never guess a country code, so a national number such as 07700 900123
 * can be dialled (tel:) but gets no WhatsApp link. Spaces, dots, dashes and brackets are ignored; any other
 * character makes the number invalid.
 */

const SEPARATORS = /[\s.\-()]/g;

export interface ContactLinks {
  /** tel: link, or null when the value is not a plausible phone number. */
  call: string | null;
  /** https://wa.me link with the message filled in, or null unless the number is already international. */
  whatsApp: string | null;
}

/** Digits only (no +) of an already-international number, or null. */
export function internationalDigits(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(SEPARATORS, '');
  const match = /^(?:\+|00)([1-9]\d{7,14})$/.exec(cleaned);
  return match ? match[1] : null;
}

/** The number to dial: international as +digits, otherwise 6 to 15 digits as typed. Null when unusable. */
export function dialNumber(raw: string | null | undefined): string | null {
  const international = internationalDigits(raw);
  if (international) return `+${international}`;
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(SEPARATORS, '');
  return /^\d{6,15}$/.test(cleaned) ? cleaned : null;
}

/** Links for one contact, or null when there is nothing usable. `message` is the factual WhatsApp draft. */
export function contactLinks(raw: string | null | undefined, message: string): ContactLinks | null {
  const dial = dialNumber(raw);
  if (!dial) return null;
  const digits = internationalDigits(raw);
  return {
    call: `tel:${dial}`,
    whatsApp: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null,
  };
}

/** The plain, factual message for a team that is late to the collecting ring. */
export function ringMessage(heat: string, arena: string, team: string): string {
  return `${team}: you are wanted at the collecting ring for ${heat} in ${arena}.`;
}
