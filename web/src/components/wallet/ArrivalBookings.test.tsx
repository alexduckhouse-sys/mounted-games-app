import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ArrivalBookingCard, ArrivalBookings, ArrivalGateLookup, MyArrivalBookings } from './ArrivalBookings';
import { CatalogueFulfilmentEditor } from './CatalogueFulfilmentEditor';
import type { ArrivalBooking } from './walletTypes';
const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), t: (key: string) => key }));
vi.mock('../../api', () => ({ api: mock }));
vi.mock('../../i18n/LanguageContext', () => ({ useT: () => mock.t }));
const booking: ArrivalBooking = { id: 'example', competitionId: 1, competitionName: 'Example event', startDate: '2026-10-29', endDate: null, venue: null, vehicleRegistration: 'EXAMPLE', reference: 'opaque', revision: 2, signupId: 12, admission: 'paid', needsReview: false, voided: false, walletAvailable: false,
  benefits: [{ sourceId: 9, orderLineId: 10, kind: 3, quantity: 1, status: 'paid', fromDate: '2026-10-29', untilDate: '2026-10-31', allocations: [{ resource: 'A1', night: '2026-10-29' }] }] };
beforeEach(() => { vi.clearAllMocks(); mock.put.mockResolvedValue({ data: {} }); mock.post.mockResolvedValue({ data: {} }); });
it('removes an allocation through the revision-checked booking endpoint', async () => {
  const changed = vi.fn(); render(<ArrivalBookingCard booking={booking} staff onChanged={changed} />);
  fireEvent.click(screen.getByRole('button', { name: 'apple.arrival.removeAllocation A1 2026-10-29' }));
  await waitFor(() => expect(mock.put).toHaveBeenCalledWith('/competitions/1/arrival-bookings/example/allocations', { expectedRevision: 2, allocations: [] }));
  expect(changed).toHaveBeenCalled();
});
it('keeps the entrant context when staff add a second vehicle', async () => {
  mock.get.mockImplementation((path: string) => Promise.resolve({ data: path.endsWith('/entitlements') ? [{ orderLineId: 10, title: 'Example stable', kind: 3, quantity: 2, assigned: 1, revision: 0, status: 'paid', fromDate: '2026-10-29', untilDate: '2026-10-31' }] : [booking] }));
  render(<ArrivalBookings competitionId={1} signupId={12} staff />);
  fireEvent.click(await screen.findByRole('button', { name: 'apple.arrival.more' }));
  fireEvent.click(screen.getByRole('button', { name: 'apple.arrival.add' }));
  await waitFor(() => expect(mock.post).toHaveBeenCalledWith('/competitions/1/arrival-bookings', { expectedRevision: 0, signupId: null, vehicleRegistration: '', sources: [{ orderLineId: 10, quantity: 1 }] }, { params: { forSignupId: 12 } }));
});
it('saves catalogue classification with its version and explicit exclusive departure date', async () => {
  mock.get.mockResolvedValue({ data: { kind: 3, fromDate: '2026-10-29', untilDate: '2026-10-31', expectedVersion: 7 } });
  mock.put.mockResolvedValue({ data: { kind: 3, fromDate: '2026-10-29', untilDate: '2026-11-01', expectedVersion: 8 } });
  const changed = vi.fn().mockResolvedValue(undefined); render(<CatalogueFulfilmentEditor itemId={4} onChanged={changed} />);
  fireEvent.change(await screen.findByLabelText('apple.arrival.departure'), { target: { value: '2026-11-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'apple.arrival.confirmKind' }));
  await waitFor(() => expect(mock.put).toHaveBeenCalledWith('/apple/catalogue/4/fulfilment', { kind: 3, fromDate: '2026-10-29', untilDate: '2026-11-01', expectedVersion: 7 }));
  expect(changed).toHaveBeenCalled();
});

it('clears the previous vehicle when verification of a second scan fails', async () => {
  window.history.replaceState({}, '', '/?arrival=first');
  mock.get.mockResolvedValueOnce({ data: booking }).mockRejectedValueOnce(new Error('unavailable'));
  const view = render(<ArrivalGateLookup competitionId={1} />);
  expect(await screen.findByText('EXAMPLE')).toBeTruthy();
  window.history.replaceState({}, '', '/?arrival=second');
  view.rerender(<ArrivalGateLookup competitionId={2} />);
  await screen.findByText('apple.arrival.gateError');
  expect(screen.queryByText('EXAMPLE')).toBeNull();
  window.history.replaceState({}, '', '/');
});

it.each([
  { rows: { unexpected: true }, lines: [] },
  { rows: [{ ...booking, benefits: undefined }], lines: [] },
  { rows: [{ ...booking, benefits: [{ ...booking.benefits[0], allocations: [null] }] }], lines: [] },
  { rows: [booking], lines: { unexpected: true } },
  { rows: [booking], lines: [{ orderLineId: 10, quantity: 2 }] },
])('keeps malformed booking data local and lets the user retry: %j', async ({ rows, lines }) => {
  mock.get.mockImplementation((path: string) => Promise.resolve({ data: path.endsWith('/entitlements') ? lines : rows }));
  render(<ArrivalBookings competitionId={1} signupId={12} />);
  await screen.findByText('apple.arrival.error');
  expect(screen.queryByRole('button', { name: 'apple.arrival.download' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'apple.arrival.add' })).toBeNull();
  mock.get.mockImplementation((path: string) => Promise.resolve({ data: path.endsWith('/entitlements') ? [] : [booking] }));
  fireEvent.click(screen.getByRole('button', { name: 'common.tryAgain' }));
  expect(await screen.findByRole('button', { name: 'apple.arrival.download' })).toBeTruthy();
  expect(screen.queryByText('apple.arrival.error')).toBeNull();
});

it('does not show a preceding entrant booking after switching context while its request is in flight', async () => {
  let oldResponse!: (value: { data: ArrivalBooking[] }) => void;
  mock.get.mockImplementation((path: string) => path.endsWith('/entitlements') ? Promise.resolve({ data: [] }) : new Promise(resolve => { oldResponse = resolve; }));
  const view = render(<ArrivalBookings competitionId={1} signupId={12} />);
  mock.get.mockResolvedValue({ data: [] });
  view.rerender(<ArrivalBookings competitionId={1} signupId={13} />);
  await screen.findByRole('button', { name: 'apple.arrival.add' });
  oldResponse({ data: [booking] });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'apple.arrival.download' })).toBeNull());
});

