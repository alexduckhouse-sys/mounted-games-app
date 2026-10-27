// Unused in web UI yet — reserved for iOS / upcoming wiring
import type { CatalogueItemOption, CatalogueItemOptionInput, CreateEventOrderLine } from '../types';

/**
 * Seller-defined options (sizes) in the event shop, kept apart from the pages so the rules can be tested. Nothing here
 * guesses from an item's title: an item has exactly the options its seller gave it, and none when it was given none.
 * The API checks all of this again; these helpers only stop the buyer or seller from sending what will be refused.
 */

/** The parts of a catalogue item or public listing these helpers read. */
export interface ListingWithOptions {
  id: number;
  stockQuantity: number | null;
  options?: readonly CatalogueItemOption[] | null;
}

/** Matches the API's `CatalogueItemOption.MaxLabelLength`. */
export const MAX_OPTION_LABEL = 40;
/** Matches the API's `CatalogueItemOption.MaxOptions`. */
export const MAX_OPTIONS = 30;

/** The options the seller set up, in their order. Empty when there are none: never guessed from the title. */
export function optionsOf(listing: Pick<ListingWithOptions, 'options'>): CatalogueItemOption[] {
  return Array.isArray(listing.options) ? [...listing.options] : [];
}

export const hasOptions = (listing: Pick<ListingWithOptions, 'options'>): boolean => optionsOf(listing).length > 0;

/** True when the option has a stock limit and none is left. */
export const isSoldOut = (option: Pick<CatalogueItemOption, 'stockQuantity'>): boolean =>
  option.stockQuantity != null && option.stockQuantity <= 0;

/** True when every option is sold out (an item without options is never sold out here). */
export const allOptionsSoldOut = (listing: Pick<ListingWithOptions, 'options'>): boolean => {
  const options = optionsOf(listing);
  return options.length > 0 && options.every(isSoldOut);
};

/**
 * A basket holds quantities keyed by listing and option, so an M and an L of the same hoodie are separate lines.
 * Keys are `"<listingId>:<optionId>"`, or `"<listingId>:"` for an item without options.
 */
export type OptionBasket = Readonly<Record<string, number>>;

export const basketKey = (listingId: number, optionId: number | null | undefined): string => `${listingId}:${optionId ?? ''}`;

/** The listing and option a basket key stands for, or null for a key this module didn't make. */
export function parseBasketKey(key: string): { listingId: number; optionId: number | null } | null {
  const match = /^(\d+):(\d*)$/.exec(key);
  if (!match) return null;
  return { listingId: Number(match[1]), optionId: match[2] === '' ? null : Number(match[2]) };
}

export const quantityIn = (basket: OptionBasket, listingId: number, optionId: number | null | undefined): number =>
  basket[basketKey(listingId, optionId)] ?? 0;

/** How many of a listing are in the basket across all its options (the item's own stock covers them all). */
export function listingTotal(basket: OptionBasket, listingId: number): number {
  return Object.entries(basket).reduce((sum, [key, quantity]) => (parseBasketKey(key)?.listingId === listingId ? sum + quantity : sum), 0);
}

/**
 * The most of this listing and option the buyer can have in the basket: the option's stock, the item's stock less
 * what the other options already take, and 99 (the API's limit for one listing). 0 for a sold-out option.
 */
export function maxQuantity(listing: ListingWithOptions, optionId: number | null, basket: OptionBasket): number {
  const others = listingTotal(basket, listing.id) - quantityIn(basket, listing.id, optionId);
  let max = 99 - others;
  if (listing.stockQuantity != null) max = Math.min(max, listing.stockQuantity - others);
  if (optionId != null) {
    const option = optionsOf(listing).find((o) => o.id === optionId);
    if (!option) return 0;
    if (option.stockQuantity != null) max = Math.min(max, option.stockQuantity);
  }
  return Math.max(0, max);
}

/**
 * A new basket with this line set to `quantity` (clamped to what can be had). Zero removes the line. An item with
 * options needs one of its own options; anything else leaves the basket as it was.
 */
export function setQuantity(basket: OptionBasket, listing: ListingWithOptions, optionId: number | null, quantity: number): OptionBasket {
  const options = optionsOf(listing);
  if (options.length > 0 ? !options.some((o) => o.id === optionId) : optionId != null) return basket;
  const key = basketKey(listing.id, optionId);
  const next = { ...basket };
  const clamped = Math.min(Math.max(0, Math.floor(quantity) || 0), maxQuantity(listing, optionId, basket));
  if (clamped === 0) delete next[key];
  else next[key] = clamped;
  return next;
}

