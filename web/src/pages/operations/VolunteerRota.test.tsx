import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import { competition as makeCompetition, session } from '../../test/factories';
import { VolunteerRota } from './VolunteerRota';
import type { VolunteerShift } from '../../types';

const auth = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const shift = (over: Partial<VolunteerShift> = {}): VolunteerShift => ({
  id: 1, competitionId: 7, role: 'Ring Crew', requiredCount: 2, claimedCount: 0, remainingCount: 2, isFilled: false, claims: [], ...over,
});
const claim = (over: Record<string, unknown> = {}) => ({ id: 5, shiftId: 1, userId: 'u9', volunteerName: 'Pat Helper', clubName: 'Hill Pony Club', claimedAt: '', ...over });
const comp = makeCompetition({ id: 7, name: 'Spring Games', sessions: [session(10, { name: 'Under 12' }), session(11, { name: 'Lunch', isBreak: true })] });
const show = (manage = false) => render(<MemoryRouter><VolunteerRota competition={comp} manage={manage} /></MemoryRouter>);

describe('VolunteerRota', () => {
  beforeEach(() => {
    auth.user = { id: 'u1' };
    vi.mocked(api.get).mockResolvedValue({ data: [
      shift({ sessionId: 10, startTimeLabel: '9:30', notes: 'Bring a hat', claimedCount: 1, remainingCount: 1, claims: [claim()] }),
      shift({ id: 2, role: 'First Aid Liaison', requiredCount: 1, claimedCount: 1, remainingCount: 0, isFilled: true, claims: [claim({ id: 6, shiftId: 2, volunteerName: 'Me Myself', isMine: true, clubName: null })] }),
      shift({ id: 3, role: 'Line Steward', dutyCategory: 'LineSteward', sessionId: 10 }),
    ] });
  });

  it('lists shifts by session with fill status, and leaves steward duties to the duty board', async () => {
    show();
    expect(await screen.findByText('Ring Crew, 9:30')).toBeInTheDocument();
    expect(screen.getByText('1 place left · 1 of 2 taken')).toBeInTheDocument();
    expect(screen.getByText('Full · 1 of 1 taken')).toBeInTheDocument();
    expect(screen.getByText('Bring a hat')).toBeInTheDocument();
    expect(screen.getByText('2 of 3 places taken, 1 shift needs people')).toBeInTheDocument();
    expect(screen.queryByText('Line Steward')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Under 12')).toHaveTextContent('Ring Crew');
    expect(screen.getByLabelText('Whole event')).toHaveTextContent('First Aid Liaison');
  });

  it('lets a signed-in volunteer take a shift and give their own back', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ data: shift({ sessionId: 10, claimedCount: 2, remainingCount: 0, isFilled: true, claims: [claim(), claim({ id: 7, isMine: true, volunteerName: 'Me Myself' })] }) });
    show();
    await user.click(await screen.findByRole('button', { name: 'Take this shift' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/7/volunteer-shifts/1/claim', {});
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Give my place back' })).toHaveLength(2));
    vi.mocked(api.delete).mockResolvedValue({ data: shift({ sessionId: 10 }) });
    await user.click(screen.getAllByRole('button', { name: 'Give my place back' })[1]);
    expect(api.delete).toHaveBeenCalledWith('/competitions/7/volunteer-shifts/1/claims/7');
  });

  it('asks signed-out visitors to sign in and offers no buttons', async () => {
    auth.user = null;
    show();
    expect(await screen.findByText('Sign in to take a shift.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take this shift' })).not.toBeInTheDocument();
  });

  it('shows why taking a shift failed', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { data: { message: 'A volunteer name is required.' } } });
    show();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Take this shift' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A volunteer name is required.');
  });

  it('says so when there are no shifts, and when the list cannot load', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    const { unmount } = show();
    expect(await screen.findByText('The organisers haven’t added any volunteer shifts yet.')).toBeInTheDocument();
    unmount();
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    show(true);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the volunteer shifts');
    expect(screen.getByText(/No shifts yet\. Add/)).toBeInTheDocument();
  });

  it('lets organisers add a shift', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ data: shift({ id: 9, role: 'Ring Crew', sessionId: null }) });
    show(true);
    await user.click(await screen.findByRole('button', { name: /Add a shift/ }));
    await user.type(screen.getByLabelText(/Time/), '8:00');
    await user.click(screen.getByRole('button', { name: 'Add one people needed' }));
    await user.click(screen.getByRole('button', { name: 'Add shift' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/7/volunteer-shifts', { role: 'Ring Crew', sessionId: null, startTimeLabel: '8:00', notes: null, requiredCount: 2 });
    await waitFor(() => expect(screen.queryByRole('group', { name: 'New shift' })).not.toBeInTheDocument());
  });

  it('lets organisers change a shift', async () => {
    const user = userEvent.setup();
    vi.mocked(api.put).mockResolvedValue({ data: shift({ sessionId: 10, requiredCount: 3, claimedCount: 1, remainingCount: 2, claims: [claim()] }) });
    show(true);
    await user.click((await screen.findAllByRole('button', { name: 'Edit Ring Crew' }))[0]);
    expect(screen.getByRole('group', { name: 'Change shift' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add one people needed' }));
    await user.click(screen.getByRole('button', { name: 'Save shift' }));
    expect(api.put).toHaveBeenCalledWith('/competitions/7/volunteer-shifts/1', expect.objectContaining({ role: 'Ring Crew', sessionId: 10, startTimeLabel: '9:30', notes: 'Bring a hat', requiredCount: 3 }));
  });

  it('shows why a save failed and lets organisers cancel', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValue(new Error('offline'));
    show(true);
    await user.click(await screen.findByRole('button', { name: /Add a shift/ }));
    await user.click(screen.getByRole('button', { name: 'Add shift' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save that shift');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'New shift' })).not.toBeInTheDocument();
  });

  it('confirms before deleting a shift that has people on it', async () => {
    const asked = autoConfirm([false, true]);
    const user = userEvent.setup();
    vi.mocked(api.delete).mockResolvedValue({ data: undefined });
    show(true);
    const button = (await screen.findAllByRole('button', { name: 'Delete Ring Crew' }))[0];
    await user.click(button);
    expect(api.delete).not.toHaveBeenCalled();
    await user.click(button);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/competitions/7/volunteer-shifts/1'));
    expect(asked).toHaveBeenLastCalledWith(expect.stringContaining('loses their place'));
    await waitFor(() => expect(screen.queryByText('Ring Crew, 9:30')).not.toBeInTheDocument());
  });

  it('lets organisers take someone else off a shift after confirming', async () => {
    autoConfirm(true);
    vi.mocked(api.delete).mockResolvedValue({ data: shift({ sessionId: 10 }) });
    show(true);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Take Pat Helper off Ring Crew' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/competitions/7/volunteer-shifts/1/claims/5'));
  });

  it('lists the unfilled shifts with a message ready to send', async () => {
    show(true);
    const section = await screen.findByRole('region', { name: 'Shifts that still need people' });
    expect(within(section).getByText('Ring Crew, 9:30')).toBeInTheDocument();
    const whatsApp = within(section).getByRole('link', { name: 'Send on WhatsApp' });
    const text = decodeURIComponent(whatsApp.getAttribute('href') ?? '');
    expect(text).toContain('Spring Games: we still need volunteers');
    expect(text).toContain('Ring Crew, 9:30: 1 place left');
    expect(text).toContain('/competitions/7/volunteers');
    expect(text).not.toContain('Pat Helper');
  });
});
