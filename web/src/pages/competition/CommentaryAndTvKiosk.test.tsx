import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { CompactPageBarProvider } from '../../components/CompactPageBarContext';
import { competition, heat, race, result, session, standing, team } from '../../test/factories';
import type { CompetitionDetail, DeclarationForm, LiveStream } from '../../types';
import { CommentaryDeskPage } from './CommentaryDeskPage';
import { CompetitionContext } from './context';
import { TvKioskPage } from './TvKioskPage';
import { StreamControlStrip } from '../../components/stream/StreamControlStrip';
import { QrAccessModal } from '../../components/QrAccessModal';

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canManage: () => true, canOrganise: () => true }) }));
const saveOverlay = vi.fn().mockResolvedValue('saved');

vi.mock('../../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../live/useLiveHub', () => ({
  useLiveHub: () => ({ connected: true }),
}));

const sampleStreams: LiveStream[] = [
  {
    id: 101,
    competitionId: 1,
    arenaName: 'Main Arena',
    angleName: 'Main Camera',
    status: 0,
    caption: null,
    audioMuted: false,
    hasAudio: true,
    startedAt: '2026-06-01T09:00:00Z',
    viewerCount: 14,
    generation: 1,
  },
  {
    id: 102,
    competitionId: 1,
    arenaName: 'Main Arena',
    angleName: 'Finish Line',
    status: 0,
    caption: null,
    audioMuted: false,
    hasAudio: true,
    startedAt: '2026-06-01T09:05:00Z',
    viewerCount: 8,
    generation: 1,
  },
];

const sampleDeclarations: DeclarationForm[] = [
  {
    id: 1,
    teamId: 1,
    teamName: 'North A',
    competitionId: 1,
    competitionName: 'Spring Championships',
    submittedAt: '2026-06-01T08:00:00Z',
    isLocked: false,
    trainerName: 'Sarah Coach',
    riders: [
      { id: 11, fullName: 'Emma Rider', horseName: 'Comet', isCaptain: true, isReserve: false, orderIndex: 1 },
      { id: 12, fullName: 'Liam Rider', horseName: 'Bramble', isCaptain: false, isReserve: false, orderIndex: 2 },
    ],
  },
];

function makeComp(): CompetitionDetail {
  return competition({
    id: 1,
    name: 'Spring Championships',
    sections: [
      { id: 9, competitionId: 1, format: 2, ageGroup: 'U17', displayName: 'Under 17', finalistCount: 2 },
      { id: 10, competitionId: 1, format: 2, ageGroup: 'Open', displayName: 'Open', finalistCount: 2 },
    ],
    teams: [
      team(1, { competitionSectionId: 9, displayName: 'North A', clubName: 'North Pony Club', bibColour: 'Red' }),
      team(2, { competitionSectionId: 9, displayName: 'South B', clubName: 'South Pony Club', bibColour: 'Blue' }),
      team(3, { competitionSectionId: 9, displayName: 'East C', clubName: 'East Pony Club', bibColour: 'Green' }),
      team(4, { competitionSectionId: 10, displayName: 'West Open', clubName: 'West Pony Club', bibColour: 'Yellow' }),
    ],
    sessions: [
      session(1, {
        competitionSectionId: 9,
        name: 'Session 1',
        arenaName: 'Main Arena',
        status: 1,
        heats: [
          heat(10, {
            sessionId: 1,
            label: 'Heat 1',
            orderIndex: 1,
            entries: [
              { id: 1, teamId: 1, teamName: 'North A', bibColour: 'Red', laneIndex: 1 },
              { id: 2, teamId: 2, teamName: 'South B', bibColour: 'Blue', laneIndex: 2 },
              { id: 3, teamId: 3, teamName: 'East C', bibColour: 'Green', laneIndex: 3 },
            ],
            races: [
              race(100, {
                heatId: 10,
                name: 'Bending',
                orderIndex: 1,
                isComplete: true,
                results: [
                  result(1, 1, { teamName: 'North A', points: 3 }),
                  result(2, 2, { teamName: 'South B', points: 2 }),
                  result(3, 3, { teamName: 'East C', points: 1 }),
                ],
              }),
              race(101, {
                heatId: 10,
                name: 'Mug',
                orderIndex: 2,
                isComplete: false,
                results: [],
              }),
            ],
          }),
          heat(11, {
            sessionId: 1,
            label: 'Heat 2',
            orderIndex: 2,
            entries: [
              { id: 4, teamId: 2, teamName: 'South B', bibColour: 'Blue', laneIndex: 1 },
              { id: 5, teamId: 1, teamName: 'North A', bibColour: 'Red', laneIndex: 2 },
            ],
            races: [race(102, { heatId: 11, name: 'Bending', orderIndex: 1, isComplete: false, results: [] })],
          }),
        ],
      }),
    ],
  });
}

