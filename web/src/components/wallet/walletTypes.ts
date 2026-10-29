import { api } from '../../api';
export type ArrivalStatus = 'paid' | 'pending' | 'cancelled' | 'unavailable' | 'none' | 'review' | 'conflict';
export interface ArrivalBenefit { sourceId: number; orderLineId: number; kind: 0 | 1 | 2 | 3 | 4; quantity: number; status: ArrivalStatus; fromDate: string | null; untilDate: string | null; allocations: { resource: string; night: string }[] }
export interface ArrivalBooking { id: string; competitionId: number; competitionName: string; startDate: string; endDate: string | null; venue: string | null; vehicleRegistration: string; reference: string; revision: number; admission: ArrivalStatus; benefits: ArrivalBenefit[]; needsReview: boolean; voided: boolean; walletAvailable: boolean; signupId?: number | null }
export interface ArrivalEntitlement { orderLineId: number; title: string; kind: 0 | 1 | 2 | 3 | 4; quantity: number; assigned: number; revision: number; status: ArrivalStatus; fromDate: string | null; untilDate: string | null }
type JsonRecord = Record<string, unknown>;
const record = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && Number(value) >= minimum;
const nullableText = (value: unknown) => value === null || typeof value === 'string';
const status = (value: unknown): value is ArrivalStatus => typeof value === 'string' && ['paid', 'pending', 'cancelled', 'unavailable', 'none', 'review', 'conflict'].includes(value);
const kind = (value: unknown) => integer(value) && value <= 4;
const allocation = (value: unknown) => record(value) && typeof value.resource === 'string' && typeof value.night === 'string';
const benefit = (value: unknown) => record(value) && integer(value.sourceId, 1) && integer(value.orderLineId, 1)
  && kind(value.kind) && integer(value.quantity, 1) && status(value.status) && nullableText(value.fromDate) && nullableText(value.untilDate)
  && Array.isArray(value.allocations) && value.allocations.every(allocation);
const booking = (value: unknown): value is ArrivalBooking => record(value) && typeof value.id === 'string' && value.id.length > 0
  && integer(value.competitionId, 1) && typeof value.competitionName === 'string' && typeof value.startDate === 'string'
  && nullableText(value.endDate) && nullableText(value.venue) && typeof value.vehicleRegistration === 'string'
  && typeof value.reference === 'string' && value.reference.length > 0 && integer(value.revision) && status(value.admission)
  && Array.isArray(value.benefits) && value.benefits.every(benefit)
  && typeof value.needsReview === 'boolean' && typeof value.voided === 'boolean' && typeof value.walletAvailable === 'boolean'
  && (value.signupId === undefined || value.signupId === null || integer(value.signupId, 1));
const entitlement = (value: unknown): value is ArrivalEntitlement => record(value) && integer(value.orderLineId, 1)
  && typeof value.title === 'string' && kind(value.kind) && integer(value.quantity) && integer(value.assigned)
  && integer(value.revision) && status(value.status) && nullableText(value.fromDate) && nullableText(value.untilDate);
function parseList<T>(value: unknown, valid: (item: unknown) => item is T): T[] {
  if (!Array.isArray(value) || !value.every(valid)) throw new Error('Invalid arrival response');
  return value;
}
/** An unexpected response must never become a downloadable or verified entitlement. */
export function parseArrivalBooking(value: unknown): ArrivalBooking {
  if (!booking(value)) throw new Error('Invalid arrival response');
  return value;
}
export const parseArrivalBookings = (value: unknown) => parseList(value, booking);
export const parseArrivalEntitlements = (value: unknown) => parseList(value, entitlement);
export const parseArrivalEvents = (value: unknown) => parseList(value, (item): item is { id: number; name: string } => record(item) && integer(item.id, 1) && typeof item.name === 'string');

export async function downloadApplePass(booking: ArrivalBooking) {
  const { data } = await api.get<Blob>(`/competitions/${booking.competitionId}/arrival-bookings/${booking.id}/wallet`, { responseType: 'blob' });
  const url = URL.createObjectURL(data); const a = document.createElement('a'); a.href = url; a.download = 'arrival.pkpass'; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
