/**
 * Strict address check, matching `EmailValidation` in `api/Services/Email/AccountEmail.cs` (the API has the last
 * word, and also checks that the domain takes mail), plus "did you mean ...?" for common domain typos.
 */
const SHAPE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

export function isRealisticEmail(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.length <= 254 && SHAPE.test(v) && v.indexOf('@') <= 64;
}

/** Domains people at pony clubs actually use. A typo close to one of these gets a suggestion. */
export const COMMON_EMAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'outlook.co.uk', 'live.com', 'live.co.uk',
  'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'msn.com', 'aol.com', 'btinternet.com', 'sky.com', 'talktalk.net',
  'virginmedia.com', 'protonmail.com', 'proton.me',
] as const;

/** Edit distance counting a swap of two neighbouring letters as one change ("gmial" to "gmail"). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * A corrected address when the domain looks like a typo of a common one (gmial.com, hotmial.com, outlok.com), else
 * null. Known domains and anything not close to one are left alone.
 */
export function suggestEmailFix(value: string): string | null {
  const v = value.trim().toLowerCase();
  const at = v.lastIndexOf('@');
  if (at < 1 || at === v.length - 1) return null;
  const domain = v.slice(at + 1);
  if ((COMMON_EMAIL_DOMAINS as readonly string[]).includes(domain)) return null;
  let best: string = COMMON_EMAIL_DOMAINS[0];
  let bestDistance = Infinity;
  for (const known of COMMON_EMAIL_DOMAINS) {
    const distance = editDistance(domain, known);
    if (distance < bestDistance) { best = known; bestDistance = distance; }
  }
  // One slip always counts; two only on a longer name, so short or unusual domains aren't second-guessed.
  if (bestDistance === 0 || bestDistance > 2 || (bestDistance === 2 && domain.length < 9)) return null;
  return `${v.slice(0, at)}@${best}`;
}
