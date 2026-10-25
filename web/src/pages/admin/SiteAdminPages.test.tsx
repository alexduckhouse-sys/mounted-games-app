import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import { deleteWarning } from './adminShared';
import { AdminCompetitionsPage } from './AdminCompetitionsPage';
import { SiteAdminDashboard } from './SiteAdminDashboard';
import { TrainerRequestsPage } from './TrainerRequestsPage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const comp = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, location: 'Stoneleigh', startDate: future(10), endDate: future(11), isActive: true, isArchived: false,
  sectionCount: 3, teamCount: 12, sessionCount: 0, ...extra,
});
const request = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ userId: id, fullName: name, email: `${id}@example.com`, clubName: 'Cotswold Hunt', requestedAt: '2026-10-20T10:00:00Z', ...extra });

const serve = (data: { comps?: unknown[]; requests?: unknown[]; races?: unknown[] }) => vi.mocked(api.get).mockImplementation(async (url: string) => {
  if (url === '/competitions') return { data: data.comps ?? [] } as never;
  if (url === '/admin/trainer-requests') return { data: data.requests ?? [] } as never;
  if (url === '/race-templates') return { data: data.races ?? [] } as never;
  return { data: [] } as never;
});

describe('SiteAdminDashboard', () => {
  beforeEach(() => {
    serve({ comps: [comp(1, 'Spring Open', { sessionCount: 3 }), comp(2, 'Old Cup', { startDate: '2020-01-01T00:00:00Z', endDate: '2020-01-02T00:00:00Z' })], requests: [request('u1', 'Ann'), request('u2', 'Bo')], races: [{ id: 1 }, { id: 2 }, { id: 3 }] });
  });

  it('shows Needs you, Competitions and Manage the site, with no add or all-competitions buttons', async () => {
    render(<MemoryRouter><SiteAdminDashboard /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Needs you' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Site admin' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Competitions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Manage the site' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Trainer requests to approve/ })).toHaveTextContent('2');
    expect(screen.getByRole('link', { name: /Spring Open/ })).toHaveAttribute('href', '/competitions/1/operations');
    expect(screen.queryByText('Old Cup')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /New competition|\+ competition|All competitions/i })).not.toBeInTheDocument();
    const manage = screen.getByLabelText('Manage the site');
    expect(within(manage).getByRole('link', { name: /Competitions/ })).toHaveAttribute('href', '/admin/competitions');
    expect(within(manage).getByRole('link', { name: /Trainer requests/ })).toHaveTextContent('2 waiting');
    expect(within(manage).getByRole('link', { name: /Rules library/ })).toHaveTextContent('3 races');
    expect(within(manage).queryByRole('link', { name: /Users|Blocked/ })).not.toBeInTheDocument();
  });

  it('hides Needs you when nothing waits, and says when nothing is coming up', async () => {
    serve({ comps: [], requests: [], races: [{ id: 1 }] });
    render(<MemoryRouter><SiteAdminDashboard /></MemoryRouter>);
    expect(await screen.findByText('No competitions coming up')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Needs you' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Trainer requests/ })).toHaveTextContent('No one waiting');
    expect(screen.getByRole('link', { name: /Rules library/ })).toHaveTextContent('1 race');
  });

  it('copes with the requests and races failing to load', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><SiteAdminDashboard /></MemoryRouter>);
    expect(await screen.findByText('No competitions coming up')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Needs you' })).not.toBeInTheDocument();
  });
});

