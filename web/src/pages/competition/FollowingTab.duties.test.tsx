import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { FAVOURITES_KEY } from '../../lib/favourites';
import { axiosError, competition, heat, session, team } from '../../test/factories';
import type { VolunteerShift } from '../../types';
import { CompetitionContext } from './context';
import { FollowingTab } from './FollowingTab';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const shift = (id: number, extra: Partial<VolunteerShift> = {}): VolunteerShift => ({
  id, competitionId: 1, role: 'Line steward', dutyCategory: 'LineSteward', laneNumber: 2, requiredCount: 1, claimedCount: 0, remainingCount: 1, isFilled: false, claims: [],
  heatId: 2, assignedTeamId: 1, attendanceStatus: 'Assigned', ...extra,
});
const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const entry = (teamId: number, lane = 1) => ({ id: teamId * 10, teamId, teamName: `Team ${teamId}`, laneIndex: lane });
const comp = () => competition({ teams: [team(1, { displayName: 'Meriden A' }), team(2)], sessions: [
  session(1, { arenaName: 'Arena 1', scheduledStart: at(20), heats: [heat(1, { scheduledStart: at(20), entries: [entry(1)] }), heat(2, { scheduledStart: at(40), entries: [entry(2)] })] }),
  session(2, { arenaName: 'Arena 2', scheduledStart: at(5), heats: [heat(3, { scheduledStart: at(5), entries: [entry(2)] })] }),
] });
function mount(data = comp()) {
  return render(<MemoryRouter initialEntries={['/competitions/1/following']}><CompetitionContext.Provider value={{ competition: data, reload: vi.fn(), updatedAt: new Date('2026-07-01T10:00:00Z'), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 0, streamMessages: [] }}><Routes><Route path="/competitions/:id"><Route path="following" element={<FollowingTab />} /></Route></Routes></CompetitionContext.Provider></MemoryRouter>);
}
const card = () => screen.getByRole('link', { name: /^Meriden A/ }).closest('li')!;

beforeEach(() => {
  localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1}]');
  vi.mocked(api.get).mockResolvedValue({ data: [shift(1), shift(2, { assignedTeamId: 2 }), shift(3, { heatId: null })] });
  vi.mocked(api.post).mockResolvedValue({ data: shift(1, { attendanceStatus: 'TeamSaysHere' }) });
});

describe('the duty line on a followed team’s card', () => {
  it('sits in time order after the heat it follows, with the role, lane, heat and arena', async () => {
    mount();
    const line = (await within(card()).findByText('Line steward, lane 2')).closest('.fc-line')!;
    expect(within(line as HTMLElement).getByText('Duty · Seniors Heat 2 · Arena 1')).toBeInTheDocument();
    const lines = [...card().querySelectorAll('.fc-line')];
    expect(lines.indexOf(line)).toBe(lines.length - 1);
    expect(card().querySelectorAll('.fc-duty')).toHaveLength(1);
    expect(screen.queryByText('Duty · Seniors Heat 1')).not.toBeInTheDocument();
  });

  it('goes above the heat when it comes first', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [shift(1, { heatId: 3, role: 'Scorer', dutyCategory: 'General', laneNumber: null })] });
    mount();
    const line = (await within(card()).findByText('Scorer')).closest('.fc-line')!;
    expect(line).toBe(card().querySelectorAll('.fc-line')[0]);
    expect(within(line as HTMLElement).getByText('Duty · Seniors Heat 1 · Arena 2')).toBeInTheDocument();
  });

  it('is left out once its heat has been scored', async () => {
    const data = comp();
    data.sessions[0].heats[1].finishedAt = at(-1);
    mount(data);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/competitions/1/volunteer-shifts'));
    expect(card().querySelector('.fc-duty')).toBeNull();
  });

  it('shows no line, and asks for nothing, when no team is followed or the list can’t load', async () => {
    localStorage.clear();
    mount();
    expect(api.get).not.toHaveBeenCalled();
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1}]');
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    mount();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(document.querySelector('.fc-duty')).toBeNull();
  });

  it('refreshes when the tab comes back into view', async () => {
    mount();
    await within(card()).findByText('Line steward, lane 2');
    vi.mocked(api.get).mockResolvedValue({ data: [shift(1, { role: 'Scorer', dutyCategory: 'General', laneNumber: null })] });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(await within(card()).findByText('Scorer')).toBeInTheDocument();
    vi.mocked(api.get).mockResolvedValue({ data: [shift(1, { role: 'Referee', dutyCategory: 'General', laneNumber: null })] });
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(await within(card()).findByText('Referee')).toBeInTheDocument();
  });
});

describe('We’re here', () => {
  it('tells the organisers and swaps the button for Team says here', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /We’re here/ }));
    expect(api.post).toHaveBeenCalledWith('/competitions/1/volunteer-shifts/1/team-here');
    const done = await screen.findByRole('status');
    expect(done).toHaveTextContent('Team says here');
    expect(screen.queryByRole('button', { name: /We’re here/ })).not.toBeInTheDocument();
  });

  it('shows Team says here to every follower once one of them has said so', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [shift(1, { attendanceStatus: 'TeamSaysHere' })] });
    mount();
    expect(await screen.findByRole('status')).toHaveTextContent('Team says here');
    expect(screen.queryByRole('button', { name: /We’re here/ })).not.toBeInTheDocument();
  });

  it('shows a plain Here once staff have checked the team in', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [shift(1, { attendanceStatus: 'Here' })] });
    mount();
    const done = await screen.findByRole('status');
    expect(done).toHaveTextContent(/^Here$/);
    expect(screen.queryByRole('button', { name: /We’re here/ })).not.toBeInTheDocument();
  });

  it('answers a rate limit kindly and lets them try again', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(axiosError({ status: 429 }));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /We’re here/ }));
    expect(await screen.findByText(/That’s a lot of taps/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /We’re here/ })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: /We’re here/ }));
    await waitFor(() => expect(screen.queryByText(/That’s a lot of taps/)).not.toBeInTheDocument());
    expect(await screen.findByRole('status')).toHaveTextContent('Team says here');
  });

  it('says so plainly when it can’t reach the server, and the notice can be put away', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /We’re here/ }));
    expect(await screen.findByText(/Couldn’t tell the organisers/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Couldn’t tell the organisers/)).not.toBeInTheDocument();
  });
});