it.each([null, {}, [null], [{ id: 1 }]])('contains an invalid arrival-event list without crashing the entry page: %j', async data => {
  mock.get.mockResolvedValue({ data });
  render(<><p>Entry details</p><MyArrivalBookings /></>);
  expect(await screen.findByText('apple.arrival.error')).toBeTruthy();
  expect(screen.getByText('Entry details')).toBeTruthy();
});

it('rejects a malformed gate response rather than presenting it as verified', async () => {
  window.history.replaceState({}, '', '/?arrival=example');
  mock.get.mockResolvedValue({ data: { ...booking, benefits: null } });
  render(<ArrivalGateLookup competitionId={1} />);
  expect(await screen.findByText('apple.arrival.gateError')).toBeTruthy();
  expect(screen.queryByText('EXAMPLE')).toBeNull();
  window.history.replaceState({}, '', '/');
});

it('saves a changed vehicle only, keeps the revision and permits retry after failure', async () => {
  const changed = vi.fn(); render(<ArrivalBookingCard booking={booking} onChanged={changed} />);
  const vehicle = screen.getByLabelText('apple.arrival.vehicle'); fireEvent.blur(vehicle); expect(mock.put).not.toHaveBeenCalled();
  mock.put.mockRejectedValueOnce({ response: { data: { message: 'The booking changed.' } } });
  fireEvent.change(vehicle, { target: { value: 'example two' } }); fireEvent.blur(vehicle);
  expect(await screen.findByText('The booking changed.')).toBeTruthy(); expect(changed).not.toHaveBeenCalled();
  fireEvent.blur(vehicle); await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(mock.put).toHaveBeenLastCalledWith('/competitions/1/arrival-bookings/example', { expectedRevision: 2, vehicleRegistration: 'EXAMPLE TWO', sources: [{ orderLineId: 10, quantity: 1 }] });
});
it.each([1, 2])('releases one unit of a source quantity of %i while preserving the other purchases', async quantity => {
  const extra = { ...booking.benefits[0], sourceId: 10, orderLineId: 11, quantity: 3 };
  const changed = vi.fn(); render(<ArrivalBookingCard booking={{ ...booking, benefits: [{ ...booking.benefits[0], quantity }, extra] }} onChanged={changed} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'apple.arrival.releaseOne' })[0]);
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(mock.put).toHaveBeenCalledWith('/competitions/1/arrival-bookings/example', { expectedRevision: 2, vehicleRegistration: 'EXAMPLE', sources: [...(quantity === 2 ? [{ orderLineId: 10, quantity: 1 }] : []), { orderLineId: 11, quantity: 3 }] });
});
it('retains a unit when its release fails and does not leave the buttons disabled', async () => {
  mock.put.mockRejectedValueOnce(new Error('offline')); render(<ArrivalBookingCard booking={booking} />);
  fireEvent.click(screen.getByRole('button', { name: 'apple.arrival.releaseOne' }));
  expect(await screen.findByText('apple.arrival.error')).toBeTruthy(); expect(screen.getByRole('button', { name: 'apple.arrival.releaseOne' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'apple.arrival.releaseOne' })); await waitFor(() => expect(mock.put).toHaveBeenCalledTimes(2));
});
it('keeps allocations visible after a rejected change and allows an explicit date retry', async () => {
  mock.put.mockRejectedValueOnce({ response: { data: { message: 'That box is already allocated.' } } });
  render(<ArrivalBookingCard booking={booking} staff />);
  const allocate = screen.getByRole('button', { name: 'apple.arrival.allocate' }); expect(allocate).toBeDisabled();
  fireEvent.change(screen.getByLabelText('apple.arrival.resource'), { target: { value: 'B2' } });
  fireEvent.change(screen.getByLabelText('apple.arrival.night'), { target: { value: '2026-10-30' } }); fireEvent.click(allocate);
  expect(await screen.findByText('That box is already allocated.')).toBeTruthy(); expect(screen.getByText('A1 · 2026-10-29')).toBeTruthy();
  fireEvent.click(allocate); await waitFor(() => expect(mock.put).toHaveBeenCalledTimes(2));
  expect(mock.put).toHaveBeenLastCalledWith('/competitions/1/arrival-bookings/example/allocations', { expectedRevision: 2, allocations: [{ sourceId: 9, resource: 'A1', night: '2026-10-29' }, { sourceId: 9, resource: 'B2', night: '2026-10-30' }] });
  expect(screen.getByLabelText('apple.arrival.resource')).toHaveValue('');
});
it('offers staff reconciliation for legacy bookings and reports a failed attempt', async () => {
  mock.post.mockRejectedValueOnce(new Error('offline')); const changed = vi.fn(); render(<ArrivalBookingCard booking={{ ...booking, needsReview: true, walletAvailable: true }} staff onChanged={changed} />);
  expect(screen.queryByRole('button', { name: 'apple.arrival.wallet' })).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'apple.arrival.reconcile' }));
  expect(await screen.findByText('apple.arrival.error')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'apple.arrival.reconcile' }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce()); expect(mock.post).toHaveBeenCalledWith('/competitions/1/arrival-bookings/example/reconcile-legacy?expectedRevision=2');
});
it('downloads both the printable card and a signed Wallet pass, then releases the Wallet URL', async () => {
  const urls: string[] = []; vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { const url = `blob:example-${urls.length}`; urls.push(url); return url; });
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}); const downloads: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
  mock.get.mockResolvedValue({ data: new Blob(['signed pass'], { type: 'application/vnd.apple.pkpass' }) });
  render(<ArrivalBookingCard booking={{ ...booking, walletAvailable: true }} />); fireEvent.click(screen.getByRole('button', { name: 'apple.arrival.download' }));
  expect(downloads).toContain('lorry-stabling-pass-1-0.html'); expect(revoke).toHaveBeenCalledWith('blob:example-0');
  vi.useFakeTimers();
  try { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'apple.arrival.wallet' })); });
    expect(mock.get).toHaveBeenCalledWith('/competitions/1/arrival-bookings/example/wallet', { responseType: 'blob' }); expect(downloads).toContain('arrival.pkpass');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); expect(revoke).toHaveBeenCalledWith('blob:example-1');
  } finally { vi.useRealTimers(); }
});
it('keeps the printable fallback available when Apple Wallet fails', async () => {
  mock.get.mockRejectedValue(new Error('unavailable')); render(<ArrivalBookingCard booking={{ ...booking, walletAvailable: true }} />);
  fireEvent.click(screen.getByRole('button', { name: 'apple.arrival.wallet' })); expect(await screen.findByText('apple.arrival.walletError')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'apple.arrival.wallet' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'apple.arrival.download' })).toBeEnabled();
});
it('selects and releases available quantities before creating a first booking, retaining them after failure', async () => {
  mock.get.mockImplementation((path: string) => Promise.resolve({ data: path.endsWith('/entitlements') ? [{ orderLineId: 10, title: 'Example stable', kind: 3, quantity: 2, assigned: 0, revision: 0, status: 'pending', fromDate: null, untilDate: null }] : [] }));
  mock.post.mockRejectedValueOnce({ response: { data: { message: 'Quantity changed.' } } }); render(<ArrivalBookings competitionId={1} signupId={12} />);
  const add = await screen.findByRole('button', { name: 'apple.arrival.more' }); const fewer = screen.getByRole('button', { name: 'apple.arrival.fewer' }); expect(fewer).toBeDisabled();
  fireEvent.click(add); fireEvent.click(add); expect(add).toBeDisabled(); fireEvent.click(fewer); fireEvent.click(screen.getByRole('button', { name: 'apple.arrival.add' }));
  expect(await screen.findByText('Quantity changed.')).toBeTruthy(); expect(mock.post).toHaveBeenCalledWith('/competitions/1/arrival-bookings', { expectedRevision: 0, signupId: 12, vehicleRegistration: '', sources: [{ orderLineId: 10, quantity: 1 }] }, { params: { forSignupId: 12 } });
  fireEvent.click(screen.getByRole('button', { name: 'apple.arrival.add' })); await waitFor(() => expect(fewer).toBeDisabled());
});
it('lets staff classify a legacy order with dates, and an admission item without dates', async () => {
  mock.get.mockImplementation((path: string) => Promise.resolve({ data: path.endsWith('/entitlements') ? [{ orderLineId: 10, title: 'Legacy example', kind: 0, quantity: 2, assigned: 0, revision: 4, status: 'paid', fromDate: null, untilDate: null }] : [] }));
  render(<ArrivalBookings competitionId={1} staff />); const confirm = await screen.findByRole('button', { name: 'apple.arrival.confirmKind' }); expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByLabelText('apple.arrival.firstNight'), { target: { value: '2026-10-29' } }); fireEvent.change(screen.getByLabelText('apple.arrival.departure'), { target: { value: '2026-10-31' } });
  mock.put.mockRejectedValueOnce(new Error('offline')); fireEvent.click(confirm); expect(await screen.findByText('apple.arrival.error')).toBeTruthy();
  fireEvent.click(confirm); await waitFor(() => expect(mock.put).toHaveBeenCalledWith('/competitions/1/arrival-bookings/order-lines/10/fulfilment', { kind: 3, fromDate: '2026-10-29', untilDate: '2026-10-31', expectedVersion: 4 }));
  fireEvent.change(screen.getByLabelText('apple.arrival.firstNight'), { target: { value: '' } }); fireEvent.change(screen.getByLabelText('apple.arrival.departure'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('combobox', { name: 'apple.arrival.kind apple.arrival.kind3' })); fireEvent.click(screen.getByRole('option', { name: 'apple.arrival.kind2' })); fireEvent.click(confirm);
  await waitFor(() => expect(mock.put).toHaveBeenLastCalledWith('/competitions/1/arrival-bookings/order-lines/10/fulfilment', { kind: 2, fromDate: null, untilDate: null, expectedVersion: 4 }));
});
it('opens and closes shop-only arrival events without creating a signup', async () => {
  mock.get.mockImplementation((path: string) => Promise.resolve({ data: path === '/apple/arrival-events' ? [{ id: 1, name: 'Example shop event' }] : [] })); render(<MyArrivalBookings />);
  const event = await screen.findByRole('button', { name: 'Example shop event' }); expect(event).toHaveAttribute('aria-expanded', 'false'); fireEvent.click(event);
  await waitFor(() => expect(mock.get).toHaveBeenCalledWith('/competitions/1/arrival-bookings', { params: {} })); expect(event).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(event); expect(event).toHaveAttribute('aria-expanded', 'false'); expect(mock.post).not.toHaveBeenCalled();
});
it('shows a warning on a voided gate booking and performs no request without a reference', async () => {
  window.history.replaceState({}, '', '/'); const view = render(<ArrivalGateLookup competitionId={1} />); expect(mock.get).not.toHaveBeenCalled();
  window.history.replaceState({}, '', '/?arrival=example'); mock.get.mockResolvedValue({ data: { ...booking, voided: true } }); view.rerender(<ArrivalGateLookup competitionId={1} />);
  expect(await screen.findByText('apple.arrival.review')).toBeTruthy(); window.history.replaceState({}, '', '/');
});

