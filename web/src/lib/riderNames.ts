import type { RiderEntry } from '../types';

/** A rider's name as the public sees it: the surname shortens to an initial when the rider asked for that. */
export function publicRiderName(rider: Pick<RiderEntry, 'fullName' | 'useInitialOnly'>): string {
  const trimmed = rider.fullName.trim();
  if (!rider.useInitialOnly) return trimmed;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return trimmed;
  const last = parts[parts.length - 1];
  if (/^[A-Za-z]\.?$/.test(last)) return trimmed;
  return `${parts.slice(0, -1).join(' ')} ${last[0].toUpperCase()}.`;
}
