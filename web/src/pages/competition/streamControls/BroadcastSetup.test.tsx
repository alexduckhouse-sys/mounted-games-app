import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api';
import { competition, session } from '../../../test/factories';
import { BroadcastSetup } from './BroadcastSetup';

vi.mock('../../../api', () => ({ api: { put: vi.fn() } }));

function mount(arenas = ['Main Arena', 'Second Arena']) {
  const comp = competition({
    id: 7,
    sections: [
      { id: 5, competitionId: 1, format: 2, ageGroup: 'U12', displayName: 'Under 12', finalistCount: 2 },
      { id: 6, competitionId: 1, format: 2, ageGroup: 'U15', displayName: 'Under 15', finalistCount: 2 },
    ],
    sessions: arenas.map((arenaName, index) => session(index + 1, { arenaName, competitionSectionId: index === 0 ? 5 : 6 })),
  });
  const view = render(<BroadcastSetup competition={comp} />);
  view.container.querySelector('details')!.open = true;
  return view;
}

const origin = () => window.location.origin;

beforeEach(() => {
  vi.mocked(api.put).mockReset().mockResolvedValue({ data: {} });
});

describe('BroadcastSetup', () => {
  it('walks through OBS, vMix and the delay in plain steps', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Add it to OBS or vMix' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'OBS' })).toBeInTheDocument();
    expect(screen.getByText('Under Sources, press + and choose Browser.')).toBeInTheDocument();
    expect(screen.getByText('Set width to 1920 and height to 1080, then press OK.')).toBeInTheDocument();
    expect(screen.getByText(/The background is see-through/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'vMix' })).toBeInTheDocument();
    expect(screen.getByText('Choose Add Input, then Web Browser.')).toBeInTheDocument();
    expect(screen.getByText('Paste the link and set 1920 × 1080.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Delay' })).toBeInTheDocument();
    expect(screen.getByText(/how far behind the arena your stream is/)).toBeInTheDocument();
  });

  it('copies an absolute link that carries the chosen arena, age group and delay', async () => {
    const user = userEvent.setup();
    mount();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenLastCalledWith(`${origin()}/embed/competitions/7/overlay?arena=Main+Arena&delay=0`);

    await user.click(screen.getByRole('button', { name: /^Arena:/ }));
    await user.click(screen.getByRole('option', { name: 'Second Arena' }));
    await user.click(screen.getByRole('button', { name: /^Age group:/ }));
    await user.click(screen.getByRole('option', { name: 'Under 15' }));
    const more = screen.getByRole('button', { name: 'More: Delay (seconds)' });
    await user.click(more);
    await user.click(more);

    expect(screen.getByRole('textbox')).toHaveValue(`${origin()}/embed/competitions/7/overlay?arena=Second+Arena&delay=10&section=6`);
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenLastCalledWith(`${origin()}/embed/competitions/7/overlay?arena=Second+Arena&delay=10&section=6`);
    expect(await screen.findByRole('status')).toHaveTextContent('Copied. Paste it into OBS or vMix.');
  });

  it('only offers the arena row when there is more than one arena', () => {
    mount(['Main Arena']);
    expect(screen.queryByRole('button', { name: /^Arena:/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Age group:/ })).toBeInTheDocument();
  });

  it('steps the delay by 5 seconds and keeps it between 0 and 120', async () => {
    const user = userEvent.setup();
    mount();
    const delay = screen.getByRole('spinbutton', { name: 'Delay (seconds)' });
    const less = screen.getByRole('button', { name: 'Less: Delay (seconds)' });
    const more = screen.getByRole('button', { name: 'More: Delay (seconds)' });
    expect(delay).toHaveValue(0);
    expect(less).toBeDisabled();
    await user.click(more);
    expect(delay).toHaveValue(5);
    await user.click(less);
    expect(delay).toHaveValue(0);

    fireEvent.change(delay, { target: { value: '500' } });
    expect(delay).toHaveValue(120);
    expect(more).toBeDisabled();
    expect(screen.getByRole('textbox')).toHaveValue(`${origin()}/embed/competitions/7/overlay?arena=Main+Arena&delay=120`);
    await user.click(less);
    expect(delay).toHaveValue(115);
    fireEvent.change(delay, { target: { value: '-3' } });
    expect(delay).toHaveValue(0);
  });

  it('says so when the link cannot be copied', async () => {
    const user = userEvent.setup();
    mount();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Select the link to copy it.');
  });

  it('hides and shows the scores for the chosen arena', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Hide scores now' }));
    expect(api.put).toHaveBeenLastCalledWith('/competitions/7/broadcast-snapshot/visibility', { arena: 'Main Arena', hidden: true });
    expect(await screen.findByText(/Scores hidden/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show scores' }));
    expect(api.put).toHaveBeenLastCalledWith('/competitions/7/broadcast-snapshot/visibility', { arena: 'Main Arena', hidden: false });
    vi.mocked(api.put).mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('button', { name: 'Hide scores now' }));
    expect(await screen.findByText('Couldn’t change that. Try again.')).toBeInTheDocument();
  });
});
