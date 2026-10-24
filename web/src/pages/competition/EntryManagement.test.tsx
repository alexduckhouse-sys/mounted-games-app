import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition } from '../../test/factories';
import { EntryManagement, type ExtendedSectionSignup } from './EntryManagement';
import { useEntrySettings } from './entrySettings';
vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
beforeEach(() => { vi.mocked(api.get).mockResolvedValue({ data: [] }); vi.mocked(api.put).mockResolvedValue({ data: {} }); vi.mocked(api.post).mockResolvedValue({ data: {} }); });
const entry = (id: number, extra: Partial<ExtendedSectionSignup> = {}): ExtendedSectionSignup => ({ id, competitionSectionId: 5, sectionName: 'Open Teams', fullName: `Synthetic ${id}`, amountMinor: 1000, status: 0, createdAt: '2026-01-01T00:00:00Z', ...extra });
function Settings() { const settings = useEntrySettings(competition()); return <p>{settings.closed ? 'Closed' : 'Open'}</p>; }
it('loads the server closing date and locks the entry view', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { competitionId: 1, entriesCloseAt: '2020-01-01T00:00:00Z', entriesClosed: true } });
  render(<Settings />);
  expect(await screen.findByText('Closed')).toBeInTheDocument();
});
it('saves a local closing date as UTC and can clear it', async () => {
  const changed = vi.fn();
  render(<EntryManagement competition={competition()} signups={[]} entriesCloseAt={null} onChanged={changed} />);
  fireEvent.change(screen.getByLabelText('Entry closing date and time'), { target: { value: '2027-05-06T12:30' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save closing date' }));
  expect(api.put).toHaveBeenCalledWith('/competitions/1/entry-settings', { entriesCloseAt: new Date('2027-05-06T12:30').toISOString() });
  expect(changed).toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Entry closing date and time'), { target: { value: '' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save closing date' }));
  expect(api.put).toHaveBeenLastCalledWith('/competitions/1/entry-settings', { entriesCloseAt: null });
});
it('shows a failed date save without claiming success', async () => {
  vi.mocked(api.put).mockRejectedValue(new Error('offline'));
  render(<EntryManagement competition={competition()} signups={[]} entriesCloseAt={null} />);
  await userEvent.click(screen.getByRole('button', { name: 'Save closing date' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('excludes waiting, withdrawn and refunded entries from stabling totals', async () => {
  render(<EntryManagement competition={competition()} entriesCloseAt={null} signups={[
    entry(1, { stablesCount: 2 }), entry(2, { stablesCount: 20, isWaitlist: true }), entry(3, { stablesCount: 20, isWithdrawn: true }), entry(4, { stablesCount: 20, status: 2 }),
  ]} />);
  expect(screen.getByText('Stabling list · 2 stables')).toBeInTheDocument();
});
it('marks pending BACS payments paid and lets staff complete a withdrawal refund', async () => {
  const changed = vi.fn();
  render(<EntryManagement competition={competition()} entriesCloseAt={null} onChanged={changed} signups={[entry(1), entry(2, { status: 3, isWithdrawn: true, refundPending: true })]} />);
  await userEvent.click(screen.getByText('Entries · 2'));
  await userEvent.click(screen.getByRole('button', { name: 'Mark Synthetic 1 as Paid' }));
  expect(api.post).toHaveBeenCalledWith('/competitions/1/signups/1/mark-paid', {});
  expect(screen.queryByRole('button', { name: 'Mark Synthetic 2 as Paid' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Mark Synthetic 2 refunded' }));
  expect(api.put).toHaveBeenCalledWith('/signups/2/status', { status: 2 });
  expect(changed).toHaveBeenCalledTimes(2);
});
it('keeps payment failures visible and leaves demo payments to checkout', async () => {
  vi.mocked(api.post).mockRejectedValue({ response: { data: { message: 'Section is full.' } } });
  const { unmount } = render(<EntryManagement competition={competition()} entriesCloseAt={null} signups={[entry(1, { isWaitlist: true })]} />);
  await userEvent.click(screen.getByText('Entries · 1'));
  await userEvent.click(screen.getByRole('button', { name: 'Mark Synthetic 1 as Paid' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Section is full.');
  unmount();
  render(<EntryManagement competition={competition({ isDemo: true })} entriesCloseAt={null} signups={[entry(1)]} />);
  await userEvent.click(screen.getByText('Entries · 1'));
  await waitFor(() => expect(screen.queryByRole('button', { name: /as Paid/ })).not.toBeInTheDocument());
});
