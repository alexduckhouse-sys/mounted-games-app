import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import type { VolunteerShift } from '../../types';
import { isDutyShift } from './crewDutyHelpers';
import { SessionDutyBoard } from './SessionDutyBoard';

vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));

const shift = (id: number, extra: Partial<VolunteerShift> = {}): VolunteerShift => ({
  id, competitionId: 1, sessionId: 5, role: 'Start/Finish Line Steward — Lane 1', requiredCount: 1, claimedCount: 0, remainingCount: 1,
  isFilled: false, claims: [], dutyCategory: 'LineSteward', assignedTeamId: id, assignedTeamName: `Team ${id}`, laneNumber: 1, attendanceStatus: 'Assigned', ...extra,
});
const board = () => render(<SessionDutyBoard competitionId={1} session={{ id: 5, name: 'Morning' }} />);

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ data: [shift(1), shift(2, { attendanceStatus: 'Here', checkedInByName: 'Sam' }), shift(3, { attendanceStatus: 'Missing' }), shift(4, { sessionId: 6 }), shift(9, { dutyCategory: 'General', assignedTeamId: null, assignedTeamName: null })] });
});

it('shows the readiness line and one row per duty in this session', async () => {
  board();
  expect(await screen.findByText('1 of 3 here · 2 not checked in')).toBeInTheDocument();
  expect(screen.getByText('Team 1')).toBeInTheDocument();
  expect(screen.queryByText('Team 4')).not.toBeInTheDocument();
  expect(screen.getByText('Here')).toBeInTheDocument();
  expect(screen.getByText('Missing')).toBeInTheDocument();
  expect(screen.getByText('Assigned')).toBeInTheDocument();
  expect(screen.getByText(/checked in by Sam/)).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'They’re here' })).toHaveLength(2);
});

it('marks a team as here and keeps the server copy', async () => {
  vi.mocked(api.put).mockResolvedValue({ data: shift(1, { attendanceStatus: 'Here', checkedInByName: 'Pat' }) });
  board();
  await userEvent.click((await screen.findAllByRole('button', { name: 'They’re here' }))[0]);
  expect(api.put).toHaveBeenCalledWith('/competitions/1/volunteer-shifts/1/attendance', { status: 'Here' });
  expect(await screen.findByText('2 of 3 here · 1 not checked in')).toBeInTheDocument();
});

it('puts the row back and shows an error when marking fails', async () => {
  vi.mocked(api.put).mockRejectedValue({ response: { data: { message: 'Not allowed.' } } });
  board();
  await userEvent.click((await screen.findAllByRole('button', { name: 'They’re here' }))[0]);
  expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed.');
  expect(screen.getByText('1 of 3 here · 2 not checked in')).toBeInTheDocument();
});

it('confirms before calling a team, then marks them missing', async () => {
  const asked = autoConfirm(true);
  vi.mocked(api.post).mockResolvedValue({ data: { shift: shift(1, { attendanceStatus: 'Missing' }), announcement: {} } });
  board();
  await userEvent.click((await screen.findAllByRole('button', { name: 'Call team' }))[0]);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/volunteer-shifts/1/call-missing', {}));
  expect(asked.titles[0]).toBe('Call Team 1?');
  await waitFor(() => expect(screen.getAllByText('Missing')).toHaveLength(2));
});

it('does nothing when the call is cancelled, reloads on an odd reply and shows failures', async () => {
  autoConfirm([false, true, true]);
  board();
  const buttons = await screen.findAllByRole('button', { name: 'Call team' });
  await userEvent.click(buttons[0]);
  expect(api.post).not.toHaveBeenCalled();
  vi.mocked(api.post).mockResolvedValueOnce({ data: null });
  await userEvent.click(buttons[0]);
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  vi.mocked(api.post).mockRejectedValueOnce(new Error('x'));
  await userEvent.click(buttons[0]);
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t send the call');
});

it('replaces existing duties only after confirmation', async () => {
  autoConfirm([false, true]);
  vi.mocked(api.post).mockResolvedValue({ data: [shift(1), shift(2, { attendanceStatus: 'Here' })] });
  board();
  const button = await screen.findByRole('button', { name: 'Assign teams not riding' });
  await userEvent.click(button);
  expect(api.post).not.toHaveBeenCalled();
  await userEvent.click(button);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/sessions/5/duty-assignments', { autoAssignNonRidingTeams: true, includeChangeoverLineStewards: true, replaceExistingSessionDuties: true }));
  expect(await screen.findByText('1 of 2 here · 1 not checked in')).toBeInTheDocument();
});

it('explains an empty session and assigns without asking', async () => {
  const asked = autoConfirm(true);
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  vi.mocked(api.post).mockResolvedValue({ data: [shift(1)] });
  board();
  expect(await screen.findByText(/No duties are set for Morning/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Assign teams not riding' }));
  expect(await screen.findByText('Team 1')).toBeInTheDocument();
  expect(asked).not.toHaveBeenCalled();
  expect(api.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ replaceExistingSessionDuties: false }));
});

it('handles a failed assign, a non-list reply and a failed load', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  vi.mocked(api.post).mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ data: 'nope' });
  board();
  const button = await screen.findByRole('button', { name: 'Assign teams not riding' });
  await userEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t assign teams');
  await userEvent.click(button);
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
});

it('shows an error when the duties cannot load', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: '<html>' });
  board();
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the duties');
});

it('isDutyShift ignores other sessions and plain volunteer slots', () => {
  expect(isDutyShift(shift(1), 5)).toBe(true);
  expect(isDutyShift(shift(1), 6)).toBe(false);
  expect(isDutyShift(shift(1, { dutyCategory: undefined, assignedTeamId: null, assignedClubName: ' Club ' }), 5)).toBe(true);
  expect(isDutyShift(shift(1, { dutyCategory: 'General', assignedTeamId: null }), 5)).toBe(false);
});

it('shows a team’s own “here” as Team says here, apart from staff’s Here, and still lets staff confirm it', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [shift(1, { attendanceStatus: 'TeamSaysHere' }), shift(2, { attendanceStatus: 'Here' })] });
  board();
  const pill = await screen.findByText('Team says here');
  expect(pill).toHaveClass('border-dashed');
  expect(screen.getByText('Here')).not.toHaveClass('border-dashed');
  expect(screen.getAllByRole('button', { name: 'They’re here' })).toHaveLength(1);
});