describe('AdminCompetitionsPage', () => {
  beforeEach(() => {
    serve({ comps: [comp(1, 'Spring Open', { teamCount: 1, sectionCount: 1, sessionCount: 2, startDate: new Date().toISOString(), endDate: new Date().toISOString() }), comp(2, 'Old Cup', { startDate: '2020-01-01T00:00:00Z', endDate: '2020-01-02T00:00:00Z' })] });
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
  });

  it('groups upcoming and past, with Organise and a red Delete on each', async () => {
    render(<MemoryRouter><AdminCompetitionsPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: /Upcoming/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Past/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Organise Spring Open' })).toHaveAttribute('href', '/competitions/1/operations');
    expect(screen.getByRole('button', { name: 'Delete Old Cup' })).toHaveClass('ops-danger-link');
    expect(screen.getByRole('link', { name: 'New competition' })).toHaveAttribute('href', '/admin/competitions/new');
  });

  it('warns before deleting, says what goes with it, and deletes only after "Delete for good"', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AdminCompetitionsPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Delete Old Cup' }));
    const warning = screen.getByRole('alertdialog', { name: 'Delete Old Cup?' });
    expect(warning).toHaveTextContent('12 teams, 3 age groups and 0 sessions');
    expect(warning).toHaveTextContent('can’t be undone');
    expect(api.delete).not.toHaveBeenCalled();
    await user.click(within(warning).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete Old Cup' }));
    expect(screen.getByRole('button', { name: 'Delete for good' })).toHaveClass('ops-danger-link');
    await user.click(screen.getByRole('button', { name: 'Delete for good' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/competitions/2'));
  });

  it('mentions that a live competition is running now, and reports a failed delete', async () => {
    vi.mocked(api.delete).mockRejectedValueOnce(new Error('no'));
    const user = userEvent.setup();
    render(<MemoryRouter><AdminCompetitionsPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Delete Spring Open' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('It’s running now.');
    await user.click(screen.getByRole('button', { name: 'Delete for good' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t delete Spring Open');
  });

  it('says why the list could not load', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><AdminCompetitionsPage /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the competitions');
  });

  it('words the delete warning for one team, one age group and one session', () => {
    expect(deleteWarning({ teamCount: 1, sectionCount: 1, sessionCount: 1 }, false)).toContain('1 team, 1 age group and 1 session');
  });
});

describe('TrainerRequestsPage', () => {
  beforeEach(() => {
    serve({ requests: [request('u1', 'Ann Smith'), request('u2', 'Bo Jones', { requestedRole: 'Manager', clubName: null })] });
    vi.mocked(api.post).mockResolvedValue({ data: {} });
  });

  it('has a big Waiting heading with Approve all beside it, and Decline as red text', async () => {
    render(<MemoryRouter><TrainerRequestsPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Waiting' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve all' })).toHaveClass('rf-btn-primary');
    expect(screen.getByRole('button', { name: 'Decline Ann Smith' })).toHaveClass('ops-danger-link');
    expect(screen.getByText(/Team manager · No club given/)).toBeInTheDocument();
  });

  it('approves one request and moves it to Done', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TrainerRequestsPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Approve Ann Smith' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/trainer-requests/u1/approve'));
    const done = await screen.findByLabelText('Done');
    expect(within(done).getByText('Ann Smith')).toBeInTheDocument();
    expect(within(done).getByText('Approved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve Ann Smith' })).not.toBeInTheDocument();
  });

  it('asks before declining', async () => {
    const asked = autoConfirm([false, true]);
    const user = userEvent.setup();
    render(<MemoryRouter><TrainerRequestsPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Decline Ann Smith' }));
    await waitFor(() => expect(asked).toHaveBeenCalledTimes(1));
    expect(api.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Decline Ann Smith' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/trainer-requests/u1/decline'));
    expect(await screen.findByText('Declined')).toBeInTheDocument();
  });

  it('approves everyone after asking, and stops with a message if one fails', async () => {
    autoConfirm([true]);
    vi.mocked(api.post).mockResolvedValueOnce({ data: {} }).mockRejectedValueOnce(new Error('no'));
    const user = userEvent.setup();
    render(<MemoryRouter><TrainerRequestsPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Approve all' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t update Bo Jones’s request');
    expect(screen.getByLabelText('Done')).toHaveTextContent('Ann Smith');
  });

  it('says so when no one is waiting, and hides Approve all', async () => {
    serve({ requests: [] });
    render(<MemoryRouter><TrainerRequestsPage /></MemoryRouter>);
    expect(await screen.findByText('No one waiting')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve all' })).not.toBeInTheDocument();
  });

  it('shows why the list could not load', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><TrainerRequestsPage /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the trainer requests');
  });
});
