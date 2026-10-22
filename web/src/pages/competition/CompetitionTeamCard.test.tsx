import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { CompetitionHelper, CompetitionTeam } from '../../types';
import { CompetitionTeamCard } from './CompetitionTeamCard';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
const auth = vi.hoisted(() => ({ userId: 'owner-1', refreshAccess: vi.fn() }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: auth.userId }, refreshAccess: auth.refreshAccess }),
}));

const helper = (userId: string, name: string, role: CompetitionHelper['role'], email: string | null = `${userId}@example.com`): CompetitionHelper => ({
  userId, name, email, role, addedAt: '2026-06-01T09:00:00Z',
});
const team = (over: Partial<CompetitionTeam> = {}): CompetitionTeam => ({
  canManageTeam: true,
  owner: { userId: 'owner-1', name: 'Olive Owner' },
  helpers: [helper('h1', 'Hana Helper', 1), helper('h2', 'Lee Line', 2)],
  ...over,
});
const serve = (data: unknown) => vi.mocked(api.get).mockResolvedValue({ data });

beforeEach(() => {
  auth.userId = 'owner-1';
  auth.refreshAccess.mockResolvedValue(undefined);
  serve(team());
});

describe('CompetitionTeamCard', () => {
  it('lists the owner and each helper with their role', async () => {
    render(<CompetitionTeamCard competitionId={5} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the team');
    const list = await screen.findByRole('list', { name: 'People on this team' });
    expect(api.get).toHaveBeenCalledWith('/competitions/5/team');
    expect(within(list).getByText('Olive Owner')).toBeInTheDocument();
    expect(within(list).getByText('Owner')).toBeInTheDocument();
    expect(within(list).getByText('Hana Helper')).toBeInTheDocument();
    expect(within(list).getByText('h1@example.com')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role for Hana Helper' })).toHaveValue('1');
    expect(screen.getByRole('combobox', { name: 'Role for Lee Line' })).toHaveValue('2');
  });

  it.each([
    [0, 'Co-organiser'], [1, 'Ring scorer'], [2, 'Line judge'], [3, 'Commentator'], [4, 'Stream producer'],
  ] as const)('labels role %i as %s for someone who cannot manage the team', async (role, label) => {
    auth.userId = 'viewer';
    serve(team({ canManageTeam: false, helpers: [helper('h1', 'Hana Helper', role, null)] }));
    render(<CompetitionTeamCard competitionId={5} />);
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add helper' })).not.toBeInTheDocument();
  });

  it('says so when there are no helpers yet, and copes without an owner', async () => {
    serve(team({ owner: null, helpers: [] }));
    render(<CompetitionTeamCard competitionId={5} />);
    expect(await screen.findByText('No helpers yet.')).toBeInTheDocument();
    expect(screen.queryByText('Owner')).not.toBeInTheDocument();
  });

  it('hides the controls from an admin who has not turned Edit mode on', async () => {
    render(<CompetitionTeamCard competitionId={5} canWrite={false} />);
    await screen.findByText('Hana Helper');
    expect(screen.getByText('Ring scorer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add helper' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it('adds a helper by email and role, then shows them', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ data: helper('h3', 'Cam Caller', 3, 'cam@example.com') });
    render(<CompetitionTeamCard competitionId={5} />);
    await screen.findByText('Hana Helper');
    expect(screen.getByRole('button', { name: 'Add helper' })).toBeDisabled();
    await user.type(screen.getByLabelText('Email address'), ' cam@example.com ');
    await user.selectOptions(screen.getByLabelText('Role'), '3');
    await user.click(screen.getByRole('button', { name: 'Add helper' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/5/team', { email: 'cam@example.com', role: 3 });
    expect(await screen.findByText('Cam Caller')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Added Cam Caller as commentator.');
    expect(screen.getByLabelText('Email address')).toHaveValue('');
  });

  it('shows the message when no account has that email', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValue({ response: { status: 404, data: { message: 'No account uses that email address.' } } });
    render(<CompetitionTeamCard competitionId={5} />);
    await screen.findByText('Hana Helper');
    await user.type(screen.getByLabelText('Email address'), 'nobody@example.com');
    await user.click(screen.getByRole('button', { name: 'Add helper' }));
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
    await user.click(screen.getByRole('button', { name: 'Add helper' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t add that person');
  });

  it('shows the message when adding the owner or yourself is refused', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValue({ response: { status: 400, data: { message: 'You already run this competition.' } } });
    render(<CompetitionTeamCard competitionId={5} />);
    await screen.findByText('Hana Helper');
    await user.type(screen.getByLabelText('Email address'), 'me@example.com');
    await user.click(screen.getByRole('button', { name: 'Add helper' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You already run this competition.');
  });

  it('replaces someone who is added a second time instead of listing them twice', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ data: helper('h1', 'Hana Helper', 0) });
    render(<CompetitionTeamCard competitionId={5} />);
    await screen.findByText('Hana Helper');
    await user.type(screen.getByLabelText('Email address'), 'h1@example.com');
    await user.click(screen.getByRole('button', { name: 'Add helper' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Role for Hana Helper' })).toHaveValue('0'));
    expect(screen.getAllByText('Hana Helper')).toHaveLength(1);
  });

  it('changes a helper’s role', async () => {
    const user = userEvent.setup();
    vi.mocked(api.put).mockResolvedValue({ data: helper('h1', 'Hana Helper', 4) });
    render(<CompetitionTeamCard competitionId={5} />);
    await screen.findByText('Hana Helper');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role for Hana Helper' }), '4');
    expect(api.put).toHaveBeenCalledWith('/competitions/5/team/h1', { role: 4 });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Role for Hana Helper' })).toHaveValue('4'));
    expect(screen.getByRole('status')).toHaveTextContent('Hana Helper is now stream producer.');
  });

  it('keeps the old role and shows the message when a role change fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.put).mockRejectedValue({ response: { data: { message: 'Only the owner can do that.' } } });
    render(<CompetitionTeamCard competitionId={5} />);
    await screen.findByText('Hana Helper');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role for Hana Helper' }), '3');
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the owner can do that.');
    expect(screen.getByRole('combobox', { name: 'Role for Hana Helper' })).toHaveValue('1');
  });

  it('removes a helper', async () => {
    const user = userEvent.setup();
    vi.mocked(api.delete).mockResolvedValue({ data: null });
    render(<CompetitionTeamCard competitionId={5} />);
    await screen.findByText('Hana Helper');
    await user.click(screen.getByRole('button', { name: 'Remove Hana Helper' }));
    expect(api.delete).toHaveBeenCalledWith('/competitions/5/team/h1');
    await waitFor(() => expect(screen.queryByText('Hana Helper')).not.toBeInTheDocument());
    expect(screen.getByText('Lee Line')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Removed Hana Helper.');
    expect(auth.refreshAccess).not.toHaveBeenCalled();
  });

  it('keeps the helper and shows the message when removing fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.delete).mockRejectedValue(new Error('offline'));
    render(<CompetitionTeamCard competitionId={5} />);
    await screen.findByText('Hana Helper');
    await user.click(screen.getByRole('button', { name: 'Remove Hana Helper' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t remove Hana Helper');
    expect(screen.getByText('Hana Helper')).toBeInTheDocument();
  });

  describe('as a helper', () => {
    beforeEach(() => {
      auth.userId = 'h1';
      serve(team({ canManageTeam: false, helpers: [helper('h1', 'Hana Helper', 1, null), helper('h2', 'Lee Line', 2, null)] }));
    });

    it('offers to leave, and says what their role is', async () => {
      render(<CompetitionTeamCard competitionId={5} />);
      expect(await screen.findByText('You’re on this team as ring scorer.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Leave this team' })).toBeInTheDocument();
    });

    it('leaves the team, then reloads their access', async () => {
      const user = userEvent.setup();
      vi.mocked(api.delete).mockResolvedValue({ data: null });
      render(<CompetitionTeamCard competitionId={5} />);
      await user.click(await screen.findByRole('button', { name: 'Leave this team' }));
      expect(api.delete).toHaveBeenCalledWith('/competitions/5/team/h1');
      await waitFor(() => expect(auth.refreshAccess).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('status')).toHaveTextContent('You’ve left this team.');
      expect(screen.queryByRole('button', { name: 'Leave this team' })).not.toBeInTheDocument();
    });

    it('stays on the team and shows an error when leaving fails', async () => {
      const user = userEvent.setup();
      vi.mocked(api.delete).mockRejectedValue(new Error('offline'));
      render(<CompetitionTeamCard competitionId={5} />);
      await user.click(await screen.findByRole('button', { name: 'Leave this team' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t leave the team');
      expect(auth.refreshAccess).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Leave this team' })).toBeEnabled();
    });
  });

  it('does not offer to leave to someone who is not a helper', async () => {
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
    ['no helper list', { canManageTeam: true, owner: null }],
  ])('treats %s as a failed load', async (_name, bad) => {
    serve(bad);
    render(<CompetitionTeamCard competitionId={5} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the team');
  });

  it('drops helper rows that are not well formed', async () => {
    serve({ canManageTeam: false, helpers: [null, { name: 'No id', role: 1 }, helper('h1', 'Hana Helper', 1)] });
    render(<CompetitionTeamCard competitionId={5} />);
    expect(await screen.findByText('Hana Helper')).toBeInTheDocument();
    expect(screen.queryByText('No id')).not.toBeInTheDocument();
  });

  it('loads the new competition’s team when the competition changes', async () => {
    const { rerender } = render(<CompetitionTeamCard competitionId={5} />);
    await screen.findByText('Hana Helper');
    serve(team({ helpers: [helper('h9', 'Nia Next', 0)] }));
    rerender(<CompetitionTeamCard competitionId={6} />);
    expect(await screen.findByText('Nia Next')).toBeInTheDocument();
    expect(screen.queryByText('Hana Helper')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith('/competitions/6/team');
  });
});
