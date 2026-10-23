import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { axiosError } from '../../test/factories';
import type { ScorerLink, ScorerLinkList } from '../../types';
import { ScorerLinksCard } from './ScorerLinksCard';
import { chooseOption } from '../../test/select';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const link = (id: number, over: Partial<ScorerLink> = {}): ScorerLink => ({
  id, label: `Scorer ${id}`, arenaName: 'Main', createdAt: '2030-06-01T09:00:00Z', expiresAt: '2999-06-03T00:00:00Z', lastUsedAt: null, revokedAt: null, ...over,
});
const list = (over: Partial<ScorerLinkList> = {}): ScorerLinkList => ({
  arenas: ['Main', 'Side'], defaultExpiresAt: '2999-06-03T00:00:00Z', links: [link(1)], ...over,
});
const serve = (data: unknown) => vi.mocked(api.get).mockResolvedValue({ data });

beforeEach(() => {
  serve(list());
});

describe('ScorerLinksCard', () => {
  it('lists each link with its arena, expiry and use', async () => {
    serve(list({ links: [
      link(1, { lastUsedAt: '2030-06-02T10:00:00Z' }),
      link(2, { label: 'Pat', revokedAt: '2030-06-02T11:00:00Z' }),
      link(3, { label: 'Old', expiresAt: '2000-01-01T00:00:00Z' }),
    ] }));
    render(<ScorerLinksCard competitionId={5} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading scorer links');
    const links = await screen.findByRole('list', { name: 'Scorer links' });
    expect(api.get).toHaveBeenCalledWith('/competitions/5/scorer-links');
    expect(within(links).getByText('Scorer 1 · Main')).toBeInTheDocument();
    expect(within(links).getByText(/last used/)).toBeInTheDocument();
    expect(within(links).getByText(/^Withdrawn \d/)).toBeInTheDocument();
    expect(within(links).getByText(/^Expired \d/)).toBeInTheDocument();
    expect(within(links).getAllByText('not used yet', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Withdraw Scorer 1’s link' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw Pat’s link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw Old’s link' })).not.toBeInTheDocument();
  });

  it('says so when there are no links, and tells the organiser to name an arena first', async () => {
    serve(list({ links: [], arenas: [] }));
    render(<ScorerLinksCard competitionId={5} />);
    expect(await screen.findByText('No scorer links yet.')).toBeInTheDocument();
    expect(screen.getByText(/Name an arena/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make scorer link' })).not.toBeInTheDocument();
  });

  it('hides the controls from an admin who has not turned Edit mode on', async () => {
    render(<ScorerLinksCard competitionId={5} canWrite={false} />);
    await screen.findByText('Scorer 1 · Main');
    expect(screen.queryByRole('button', { name: 'Make scorer link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Withdraw/ })).not.toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('makes a link, shows it once with the token in the fragment, and copies it', async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    vi.mocked(api.post).mockResolvedValue({ data: { link: link(2, { label: 'Sam', arenaName: 'Side' }), token: 'mgs_secret', path: '/score#t=mgs_secret' } });
    render(<ScorerLinksCard competitionId={5} />);
    await screen.findByText('Scorer 1 · Main');

    await user.type(screen.getByLabelText('Scorer’s name'), '  Sam ');
    chooseOption(screen.getByLabelText('Arena'), 'Side');
    await user.click(screen.getByRole('button', { name: 'Make scorer link' }));

    expect(api.post).toHaveBeenCalledWith('/competitions/5/scorer-links', { label: 'Sam', arenaName: 'Side' });
    const shown = await screen.findByLabelText('Link for Sam');
    expect(shown).toHaveValue(`${window.location.origin}/score#t=mgs_secret`);
    expect(screen.getByText('Sam · Side')).toBeInTheDocument();
    expect(screen.getByLabelText('Scorer’s name')).toHaveValue('');
    expect(screen.getByRole('img', { name: 'QR code for Sam’s scorer link' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(write).toHaveBeenCalledWith(`${window.location.origin}/score#t=mgs_secret`);
    expect(await screen.findByText('Link copied.')).toBeInTheDocument();
  });

  it('sends an earlier expiry when one is chosen', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ data: { link: link(2), token: 't', path: '/score#t=t' } });
    render(<ScorerLinksCard competitionId={5} />);
    await screen.findByText('Scorer 1 · Main');
    await user.type(screen.getByLabelText('Scorer’s name'), 'Sam');
    await user.type(screen.getByLabelText('Stops working at (optional)'), '2030-06-02T18:30');
    await user.click(screen.getByRole('button', { name: 'Make scorer link' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/5/scorer-links', {
      label: 'Sam', arenaName: 'Main', expiresAt: new Date('2030-06-02T18:30').toISOString(),
    });
  });

  it('shows the server’s reason when a link can’t be made, and says when copying fails', async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    vi.mocked(api.post).mockRejectedValueOnce(axiosError({ status: 400, data: { message: 'This competition has finished.' } }));
    render(<ScorerLinksCard competitionId={5} />);
    await screen.findByText('Scorer 1 · Main');
    await user.type(screen.getByLabelText('Scorer’s name'), 'Sam');
    await user.click(screen.getByRole('button', { name: 'Make scorer link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This competition has finished.');

    vi.mocked(api.post).mockResolvedValueOnce({ data: { link: link(2), token: 't', path: '/score#t=t' } });
    write.mockRejectedValueOnce(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Make scorer link' }));
    await user.click(await screen.findByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t copy automatically');
  });

  it('withdraws a link after confirming', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    vi.mocked(api.post).mockResolvedValue({ data: link(1, { revokedAt: '2030-06-02T12:00:00Z' }) });
    render(<ScorerLinksCard competitionId={5} />);
    await user.click(await screen.findByRole('button', { name: 'Withdraw Scorer 1’s link' }));
    expect(api.post).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Withdraw Scorer 1’s link' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/5/scorer-links/1/revoke');
    expect(await screen.findByText('Scorer 1’s link no longer works.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Withdraw/ })).not.toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('says when withdrawing fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.post).mockRejectedValue(axiosError());
    render(<ScorerLinksCard competitionId={5} />);
    await user.click(await screen.findByRole('button', { name: 'Withdraw Scorer 1’s link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t withdraw Scorer 1’s link');
    expect(screen.getByRole('button', { name: 'Withdraw Scorer 1’s link' })).toBeEnabled();
  });

  it('offers a retry when the list can’t load or is the wrong shape', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockRejectedValueOnce(axiosError()).mockResolvedValueOnce({ data: '<html>' }).mockResolvedValue({ data: list() });
    render(<ScorerLinksCard competitionId={5} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the scorer links');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Scorer 1 · Main')).toBeInTheDocument();
  });

  it('drops malformed entries from the response', async () => {
    serve({ arenas: ['Main', 4], defaultExpiresAt: '2999-06-03T00:00:00Z', links: [link(1), null, { label: 'no id' }] });
    render(<ScorerLinksCard competitionId={5} />);
    await screen.findByText('Scorer 1 · Main');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});
