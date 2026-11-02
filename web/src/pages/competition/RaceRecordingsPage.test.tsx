import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedReplayClip } from '../../live/replayBuffer';
import { competition, heat, race, session } from '../../test/factories';
import { CompetitionContext } from './context';
import { RaceRecordingsPage } from './RaceRecordingsPage';

let organiser = true;
let saved: SavedReplayClip[] = [];
const share = vi.hoisted(() => vi.fn());
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => organiser }) }));
vi.mock('../../hooks/useSavedReplays', () => ({ useSavedReplays: () => saved }));
vi.mock('../../lib/shareFile', () => ({ shareOrDownloadFile: share }));
vi.mock('../../components/stream/ReplayInspector', () => ({ renderTrimmedFollowClip: vi.fn() }));
vi.mock('../../live/replayBuffer');

const clip = (id: string, extra: Partial<SavedReplayClip> = {}): SavedReplayClip => ({
  id, competitionId: 1, arenaName: 'Main Arena', label: id, createdAt: '2026-06-01T10:05:00Z', durationSeconds: 45, mimeType: 'video/webm',
  blob: new Blob(['x']), url: `blob:${id}`, source: 'race', ...extra,
});

const oneHeat = [session(1, { sectionName: 'Under 12', arenaName: 'Main Arena', heats: [heat(11, { races: [race(111, { name: 'Bending' }), race(112, { name: 'Mug' })] })] })];
const threeHeats = [session(1, { sectionName: 'Under 12', arenaName: 'Main Arena', heats: [
  heat(11, { orderIndex: 1, races: [race(111, { name: 'Bending' })] }),
  heat(12, { orderIndex: 2, races: [race(121, { name: 'Bending' })] }),
] }), session(2, { competitionSectionId: 6, sectionName: 'Under 14', arenaName: 'Second Arena', heats: [heat(21, { orderIndex: 1, label: 'Final', races: [race(211, { name: 'Relay' })] })] })];

function mount(sessions = oneHeat, url = '/competitions/1/recordings') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CompetitionContext.Provider value={{ competition: competition({ sessions }), reload: vi.fn(), streams: [], streamingEnabled: true, invoke: vi.fn(), ready: 1, streamMessages: [], scoreCards: [] } as never}>
        <Routes>
          <Route path="/competitions/:id/recordings" element={<RaceRecordingsPage />} />
        </Routes>
      </CompetitionContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  organiser = true;
  saved = [];
  share.mockReset();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

describe('Race recordings page', () => {
  it('only shows the organiser a page, and the rest are told it is for organisers', () => {
    organiser = false;
    saved = [clip('x', { raceId: 111 })];
    mount();
    expect(screen.getByText('Only the competition organiser or team can control the stream.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Watch/ })).toBeNull();
  });

  it('says what to do when nothing has been recorded, and links to Stream controls', () => {
    mount();
    expect(screen.getByText('Nothing recorded yet')).toBeInTheDocument();
    expect(screen.getByText(/Keep Stream controls open on this phone while a camera is live/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Stream controls' })).toHaveAttribute('href', '/competitions/1/stream-controls?tab=replay');
    expect(screen.queryByText('Bending')).toBeNull();
  });

  it('groups by session and heat, in race order, with a quiet row for a race that was not recorded', () => {
    saved = [clip('Under 12 Session 1 · Heat 1 · Bending')];
    mount();
    expect(screen.getByRole('region', { name: 'Under 12 Session 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Heat 1/ })).toHaveTextContent('1 of 2 recorded');
    expect(screen.getByText('Recorded on this phone: 1 of 2')).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: 'Under 12 Session 1 · Heat 1' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Bending');
    expect(rows[0]).toHaveTextContent('45s');
    expect(within(rows[0]).getByRole('button', { name: /Watch: Bending/ })).toBeInTheDocument();
    expect(within(rows[0]).getByRole('button', { name: 'Share Bending' })).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('Mug');
    expect(rows[1]).toHaveTextContent('Not recorded on this phone');
    expect(within(rows[1]).queryByRole('button')).toBeNull();
  });

  it('watches a recording in place, without editing controls, and closes it again', async () => {
    const user = userEvent.setup();
    saved = [clip('Bending clip', { raceId: 111 })];
    mount();
    await user.click(screen.getByRole('button', { name: /Watch: Bending/ }));
    const player = screen.getByRole('region', { name: 'Replay: Bending clip' });
    expect(within(player).getByRole('button', { name: 'Play' })).toBeInTheDocument();
    for (const name of ['Start here', 'End here', 'Save clip', 'Remove', 'Slow-mo']) expect(within(player).queryByRole('button', { name })).toBeNull();
    await user.click(within(player).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: /^Replay:/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Watch: Bending/ }));
    await user.click(screen.getByRole('button', { name: /Close: Bending/ }));
    expect(screen.queryByRole('region', { name: /^Replay:/ })).toBeNull();
  });

  it('shares the recording as a file', async () => {
    const user = userEvent.setup();
    saved = [clip('Under 12 Session 1 · Heat 1 · Mug', { raceId: 112, mimeType: 'video/mp4' })];
    mount();
    await user.click(screen.getByRole('button', { name: 'Share Mug' }));
    expect(share).toHaveBeenCalledTimes(1);
    const [file, details] = share.mock.calls[0];
    expect(file.name).toBe('Under 12 Session 1 Heat 1 Mug.mp4');
    expect(file.type).toBe('video/mp4');
    expect(details).toEqual({ title: 'Under 12 Session 1 · Heat 1 · Mug' });
  });

  it('lists a race recorded twice as two rows, the newest first and keeps recordings that fit no race under Other recordings', () => {
    saved = [clip('new', { raceId: 111, createdAt: '2026-06-01T10:30:00Z' }), clip('old', { raceId: 111, createdAt: '2026-06-01T10:00:00Z' }), clip('Stray clip', { raceId: 999 })];
    mount();
    expect(screen.getByText('Bending (earlier recording)')).toBeInTheDocument();
    const other = screen.getByRole('region', { name: 'Other recordings' });
    expect(within(other).getByText('Stray clip')).toBeInTheDocument();
  });

  it('offers a heat picker once the list is long, and narrows the list to the heat chosen', async () => {
    const user = userEvent.setup();
    saved = [clip('r', { raceId: 211 })];
    mount(threeHeats);
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Under 12 Session 1', 'Under 14 Session 1']);
    await user.click(screen.getByRole('button', { name: /^Show: All heats/ }));
    await user.click(screen.getByRole('option', { name: 'Under 14 Session 1 · Final' }));
    expect(screen.queryByRole('region', { name: 'Under 12 Session 1' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Under 14 Session 1' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Other recordings' })).toBeNull();
  });

  it('opens on the heat named in the address and falls back to all heats for an unknown one', () => {
    saved = [clip('r', { raceId: 211 })];
    const view = mount(threeHeats, '/competitions/1/recordings?heat=12');
    expect(screen.getByRole('button', { name: /^Show: Under 12 Session 1 · Heat 2/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Under 14 Session 1' })).toBeNull();
    view.unmount();
    mount(threeHeats, '/competitions/1/recordings?heat=999');
    expect(screen.getByRole('button', { name: /^Show: All heats/ })).toBeInTheDocument();
  });

  it('has no picker for a short list', () => {
    saved = [clip('r', { raceId: 111 })];
    mount();
    expect(screen.queryByRole('button', { name: /^Show:/ })).toBeNull();
  });
});