function renderWithCompetition(initialEntry: string, comp = makeComp()) {
  const reload = vi.fn();
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <CompactPageBarProvider>
        <CompetitionContext.Provider
          value={{
            competition: comp,
            saveOverlay,
            reload,
            streams: sampleStreams,
            streamingEnabled: true,
            invoke: vi.fn(),
            ready: 1,
            streamMessages: [],
            sponsors: [],
          }}
        >
          <Routes>
            <Route path="/competitions/:id/commentary" element={<CommentaryDeskPage />} />
            <Route path="/competitions/:id/tv" element={<TvKioskPage />} />
          </Routes>
        </CompetitionContext.Provider>
      </CompactPageBarProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  saveOverlay.mockResolvedValue('saved');
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.endsWith('/standings')) {
      return Promise.resolve({
        data: [
          standing(1, 3, { teamName: 'North A', clubName: 'North Pony Club', wins: 1 }),
          standing(2, 2, { teamName: 'South B', clubName: 'South Pony Club', wins: 0 }),
          standing(3, 1, { teamName: 'East C', clubName: 'East Pony Club', wins: 0 }),
        ],
      });
    }
    if (url === '/declaration-forms') {
      return Promise.resolve({ data: sampleDeclarations });
    }
    if (url.endsWith('/streams')) {
      return Promise.resolve({ data: { enabled: true, streams: sampleStreams } });
    }
    if (url.endsWith('/scorer-links')) {
      return Promise.resolve({
        data: { arenas: ['Main Arena'], defaultExpiresAt: '2026-11-02T00:00:00Z', links: [] },
      });
    }
    return Promise.resolve({ data: [] });
  });
  vi.mocked(api.post).mockResolvedValue({ data: {} });
});

describe('CommentaryDeskPage', () => {
  it('renders key talking points, stream controls, Score & Commentate link, Heat Table view, and QR Access modal', async () => {
    const user = userEvent.setup();
    renderWithCompetition('/competitions/1/commentary?section=9');

    expect(await screen.findByRole('heading', { name: /PA Commentator Desk · Under 17/ })).toBeInTheDocument();

    // Score & Commentate quick link
    const scoreLink = screen.getByRole('link', { name: /Score & Commentate/ });
    expect(scoreLink).toHaveAttribute('href', '/competitions/1/session/1?heat=10&commentator=1');

    // Key talking points banner
    const talkingPoints = screen.getByRole('region', { name: 'Key talking points' });
    expect(within(talkingPoints).getByText(/North A \(3 pts, 1 win\)/)).toBeInTheDocument();
    expect(within(talkingPoints).getByText(/South B \(2 pts\) holds 2nd — East C is 1 pts behind/)).toBeInTheDocument();
    expect(within(talkingPoints).getByText(/North A won Bending \(\+3 pts\)/)).toBeInTheDocument();

    // Stream control strip triggers overlays, camera angles, zoom, mic, pause, replay & announcement
    const streamStrip = await screen.findByRole('region', { name: 'Live stream control strip' });
    expect(within(streamStrip).getByText(/LIVE · Main Camera \(14 watching\)/)).toBeInTheDocument();

    await user.click(within(streamStrip).getByRole('button', { name: /Show Toplist on Stream/ }));
    expect(saveOverlay).toHaveBeenCalled();
    expect(within(streamStrip).getByRole('status')).toHaveTextContent('Showing: Show Toplist');

    await user.click(within(streamStrip).getByRole('button', { name: /Show Lanes on Stream/ }));
    await user.click(within(streamStrip).getByRole('button', { name: /Show Heat Table on Stream/ }));
    await user.click(within(streamStrip).getByRole('button', { name: /Show Up Next on Stream/ }));
    await user.click(within(streamStrip).getByRole('button', { name: /Hide Stream Overlay/ }));

    // Camera angle switcher & controls
    await user.click(within(streamStrip).getByRole('button', { name: 'Finish Line' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/102/command', {
      command: 'selectAngle',
      value: '102',
    });

    await user.click(within(streamStrip).getByRole('button', { name: 'Remote zoom 2x' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/102/command', {
      command: 'setZoom',
      value: '2',
    });

    await user.click(within(streamStrip).getByRole('button', { name: 'Mute stream mic' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/102/command', {
      command: 'mute',
      value: 'true',
    });
    await user.click(within(streamStrip).getByRole('button', { name: 'Unmute stream mic' }));

    await user.click(within(streamStrip).getByRole('button', { name: 'Pause stream (Back soon)' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/102/command', {
      command: 'pause',
      value: 'true',
    });
    await user.click(within(streamStrip).getByRole('button', { name: 'Resume stream' }));

    await user.click(within(streamStrip).getByRole('button', { name: /Save 15s Replay/ }));
    expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/102/command', {
      command: 'saveReplay',
      value: '15',
    });

    await user.click(within(streamStrip).getByRole('button', { name: /Save 30s Replay/ }));
    expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/102/command', {
      command: 'saveReplay',
      value: '30',
    });

    await user.click(within(streamStrip).getByRole('button', { name: 'Refresh stream cameras' }));

    await user.type(within(streamStrip).getByLabelText('Quick stream announcement'), ' Final call for Heat 2');
    await user.click(within(streamStrip).getByRole('button', { name: 'Post to stream' }));
    expect(within(streamStrip).getByRole('status')).toHaveTextContent('Stream banner saved.');
    expect(saveOverlay.mock.calls.at(-1)![0]({})).toMatchObject({ bannerText: 'Final call for Heat 2', bannerStyle: 1 });

    // Handle chat error gracefully
    saveOverlay.mockRejectedValueOnce(new Error('network error'));
    await user.type(within(streamStrip).getByLabelText('Quick stream announcement'), 'Retry msg');
    await user.click(within(streamStrip).getByRole('button', { name: 'Post to stream' }));
    expect(await within(streamStrip).findByText('Could not save the stream banner. Try again.')).toBeInTheDocument();

    // Switch desk view to Heat Table
    const viewGroup = screen.getByRole('group', { name: 'Commentary desk view' });
    await user.click(within(viewGroup).getByRole('button', { name: 'Heat Table' }));
    expect(screen.getByRole('region', { name: 'Current Heat Table' })).toBeInTheDocument();

    // Open QR Access Modal
    await user.click(screen.getByRole('button', { name: /QR Access/ }));
    const qrModal = await screen.findByRole('dialog', { name: 'QR Code Access Hub' });
    await user.click(within(qrModal).getByRole('tab', { name: /Screens, PA & Spectator QR Codes/ }));
    expect(within(qrModal).getByText('2nd Phone Stream Controller')).toBeInTheDocument();
    await user.click(within(qrModal).getAllByRole('button', { name: /Copy link/ })[0]);
    expect(await within(qrModal).findByText('Copied')).toBeInTheDocument();
    await user.click(within(qrModal).getByRole('tab', { name: /Volunteer & Scorer QR Links/ }));
    await user.click(within(qrModal).getByRole('button', { name: 'Close QR access modal' }));
    expect(screen.queryByRole('dialog', { name: 'QR Code Access Hub' })).toBeNull();
  });
});