it('shows loading and then an empty message when the panel has no bookings or purchases', async () => {
  let resolve!: (value: { data: never[] }) => void;
  mock.get.mockImplementation((path: string) => path.endsWith('/entitlements') ? Promise.resolve({ data: [] }) : new Promise(done => { resolve = done; }));
  render(<ArrivalBookings competitionId={1} />); expect(screen.getByRole('status')).toHaveTextContent('common.loading');
  await act(async () => { resolve({ data: [] }); }); expect(screen.getByText('apple.arrival.empty')).toBeTruthy(); expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByRole('button', { name: 'apple.arrival.add' })).toBeNull();
});
it('shows the create action instead of an empty message for a signup without a booking', async () => {
  mock.get.mockResolvedValue({ data: [] }); render(<ArrivalBookings competitionId={1} signupId={12} />);
  expect(await screen.findByRole('button', { name: 'apple.arrival.add' })).toBeTruthy(); expect(screen.queryByText('apple.arrival.empty')).toBeNull();
});
it('handles catalogue loading and save errors without losing the editable dates', async () => {
  mock.get.mockRejectedValueOnce(new Error('offline')); const changed = vi.fn().mockResolvedValue(undefined); const view = render(<CatalogueFulfilmentEditor itemId={4} onChanged={changed} />);
  expect(await screen.findByText('apple.arrival.error')).toBeTruthy(); view.unmount();
  mock.get.mockResolvedValue({ data: { kind: 4, fromDate: null, untilDate: null, expectedVersion: 3 } });
  render(<CatalogueFulfilmentEditor itemId={4} onChanged={changed} />);
  fireEvent.change(await screen.findByLabelText('apple.arrival.firstNight'), { target: { value: '2026-10-29' } });
  fireEvent.change(screen.getByLabelText('apple.arrival.departure'), { target: { value: '2026-10-29' } }); expect(screen.getByRole('button', { name: 'apple.arrival.confirmKind' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('apple.arrival.departure'), { target: { value: '2026-10-31' } }); mock.put.mockRejectedValueOnce({ response: { data: { message: 'Item changed.' } } });
  fireEvent.click(screen.getByRole('button', { name: 'apple.arrival.confirmKind' })); expect(await screen.findByText('Item changed.')).toBeTruthy();
  expect(screen.getByLabelText('apple.arrival.firstNight')).toHaveValue('2026-10-29'); expect(screen.getByRole('button', { name: 'apple.arrival.confirmKind' })).toBeEnabled(); expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('combobox')); fireEvent.click(screen.getByRole('option', { name: 'apple.arrival.kind1' }));
  expect(screen.queryByLabelText('apple.arrival.firstNight')).toBeNull();
  mock.put.mockResolvedValue({ data: { kind: 1, fromDate: null, untilDate: null, expectedVersion: 4 } });
  fireEvent.click(screen.getByRole('button', { name: 'apple.arrival.confirmKind' })); expect(await screen.findByRole('status')).toHaveTextContent('ops2.signup.saved'); expect(changed).toHaveBeenCalledOnce();
});
it.each([false, true])('ignores a catalogue response after unmount, including a rejected one: %s', async fail => {
  let resolve!: (value: unknown) => void; let reject!: (error: Error) => void; mock.get.mockImplementation(() => new Promise((done, failed) => { resolve = done; reject = failed; }));
  const view = render(<CatalogueFulfilmentEditor itemId={4} onChanged={vi.fn()} />); view.unmount();
  await act(async () => { if (fail) reject(new Error('offline')); else resolve({ data: { kind: 1, fromDate: null, untilDate: null, expectedVersion: 0 } }); });
  expect(screen.queryByText('apple.arrival.error')).toBeNull();
});
