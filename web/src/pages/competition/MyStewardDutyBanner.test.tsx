import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition, session } from '../../test/factories';
import type { VolunteerShift } from '../../types';
import { MyStewardDutyBanner } from './MyStewardDutyBanner';

const state = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null }));
vi.mock('./context', () => ({ useCompetition: () => ({ competition: competition({ sessions: [session(5, { status: 0 }), session(6, { status: 2 })] }) }) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const shift = (id: number, extra: Partial<VolunteerShift> = {}): VolunteerShift => ({
  id, competitionId: 1, sessionId: 5, sessionName: 'Morning', role: 'Changeover Line Steward — Lane 2', requiredCount: 1, claimedCount: 0, remainingCount: 1,
  isFilled: false, claims: [], dutyCategory: 'ChangeoverSteward', assignedTeamName: 'Red Team', laneNumber: 2, attendanceStatus: 'Assigned', canViewerCheckIn: true, ...extra,
});

beforeEach(() => {
  state.user = { id: 'u1' };
  vi.mocked(api.get).mockResolvedValue({ data: [shift(1), shift(2, { canViewerCheckIn: false }), shift(3, { sessionId: 6 }), shift(4, { dutyCategory: 'General' })] });
});

it('shows only the viewer’s open duties and checks in', async () => {
  vi.mocked(api.post).mockResolvedValue({ data: shift(1, { attendanceStatus: 'Here', checkedInAt: '2026-10-27T10:42:00' }) });
  render(<MemoryRouter><MyStewardDutyBanner /></MemoryRouter>);
  expect(await screen.findByText('Steward duty: Morning · Changeover Line Steward — Lane 2')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'We’re here' })).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Arena crew sheet' })).toHaveAttribute('href', '/competitions/1/arena-crew?session=5');
  expect(screen.getByRole('link', { name: 'All volunteer shifts' })).toHaveAttribute('href', '/competitions/1/volunteers');
  await userEvent.click(screen.getByRole('button', { name: 'We’re here' }));
  expect(api.post).toHaveBeenCalledWith('/competitions/1/volunteer-shifts/1/check-in', {});
  expect(await screen.findByRole('status')).toHaveTextContent('Checked in at 10:42');
});

it('is urgent when the team has been called, and adds the lane when the role omits it', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [shift(1, { attendanceStatus: 'Missing', role: 'Arena Crew', laneNumber: 3, sessionName: null })] });
  render(<MemoryRouter><MyStewardDutyBanner /></MemoryRouter>);
  expect(await screen.findByText('You’re needed now')).toBeInTheDocument();
  expect(screen.getByText('Steward duty: Session · Arena Crew, lane 3')).toBeInTheDocument();
});

it('shows a short error when check-in fails, and a time-less confirmation', async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ data: null });
  render(<MemoryRouter><MyStewardDutyBanner /></MemoryRouter>);
  await userEvent.click(await screen.findByRole('button', { name: 'We’re here' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t check in');
  await userEvent.click(screen.getByRole('button', { name: 'We’re here' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Checked in');
});

it('shows a blank time label for an unreadable time', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [shift(1, { attendanceStatus: 'Here', checkedInAt: 'nonsense' })] });
  render(<MemoryRouter><MyStewardDutyBanner /></MemoryRouter>);
  expect(await screen.findByRole('status')).toHaveTextContent(/^Checked in$/);
});

it('stays hidden when signed out, when nothing applies or when the load fails', async () => {
  state.user = null;
  const { container, unmount } = render(<MemoryRouter><MyStewardDutyBanner /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
  expect(api.get).not.toHaveBeenCalled();
  unmount();
  state.user = { id: 'u1' };
  vi.mocked(api.get).mockRejectedValue(new Error('offline'));
  const failed = render(<MemoryRouter><MyStewardDutyBanner /></MemoryRouter>);
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  expect(failed.container).toBeEmptyDOMElement();
  failed.unmount();
  vi.mocked(api.get).mockResolvedValue({ data: 'nope' });
  const odd = render(<MemoryRouter><MyStewardDutyBanner /></MemoryRouter>);
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  expect(odd.container).toBeEmptyDOMElement();
});