describe('TvKioskPage', () => {
  it('supports Current Heat Table slide, removes redundant Club columns, and offers Auto-follow live section, Full screen, Stream Controls & QR Access', async () => {
    const user = userEvent.setup();
    renderWithCompetition('/competitions/1/tv');

    expect(await screen.findByRole('heading', { name: /Spring Championships · Under 17/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auto-follow live section' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Full screen/ })).toBeInTheDocument();

    // Expand collapsible Stream Controls on TV Kiosk
    await user.click(screen.getByRole('button', { name: /Stream Controls/ }));
    expect(await screen.findByRole('region', { name: 'Live stream control strip' })).toBeInTheDocument();

    // Switch to Current Heat Table slide (the old slide wipes off before the new one arrives)
    const slideGroup = screen.getByRole('group', { name: 'TV scoreboard slide' });
    await user.click(within(slideGroup).getByRole('button', { name: 'Current Heat Table' }));
    expect(await screen.findByRole('region', { name: 'Current Heat Table' })).toBeInTheDocument();

    // Switch to Latest Race Result slide and verify Club column is removed
    await user.click(within(slideGroup).getByRole('button', { name: 'Latest Race Result' }));
    const latestSection = await screen.findByRole('region', { name: 'Latest Race Result' });
    const latestHeaders = within(latestSection).getAllByRole('columnheader').map((th) => th.textContent);
    expect(latestHeaders).toEqual(['Place', 'Bib', 'Team', 'Race Pts', 'Total Pts']);
    expect(latestHeaders).not.toContain('Club');

    // Switch to Live Section Standings slide and verify Club column is removed
    await user.click(within(slideGroup).getByRole('button', { name: 'Live Section Standings' }));
    const standingsSection = await screen.findByRole('region', { name: 'Live Section Standings' });
    const standingsHeaders = within(standingsSection).getAllByRole('columnheader').map((th) => th.textContent);
    expect(standingsHeaders).toEqual(['Rank', 'Bib', 'Team', 'Heat Pts', 'Finals Pts', 'Total Pts']);
    expect(standingsHeaders).not.toContain('Club');

    // Open QR Access Modal from TV Kiosk
    await user.click(screen.getByRole('button', { name: /QR Access/ }));
    expect(await screen.findByRole('dialog', { name: 'QR Code Access Hub' })).toBeInTheDocument();
  });

  it('handles offline stream list and scorer client mode in StreamControlStrip', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    render(<StreamControlStrip competitionId={1} />);
    const strip = screen.getByRole('region', { name: 'Live stream control strip' });
    expect(within(strip).getByText(/Ready for stream overlays & remote camera/)).toBeInTheDocument();
    await user.click(within(strip).getByRole('button', { name: /Show Lanes on Stream/ }));
    expect(within(strip).getByRole('status')).toHaveTextContent('Sign in as an organiser to change overlays.');

    render(<StreamControlStrip competitionId={1} useScorerClient />);
    render(<MemoryRouter><QrAccessModal open onClose={vi.fn()} competitionId={1} competitionName="Spring" /></MemoryRouter>);
  });
});
