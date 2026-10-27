import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import { EntriesDigestCard } from './EntriesDigestCard';
import { lastRunText, nextSendText } from './entriesDigestText';
import type { EntriesDigestRun, EntriesDigestStatus } from './entriesDigestTypes';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const run = (extra: Partial<EntriesDigestRun> = {}): EntriesDigestRun => ({
  id: 1, runDate: '2026-10-24', status: 1, manual: false, competitions: 2, total: 12, sent: 11, failed: 1, skipped: 0, remaining: 0,
  claimedAt: '2026-10-24T17:00:00Z', completedAt: '2026-10-24T17:02:00Z', ...extra,
});
const status = (extra: Partial<EntriesDigestStatus> = {}): EntriesDigestStatus => ({
  canSend: true, cannotSendBecause: null, recipients: 12, pendingCount: 2,
  pending: [{ id: 1, name: 'Spring Cup', startDate: '2026-11-07T09:00:00Z', location: 'Hartpury' }, { id: 2, name: 'Autumn Open', startDate: '2026-11-14T09:00:00Z', location: null }],
  last: null, todayClaimed: false, nextSendUtc: '2099-01-01T18:00:00Z', ...extra,
});

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ data: status() } as never);
});

describe('EntriesDigestCard', () => {
  it('shows what is waiting, who is on the list and what happens next', async () => {
    render(<EntriesDigestCard />);
    expect(await screen.findByText(/2 competitions: Spring Cup, Autumn Open/)).toBeInTheDocument();
    expect(screen.getByText('12 people')).toBeInTheDocument();
    expect(screen.getByText('None yet')).toBeInTheDocument();
    expect(screen.getAllByText(/around 6pm/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: 'Send now' })).toBeEnabled();
  });

  it('says so when nothing is new, and offers nothing to send', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: status({ pendingCount: 0, pending: [], last: run() }) } as never);
    render(<EntriesDigestCard />);
    expect(await screen.findByText('Nothing new')).toBeInTheDocument();
    expect(screen.getByText(/11 sent, 1 didn’t go through/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send now' })).toBeDisabled();
  });

  it('explains why it cannot send when email is off', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: status({ canSend: false, cannotSendBecause: 'Email sending is switched off on this server, so nothing can be sent.' }) } as never);
    render(<EntriesDigestCard />);
    expect(await screen.findByText(/switched off on this server/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send now' })).toBeDisabled();
  });

  it('says it has gone today and does not offer to send again', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: status({ todayClaimed: true, last: run() }) } as never);
    render(<EntriesDigestCard />);
    expect(await screen.findByText(/Today’s has gone/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send now' })).toBeDisabled();
  });

  it('asks first, then sends until nobody is left', async () => {
    const asked = autoConfirm(true);
    vi.mocked(api.post)
      .mockResolvedValueOnce({ data: status({ todayClaimed: true, last: run({ status: 0, sent: 5, remaining: 7 }) }) } as never)
      .mockResolvedValueOnce({ data: status({ todayClaimed: true, pendingCount: 0, pending: [], last: run({ sent: 12, failed: 0 }) }) } as never);
    render(<EntriesDigestCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(asked.titles).toEqual(['Send it now?']);
    expect(asked.mock.calls[0][0]).toMatch(/12 people will get one email about 2 competitions/);
    expect(api.post).toHaveBeenCalledWith('/admin/entries-digest/send', { confirm: true, expectedRecipients: 12 });
    expect(await screen.findByText(/12 sent/)).toBeInTheDocument();
    expect(screen.getByText('Nothing new')).toBeInTheDocument();
  });

  it('sends nothing when the question is answered no', async () => {
    autoConfirm(false);
    render(<EntriesDigestCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send now' }));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('carries on a run that was left part-way', async () => {
    autoConfirm(true);
    vi.mocked(api.get).mockResolvedValue({ data: status({ todayClaimed: true, pendingCount: 0, pending: [], last: run({ status: 0, sent: 3, remaining: 9 }) }) } as never);
    vi.mocked(api.post).mockResolvedValue({ data: status({ todayClaimed: true, pendingCount: 0, pending: [], last: run() }) } as never);
    render(<EntriesDigestCard />);
    expect(await screen.findByText(/going out now. 3 people of 12 so far/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Carry on' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
  });

  it('shows the server’s reason when it refuses', async () => {
    autoConfirm(true);
    vi.mocked(api.post).mockRejectedValue({ response: { data: { detail: 'The list has changed: it now has 13 people, not 12. Check and confirm again.' } } });
    render(<EntriesDigestCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send now' }));
    expect(await screen.findByText(/The list has changed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send now' })).toBeEnabled();
  });

  it('shows a plain message when the connection fails, and when the answer is not a status', async () => {
    autoConfirm(true);
    vi.mocked(api.post).mockRejectedValue(new Error('network'));
    render(<EntriesDigestCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send now' }));
    expect(await screen.findByText(/Couldn’t send. Check your signal/)).toBeInTheDocument();
    vi.mocked(api.post).mockResolvedValue({ data: [] } as never);
    await userEvent.click(screen.getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  });

  it('copes with a card that cannot be loaded', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    render(<EntriesDigestCard />);
    expect(await screen.findByText(/Couldn’t load this/)).toBeInTheDocument();
    vi.mocked(api.get).mockResolvedValue({ data: [] } as never);
    render(<EntriesDigestCard />);
    await waitFor(() => expect(screen.getAllByText(/Couldn’t load this/)).toHaveLength(2));
  });
});

describe('the wording', () => {
  const now = new Date('2026-10-24T10:00:00Z');
  it.each([
    ['2026-10-24T09:00:00Z', 'Due now. It goes at the next check.'],
    ['2026-10-24T17:00:00Z', 'Tonight, around 6pm'],
    ['2026-10-25T18:00:00Z', 'Tomorrow evening, around 6pm'],
    ['2026-10-31T18:00:00Z', 'Sat 31 Oct, around 6pm'],
    ['nonsense', ''],
  ])('next send %s reads "%s"', (iso, text) => {
    expect(nextSendText(iso, now)).toBe(text);
  });

  it('describes a finished, a part-way and a quiet run', () => {
    expect(lastRunText(run())).toBe('Sat 24 Oct: 11 sent, 1 didn’t go through.');
    expect(lastRunText(run({ failed: 0, skipped: 2 }))).toBe('Sat 24 Oct: 11 sent, 2 left out (unsubscribed or nothing still open).');
    expect(lastRunText(run({ status: 0, remaining: 5 }))).toBe('Sat 24 Oct: going out now. 7 people of 12 so far.');
  });
});