/**
 * Turns an older saved basket (quantities keyed by listing id alone) into this shape. Lines for items that now have
 * options are dropped, because the buyer has to choose one. Unknown or broken entries are dropped too.
 */
export function upgradeBasket(saved: unknown, listings: readonly ListingWithOptions[]): OptionBasket {
  if (!saved || typeof saved !== 'object') return {};
  const byId = new Map(listings.map((l) => [l.id, l]));
  let next: OptionBasket = {};
  for (const [key, value] of Object.entries(saved as Record<string, unknown>)) {
    if (typeof value !== 'number' || value <= 0) continue;
    const parsed = /^\d+$/.test(key) ? { listingId: Number(key), optionId: null } : parseBasketKey(key);
    const listing = parsed && byId.get(parsed.listingId);
    if (!listing) continue;
    next = setQuantity(next, listing, parsed.optionId, value);
  }
  return next;
}

/**
 * The order request's lines, one per listing and option, in a stable order. `details` holds the buyer's answer to an
 * item's prompt, by listing id; the option is its own field and is never written into the detail.
 */
export function orderLines(basket: OptionBasket, details: Readonly<Record<number, string>> = {}): CreateEventOrderLine[] {
  return Object.entries(basket)
    .map(([key, quantity]) => ({ parsed: parseBasketKey(key), quantity }))
    .filter((x): x is { parsed: { listingId: number; optionId: number | null }; quantity: number } => !!x.parsed && x.quantity > 0)
    .sort((a, b) => a.parsed.listingId - b.parsed.listingId || (a.parsed.optionId ?? 0) - (b.parsed.optionId ?? 0))
    .map(({ parsed, quantity }) => {
      const detail = details[parsed.listingId]?.trim();
      return {
        listingId: parsed.listingId,
        quantity,
        ...(detail ? { detail } : {}),
        ...(parsed.optionId != null ? { optionId: parsed.optionId } : {}),
      };
    });
}

/** "Hoodie · M" for an order line with an option, otherwise just the title. */
export function lineTitle(line: { title: string; optionLabel?: string | null }): string {
  const label = line.optionLabel?.trim();
  return label ? `${line.title} · ${label}` : line.title;
}

/** The seller's editor rows for an item's saved options (each keeps its id, so its sales stay with it). */
export function optionInputsFrom(options: readonly CatalogueItemOption[] | null | undefined): CatalogueItemOptionInput[] {
  return (options ?? []).map((o) => ({ id: o.id, label: o.label, stockQuantity: o.stockQuantity }));
}

/** New editor rows from a typed list, such as "XS, S, M, L" or one per line. Blanks and repeats are skipped. */
export function optionsFromText(text: string, existing: readonly CatalogueItemOptionInput[] = []): CatalogueItemOptionInput[] {
  const seen = new Set(existing.map((o) => o.label.trim().toLowerCase()));
  const added: CatalogueItemOptionInput[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const label = raw.trim();
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    added.push({ label, stockQuantity: null });
  }
  return [...existing, ...added];
}

/** The same checks as the API: what's wrong with the seller's options, or null when they can be saved. */
export function optionsProblem(options: readonly CatalogueItemOptionInput[]): string | null {
  if (options.length > MAX_OPTIONS) return `An item can have at most ${MAX_OPTIONS} options.`;
  const seen = new Set<string>();
  for (const option of options) {
    const label = option.label.trim();
    if (!label) return 'Each option needs a name, like M or Age 9-10.';
    if (label.length > MAX_OPTION_LABEL) return `Option names can be at most ${MAX_OPTION_LABEL} characters.`;
    if (option.stockQuantity != null && (!Number.isInteger(option.stockQuantity) || option.stockQuantity < 0)) {
      return `Stock for ${label} must be a whole number, 0 or more.`;
    }
    if (seen.has(label.toLowerCase())) return `${label} is listed twice. Give each option a different name.`;
    seen.add(label.toLowerCase());
  }
  return null;
}

/** The `options` to send: labels trimmed, blank stock as no limit. */
export function optionsBody(options: readonly CatalogueItemOptionInput[]): CatalogueItemOptionInput[] {
  return options.map((o) => ({
    ...(o.id != null ? { id: o.id } : {}),
    label: o.label.trim(),
    stockQuantity: o.stockQuantity ?? null,
  }));
}
