import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamOverlay } from '../../types';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import { readMessages, writeMessages } from '../../lib/overlayMessages';
import type { OverlaySaveResult } from '../../hooks/useStreamOverlay';
import { competition, session, sponsor } from '../../test/factories';
import { liveStream } from '../../test/streamFakes';
import { CompetitionContext, type CompetitionCtx } from './context';
import { ProducePage } from './ProducePage';

const auth = vi.hoisted(() => ({ organiser: true }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => auth.organiser }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(async () => ({ data: [] })), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

let overlay: StreamOverlay;
let outcome: OverlaySaveResult;
const saved: StreamOverlay[] = [];
const saveOverlay = vi.fn(async (change: (o: StreamOverlay) => StreamOverlay) => {
  const next = change(overlay);
  saved.push(next);
  return outcome;
});

function show(extra: Partial<CompetitionCtx> = {}) {
  const value: CompetitionCtx = {
    competition: competition({ sessions: [session(1, { arenaName: 'Arena 2' })] }),
    reload: vi.fn(), streams: [liveStream({ arenaName: 'Arena 1' })], streamingEnabled: true, invoke: vi.fn(), ready: 1, streamMessages: [],
    overlay, saveOverlay, ...extra,
  };
  return render(<MemoryRouter><CompetitionContext.Provider value={value}><ProducePage /></CompetitionContext.Provider></MemoryRouter>);
}

beforeEach(() => {
  auth.organiser = true;
  overlay = { ...DEFAULT_OVERLAY, revision: 3 };
  outcome = 'saved';
  saved.length = 0;
  saveOverlay.mockClear();
});

describe('ProducePage', () => {
  it('is only for the event’s organisers', () => {
    auth.organiser = false;
    show();
    expect(screen.getByText('Only the event’s organisers can change what viewers see.')).toBeInTheDocument();
  });

  it('puts a banner on air in the chosen style and arenas, and clears it', async () => {
    show();
    expect(screen.getByText('No banner up')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Banner text'), { target: { value: '  Lunch break until 1pm ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Alert' }));
    fireEvent.click(screen.getByRole('button', { name: 'Arena 2' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Put on air' })); });
    expect(saved.at(-1)).toMatchObject({ bannerText: 'Lunch break until 1pm', bannerStyle: 2, bannerArenas: ['Arena 2'] });

    fireEvent.click(screen.getByRole('button', { name: 'Arena 2' }));
    expect(screen.getByText('All arenas')).toBeInTheDocument();
  });

  it('clears a banner that is up', async () => {
    overlay = { ...overlay, bannerText: 'Gates open' };
    show();
    expect(screen.getByText(/On air:/)).toHaveTextContent('On air: Gates open');
    expect(screen.getByRole('button', { name: 'Update banner' })).toBeDisabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear banner' })); });
    expect(saved.at(-1)?.bannerText).toBeNull();
  });

  it('saves, reuses and forgets messages on this device', () => {
    writeMessages(competition().id, [{ text: 'Prize giving at 4.30pm', style: 0 }]);
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Prize giving at 4.30pm' }));
    expect(screen.getByLabelText('Banner text')).toHaveValue('Prize giving at 4.30pm');

    fireEvent.change(screen.getByLabelText('Banner text'), { target: { value: 'Arena 2 closed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save message' }));
    expect(readMessages(competition().id).map((m) => m.text)).toEqual(['Prize giving at 4.30pm', 'Arena 2 closed']);

    fireEvent.click(screen.getByRole('button', { name: 'Forget “Prize giving at 4.30pm”' }));
    expect(readMessages(competition().id).map((m) => m.text)).toEqual(['Arena 2 closed']);
  });

  it('saves the strip, score card timing and look together', async () => {
    show();
    expect(screen.getByRole('button', { name: 'Save for this event' })).toBeDisabled();
    fireEvent.click(screen.getByRole('group', { name: 'Now racing strip' }).querySelector('button:nth-child(3)')!);
    fireEvent.click(screen.getByRole('group', { name: 'Score cards' }).querySelector('button:nth-child(2)')!);
    fireEvent.change(screen.getByLabelText('Show after', { exact: false }), { target: { value: '99' } });
    fireEvent.change(screen.getByLabelText('for', { exact: false }), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Large' }));
    fireEvent.change(screen.getByLabelText('Highlight'), { target: { value: '#ff0000' } });
    fireEvent.change(screen.getByLabelText('Background'), { target: { value: '#000000' } });
    fireEvent.change(screen.getByLabelText('Logo link (https)'), { target: { value: ' https://example.com/logo.png ' } });
    fireEvent.click(screen.getByLabelText('Show clock'));
    fireEvent.change(screen.getByLabelText('Where to show clock'), { target: { value: 'bottom-right' } });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save for this event' })); });

    expect(saved.at(-1)).toMatchObject({ stripMode: 2, scoreCardMode: 2, scoreCardDelaySeconds: 30, scoreCardSeconds: 3 });
    expect(saved.at(-1)?.look).toMatchObject({
      size: 'large', accent: '#ff0000', background: '#000000', logoUrl: 'https://example.com/logo.png',
      elements: expect.objectContaining({ clock: { show: true, place: 'bottom-right' } }),
    });
    expect(screen.getByRole('button', { name: 'Save for this event' })).toBeDisabled();
  });

  it('can undo unsaved changes', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Small' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo changes' }));
    expect(screen.getByRole('button', { name: 'Save for this event' })).toBeDisabled();
  });

  it('explains a clash with another producer and a failed save', async () => {
    outcome = 'conflict';
    show();
    fireEvent.change(screen.getByLabelText('Banner text'), { target: { value: 'Mine' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Put on air' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Someone else just changed the overlays.');

    outcome = 'failed';
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Put on air' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t save. Check your connection and try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('turns the sponsor cards on, off or to breaks only, at once', async () => {
    show();
    const modes = within(screen.getByRole('group', { name: 'Sponsor cards' }));
    expect(modes.getByRole('button', { name: 'In breaks' })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { fireEvent.click(modes.getByRole('button', { name: 'Off' })); });
    expect(saved.at(-1)).toMatchObject({ sponsorMode: 2 });
    await act(async () => { fireEvent.click(modes.getByRole('button', { name: 'Always' })); });
    expect(saved.at(-1)).toMatchObject({ sponsorMode: 1 });
    // The look has not been touched, so it is still not waiting to be saved.
    expect(screen.getByRole('button', { name: 'Save for this event' })).toBeDisabled();
  });

  it('skips the sponsor on screen, when there are sponsors in the break rotation', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { action: 'skip' } });
    const { unmount } = show();
    expect(screen.getByText('No sponsors are set to show on the video during breaks.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip sponsor' })).toBeDisabled();
    unmount();

    show({ sponsors: [sponsor(1, { showOn: 16 }), sponsor(2, { showOn: 16 }), sponsor(3, { showOn: 1 })] });
    expect(screen.getByText('2 sponsors in the break rotation, headline first.')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Skip sponsor' })); });
    expect(api.post).toHaveBeenCalledWith('/competitions/1/sponsors/skip');

    vi.mocked(api.post).mockRejectedValue(new Error('no signal'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Skip sponsor' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t skip.');
  });

  it('cannot skip when the sponsor cards are off, and says "1 sponsor" for one', () => {
    overlay = { ...overlay, sponsorMode: 2 };
    show({ sponsors: [sponsor(1, { showOn: 16 })] });
    expect(screen.getByText('1 sponsor in the break rotation, headline first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip sponsor' })).toBeDisabled();
  });

  it('previews the unsaved look over a sample video', () => {
    const { container } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Large' }));
    expect(container.querySelector('.mg-ov-large')).not.toBeNull();
    expect(screen.getByText('Seniors · Heat 2')).toBeInTheDocument();
  });

  it('does nothing without a way to save', async () => {
    show({ saveOverlay: undefined, overlay: undefined });
    fireEvent.change(screen.getByLabelText('Banner text'), { target: { value: 'x' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Put on air' })); });
    expect(saveOverlay).not.toHaveBeenCalled();
  });
});
