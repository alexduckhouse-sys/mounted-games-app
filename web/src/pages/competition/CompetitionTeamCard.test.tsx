import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { CompetitionHelper, CompetitionTeam } from '../../types';
import { CompetitionTeamCard } from './CompetitionTeamCard';
import { autoConfirm } from '../../test/confirm';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
const auth = vi.hoisted(() => ({ userId: 'owner-1', refreshAccess: vi.fn() }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: auth.userId }, refreshAccess: auth.refreshAccess }),
}));

const helper = (userId: string, name: string, email = `${userId}@example.com`): CompetitionHelper => ({
  userId, name, email, addedAt: '2026-06-01T09:00:00Z',
});
const team = (over: Partial<CompetitionTeam> = {}): CompetitionTeam => ({
  owner: { userId: 'owner-1', name: 'Olive Owner' },
  helpers: [helper('h1', 'Hana Helper'), helper('h2', 'Lee Line')],
  ...over,
});
const serve = (data: unknown) => vi.mocked(api.get).mockResolvedValue({ data });

beforeEach(() => {
  auth.userId = 'owner-1';
  auth.refreshAccess.mockResolvedValue(undefined);
  serve(team());
});

describe('CompetitionTeamCard', () => {
  it('lists the owner and each competition admin', async () => {
    render(<CompetitionTeamCard competitionId={5} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the team');
    const list = await screen.findByRole('list', { name: 'People on this team' });
    expect(api.get).toHaveBeenCalledWith('/competitions/5/team');
    expect(within(list).getByText('Olive Owner')).toBeInTheDocument();
    expect(within(list).getByText('Owner')).toBeInTheDocument();
    expect(within(list).getByText('Hana Helper')).toBeInTheDocument();
    expect(within(list).getByText('h1@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Hana Helper' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Lee Line' })).toBeInTheDocument();
  });

  it('says so when there are no helpers yet, and copes without an owner', async () => {
    serve(team({ owner: null, helpers: [] }));
    render(<CompetitionTeamCard competitionId={5} />);
    expect(await screen.findByText('No competition admins yet.')).toBeInTheDocument();
    expect(screen.queryByText('Owner')).not.toBeInTheDocument();
  });

  it('hides the controls when the viewer cannot write', async () => {
    render(<CompetitionTeamCard competitionId={5} canWrite={false} />);
    await screen.findByText('Hana Helper');
    expect(screen.getAllByText('Competition admin')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Add competition admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it('adds a competition admin by email, then shows them', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ data: helper('h3', 'Cam Caller', 'cam@example.com') });
    render(<CompetitionTeamCard competitionId={5} />);
    await screen.findByText('Hana Helper');
    expect(screen.getByRole('button', { name: 'Add competition admin' })).toBeDisabled();
    await user.type(screen.getByLabelText('Email address'), ' cam@example.com ');
    await user.click(screen.getByRole('button', { name: 'Add competition admin' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/5/team', { email: 'cam@example.com' });
    expect(await screen.findByText('Cam Caller')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Cam Caller is now a competition admin');
    expect(screen.getByLabelText('Email address')).toHaveValue('');
  });

  it('shows the message when no account has that email', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValue({ response: { status: 404, data: { message: 'No account uses that email address.' } } });
    render(<CompetitionTeamCard competitionId={5} />);
    await screen.findByText('Hana Helper');
    await user.type(screen.getByLabelText('Email address'), 'nobody@example.com');
    await user.click(screen.getByRole('button', { name: 'Add competition admin' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No account uses that email address.');
    expect(screen.getByLabelText('Email address')).toHaveValue('nobody@example.com');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('falls back to a plain message when the server gives none', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValue(new Error('Network Error'));
    render(<CompetitionTeamCard competitionId={5} />);
    await screen.findByText('Hana Helper');
    await user.type(screen.getByLabelText('Email address'), 'cam@example.com');
    await user.click(screen.getByRole('button', { name: 'Add competition admin' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t add that person');
  });

  it('shows the message when adding the owner or yourself is refused', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValue({ response: { status: 400, data: { message: 'You already run this competition.' } } });
    render(<CompetitionTeamCard competitionId={5} />);
    await screen.findByText('Hana Helper');
    await user.type(screen.getByLabelText('Email address'), 'me@example.com');
    await user.click(screen.getByRole('button', { name: 'Add competition admin' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You already run this competition.');
  });

  it('replaces someone who is added a second time instead of listing them twice', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ data: helper('h1', 'Hana Helper', 'hana@example.com') });
    render(<CompetitionTeamCard competitionId={5} />);
    await screen.findByText('Hana Helper');
    await user.type(screen.getByLabelText('Email address'), 'h1@example.com');
    await user.click(screen.getByRole('button', { name: 'Add competition admin' }));
    expect(await screen.findByText('hana@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('Hana Helper')).toHaveLength(1);
  });

  it('removes a helper', async () => {
    const user = userEvent.setup();
    vi.mocked(api.delete).mockResolvedValue({ data: null });
    render(<CompetitionTeamCard competitionId={5} />);
    await screen.findByText('Hana Helper');
    const asked = autoConfirm([false, true]);
    await user.click(screen.getByRole('button', { name: 'Remove Hana Helper' }));
    await waitFor(() => expect(asked).toHaveBeenCalledWith('They lose access to this competition.'));
    expect(api.delete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove Hana Helper' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/competitions/5/team/h1'));
    await waitFor(() => expect(screen.queryByText('Hana Helper')).not.toBeInTheDocument());
    expect(screen.getByText('Lee Line')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Removed Hana Helper');
    expect(auth.refreshAccess).not.toHaveBeenCalled();
  });

  it('keeps the helper and shows the message when removing fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.delete).mockRejectedValue(new Error('offline'));
    render(<CompetitionTeamCard competitionId={5} />);
    await screen.findByText('Hana Helper');
    autoConfirm(true);
    await user.click(screen.getByRole('button', { name: 'Remove Hana Helper' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t remove Hana Helper');
    expect(screen.getByText('Hana Helper')).toBeInTheDocument();
  });

  describe('as a competition admin', () => {
    beforeEach(() => { auth.userId = 'h1'; });

    it('offers to leave, and can remove the others but not themselves', async () => {
      render(<CompetitionTeamCard competitionId={5} />);
      expect(await screen.findByText('You’re a competition admin for this event.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Leave this team' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Remove Lee Line' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Remove Hana Helper' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add competition admin' })).toBeInTheDocument();
    });

    it('leaves the team, then reloads their access', async () => {
      const user = userEvent.setup();
      vi.mocked(api.delete).mockResolvedValue({ data: null });
      render(<CompetitionTeamCard competitionId={5} competitionName="Spring Games" />);
      const asked = autoConfirm([false, true]);
      await user.click(await screen.findByRole('button', { name: 'Leave this team' }));
      await waitFor(() => expect(asked).toHaveBeenCalledWith('You’ll lose access to Spring Games for this team.'));
      expect(api.delete).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Leave this team' }));
      await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/competitions/5/team/h1'));
      await waitFor(() => expect(auth.refreshAccess).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('status')).toHaveTextContent('You’ve left this team');
      expect(screen.queryByRole('button', { name: 'Leave this team' })).not.toBeInTheDocument();
    });

    it('stays on the team and shows an error when leaving fails', async () => {
      const user = userEvent.setup();
      vi.mocked(api.delete).mockRejectedValue(new Error('offline'));
      render(<CompetitionTeamCard competitionId={5} />);
      autoConfirm(true);
      await user.click(await screen.findByRole('button', { name: 'Leave this team' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t leave the team');
      expect(auth.refreshAccess).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Leave this team' })).toBeEnabled();
    });
  });

  it('does not offer to leave to someone who is not on the list', async () => {
    render(<CompetitionTeamCard competitionId={5} />);
    await screen.findByText('Hana Helper');
    expect(screen.queryByRole('button', { name: 'Leave this team' })).not.toBeInTheDocument();
  });

  it('offers a retry when the team cannot be loaded', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    render(<CompetitionTeamCard competitionId={5} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the team');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Hana Helper')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['nothing', null],
    ['no helper list', { owner: null }],
  ])('treats %s as a failed load', async (_name, bad) => {
    serve(bad);
    render(<CompetitionTeamCard competitionId={5} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the team');
  });

  it('drops helper rows that are not well formed', async () => {
    serve({ helpers: [null, { name: 'No id' }, helper('h1', 'Hana Helper')] });
    render(<CompetitionTeamCard competitionId={5} />);
    expect(await screen.findByText('Hana Helper')).toBeInTheDocument();
    expect(screen.queryByText('No id')).not.toBeInTheDocument();
  });

  it('loads the new competition’s team when the competition changes', async () => {
    const { rerender } = render(<CompetitionTeamCard competitionId={5} />);
    await screen.findByText('Hana Helper');
    serve(team({ helpers: [helper('h9', 'Nia Next')] }));
    rerender(<CompetitionTeamCard competitionId={6} />);
    expect(await screen.findByText('Nia Next')).toBeInTheDocument();
    expect(screen.queryByText('Hana Helper')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith('/competitions/6/team');
  });
});

describe('CompetitionTeamCard unconfirmed email', () => {
  it('tells the organiser when an admin email has not been confirmed, without blocking them', async () => {
    serve(team({ helpers: [{ ...helper('h1', 'Hana Helper'), emailConfirmed: false }, helper('h2', 'Lee Line')] }));
    render(<CompetitionTeamCard competitionId={5} />);
    const list = await screen.findByRole('list', { name: 'People on this team' });
    expect(within(list).getAllByText('(unconfirmed email)')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Remove Hana Helper' })).toBeInTheDocument();
  });
});
