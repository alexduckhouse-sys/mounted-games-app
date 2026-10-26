import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { CompetitionContext, type CompetitionCtx } from '../../pages/competition/context';
import { competition } from '../../test/factories';
import { liveStream } from '../../test/streamFakes';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import { StreamControlStrip, type StreamControlStripProps } from './StreamControlStrip';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const save = vi.fn();
beforeEach(() => { vi.mocked(api.get).mockResolvedValue({ data: { streams: [liveStream()] } }); save.mockResolvedValue('saved'); });
const show = async (props: Partial<StreamControlStripProps> = {}) => {
  const context: CompetitionCtx = { competition: competition(), streams: [], ready: 1, reload: vi.fn(), invoke: vi.fn(), streamingEnabled: true, streamMessages: [], saveOverlay: save };
  render(<CompetitionContext.Provider value={context}><StreamControlStrip competitionId={1} sectionId={5} {...props} /></CompetitionContext.Provider>);
  await act(async () => {});
};

it('saves overlay changes through the versioned overlay API instead of unsupported camera commands', async () => {
  await show(); fireEvent.click(screen.getByRole('button', { name: /Show.*lanes/i })); await act(async () => {});
  expect(save).toHaveBeenCalled();
  expect(save.mock.calls[0][0](DEFAULT_OVERLAY).look).toMatchObject({ liveCard: 'lanes', liveSectionId: 5 });
  expect(api.post).not.toHaveBeenCalled();
});

it('does not report a failed camera command as sent or change its pressed state', async () => {
  vi.mocked(api.post).mockRejectedValue(new Error('offline')); await show();
  fireEvent.click(screen.getByRole('button', { name: 'Remote zoom 2x' })); await act(async () => {});
  expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t reach the camera phone. Check your signal and try again.');
  expect(screen.getByRole('button', { name: 'Remote zoom 2x' })).toHaveAttribute('aria-pressed', 'false');
  vi.mocked(api.post).mockResolvedValue({ data: {} });
  fireEvent.click(screen.getByRole('button', { name: 'Try again' })); await act(async () => {});
  expect(screen.getByRole('status')).toHaveTextContent('Requested: Zoom 2x');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('retains a banner draft when the server rejects the overlay save', async () => {
  save.mockResolvedValue('failed'); await show();
  fireEvent.change(screen.getByLabelText('Quick stream announcement'), { target: { value: 'Example announcement' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post to stream' })); await act(async () => {});
  expect(screen.getByLabelText('Quick stream announcement')).toHaveValue('Example announcement');
  expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t save the stream banner. Check your signal and try again.');
});

it('updates mute, pause and zoom controls only after the camera command succeeds', async () => {
  vi.mocked(api.post).mockResolvedValue({ data: {} }); await show();
  const click = async (name: string) => { fireEvent.click(screen.getByRole('button', { name })); await act(async () => {}); };
  await click('Remote zoom 3x');
  expect(screen.getByRole('button', { name: 'Remote zoom 3x' })).toHaveAttribute('aria-pressed', 'true');
  expect(api.post).toHaveBeenLastCalledWith('/competitions/1/streams/1/command', { command: 'setZoom', value: '3' });
  await click('Mute stream mic');
  expect(screen.getByRole('button', { name: 'Unmute stream mic' })).toHaveAttribute('aria-pressed', 'true');
  await click('Unmute stream mic');
  expect(api.post).toHaveBeenLastCalledWith('/competitions/1/streams/1/command', { command: 'mute', value: 'false' });
  await click('Pause stream (Back soon)');
  expect(screen.getByRole('button', { name: 'Resume stream' })).toHaveAttribute('aria-pressed', 'true');
  await click('Resume stream');
  expect(api.post).toHaveBeenLastCalledWith('/competitions/1/streams/1/command', { command: 'pause', value: 'false' });
  await click('Save 30s Replay');
  expect(api.post).toHaveBeenLastCalledWith('/competitions/1/streams/1/command', { command: 'saveReplay', value: '30' });
});

it('filters ended cameras and other arenas before choosing a director angle', async () => {
  vi.mocked(api.post).mockResolvedValue({ data: {} });
  vi.mocked(api.get).mockResolvedValue({ data: { streams: [
    liveStream({ id: 1, arenaName: ' Arena One ', angleName: 'Main camera' }),
    liveStream({ id: 2, arenaName: 'arena one', angleName: 'Finish line', audioMuted: true, status: 1 }),
    liveStream({ id: 3, arenaName: 'Arena Two', angleName: 'Other arena' }),
    liveStream({ id: 4, arenaName: 'Arena One', angleName: 'Ended camera', status: 2 }),
  ] } });
  await show({ arenaName: 'Arena One', compact: true });
  expect(screen.queryByRole('button', { name: 'Other arena' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Ended camera' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Finish line' })); await act(async () => {});
  expect(api.post).toHaveBeenLastCalledWith('/competitions/1/streams/2/command', { command: 'selectAngle', value: '2' });
  expect(screen.getByRole('button', { name: 'Finish line' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Unmute stream mic' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Resume stream' })).toBeVisible();
});

it('does not send a command when the camera response is malformed', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { streams: null } }); await show();
  fireEvent.click(screen.getByRole('button', { name: 'Remote zoom 2x' })); await act(async () => {});
  expect(screen.getByRole('status')).toHaveTextContent('No camera is broadcasting.');
  expect(api.post).not.toHaveBeenCalled();
});

it('keeps the current overlay after a conflicting save and translates Up next to its viewer mode', async () => {
  save.mockResolvedValueOnce('conflict'); await show();
  fireEvent.click(screen.getByRole('button', { name: 'Show Heat Table on Stream' })); await act(async () => {});
  expect(screen.getByRole('button', { name: 'Hide Stream Overlay' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent('The overlay changed on another phone. Check it and try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
  expect(screen.getByRole('button', { name: 'Hide Stream Overlay' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Show Up Next on Stream' })); await act(async () => {});
  expect(save.mock.calls.at(-1)![0](DEFAULT_OVERLAY).look).toMatchObject({ liveCard: 'next', liveSectionId: 5 });
  expect(screen.getByRole('button', { name: 'Show Up Next on Stream' })).toHaveAttribute('aria-pressed', 'true');
});
