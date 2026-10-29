import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { CompactPageBarProvider } from '../../components/CompactPageBarContext';
import { competition, heat, race, result, session, standing, team } from '../../test/factories';
import type { CompetitionDetail, DeclarationForm, LiveStream } from '../../types';
import { CommentaryDeskPage } from './CommentaryDeskPage';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { CompetitionContext } from './context';
import { TvKioskPage } from './TvKioskPage';
import { StreamControlStrip } from '../../components/stream/StreamControlStrip';
import { QrAccessModal } from '../../components/QrAccessModal';
import { CurrentCompetitionProvider } from '../../competition/CurrentCompetitionContext';
import { TickerProvider } from '../../components/TickerContext';
import { TopBarTicker } from '../../components/TopBarTicker';

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

function renderWithCompetition(initialEntry: string, comp = makeComp(), lang: 'en' | 'cy' | 'fr' = 'en') {
  const reload = vi.fn();
  return render(
    <LanguageProvider initial={lang}>
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
    </MemoryRouter>
    </LanguageProvider>,
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
  it('renders key talking points, stream controls, Score and commentate link, heat / toplist points, Up next and QR access modal', async () => {
    const user = userEvent.setup();
    renderWithCompetition('/competitions/1/commentary?section=9');

    expect(await screen.findByRole('heading', { name: /Commentary desk · Under 17/ })).toBeInTheDocument();

    // Score and commentate quick link
    const scoreLink = screen.getByRole('link', { name: /Score and commentate/ });
    expect(scoreLink).toHaveAttribute('href', '/competitions/1/session/1?heat=10&commentator=1');

    // Key talking points banner
    const talkingPoints = screen.getByRole('region', { name: 'Key talking points' });
    expect(within(talkingPoints).getByText(/North A \(3 pts, 1 win\)/)).toBeInTheDocument();
    expect(within(talkingPoints).getByText(/South B \(2 pts\) holds 2nd, 1 pt ahead of East C/)).toBeInTheDocument();
    expect(within(talkingPoints).getByText(/North A won Bending \(\+3 pts\)/)).toBeInTheDocument();

    // One-tap overlays replace the old stream strip
    const overlays = await screen.findByRole('region', { name: 'Stream overlays' });
    expect(screen.queryByRole('region', { name: 'Live stream control strip' })).toBeNull();
    const tiles = within(within(overlays).getByRole('radiogroup', { name: 'On screen' })).getAllByRole('radio');
    expect(tiles.map((tile) => tile.textContent)).toEqual(['Off', 'Toplist', 'Heat table', 'Podium', 'Race result', 'Up next', 'Favourites', 'Race title', 'Sponsors']);
    expect(tiles[0]).toHaveAttribute('aria-checked', 'true');
    await user.click(within(overlays).getByRole('radio', { name: 'Toplist' }));
    expect(saveOverlay.mock.calls.at(-1)![0]({ look: {}, sponsorMode: 0 })).toMatchObject({ look: { liveCard: 'toplist' } });
    saveOverlay.mockResolvedValueOnce('failed');
    await user.click(within(overlays).getByRole('radio', { name: 'Heat table' }));
    expect(await within(overlays).findByRole('alert')).toHaveTextContent('Couldn’t change the overlay');
    const autoChip = within(overlays).getByRole('button', { name: 'Auto off' });
    await user.click(autoChip);
    expect(within(overlays).getByRole('button', { name: 'Auto on' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(overlays).getByRole('link', { name: 'Overlay settings, automations and cameras' })).toHaveAttribute('href', '/competitions/1/stream-controls');

    // Instant replay asks the camera phone to save the clip
    await user.click(within(overlays).getByRole('button', { name: /Instant replay · 30s/ }));
    expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/101/command', { command: 'saveReplay', value: '30' });
    expect(await within(overlays).findByRole('status')).toHaveTextContent('Asked the camera phone to save the last 30s.');
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    await user.click(within(overlays).getByRole('button', { name: /Instant replay · 30s/ }));
    expect(await within(overlays).findByText(/Couldn’t reach the camera phone/)).toBeInTheDocument();

    // No heat table view any more; lanes show heat / toplist points and Up next lists what follows
    expect(screen.queryByRole('button', { name: 'Heat Table' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Current heat table' })).toBeNull();
    expect(screen.queryByText(/Say this/)).toBeNull();
    expect(screen.getByLabelText('Rank 1st, 3 in this heat, 3 on the toplist')).toHaveTextContent('3 / 3');
    expect(screen.getByLabelText('Rank 3rd, 1 in this heat, 1 on the toplist')).toHaveTextContent('1 / 1');
    const upNext = screen.getByRole('region', { name: 'Up next' });
    expect(within(upNext).getAllByRole('listitem')).toHaveLength(1);
    expect(within(upNext).getByText('Bending · Session 1 · Heat 2')).toBeInTheDocument();

    // Open QR access Modal
    await user.click(screen.getByRole('button', { name: /QR access/ }));
    const qrModal = await screen.findByRole('dialog', { name: 'Share with QR codes' });
    await user.click(within(qrModal).getByRole('tab', { name: /Screens, PA and spectator QR codes/ }));
    expect(within(qrModal).getByText('Second phone stream controls')).toBeInTheDocument();
    await user.click(within(qrModal).getAllByRole('button', { name: /Copy link/ })[0]);
    expect(await within(qrModal).findByText('Link copied')).toBeInTheDocument();
    await user.click(within(qrModal).getByRole('tab', { name: /Volunteer and scorer QR links/ }));
    await user.click(within(qrModal).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Share with QR codes' })).toBeNull());
  });
});

describe('CommentaryDeskPage lanes', () => {
  it('shows the current race’s rotated lanes with each lane’s hatband and the team’s bib words, as the scorer does', async () => {
    const comp = makeComp();
    comp.laneHatbands = ['Red', 'Blue', 'Lilac #B79CED'];
    comp.teams[0] = { ...comp.teams[0], bibDescription: '[flag:gb] Red with white spots' };
    renderWithCompetition('/competitions/1/commentary?section=9', comp);
    const lanes = await screen.findByRole('region', { name: 'Current heat · lanes in order' });
    expect(within(lanes).getByText(/Lanes for Mug/)).toBeInTheDocument();
    // Race 2 moves everyone up one lane: East C 1, North A 2, South B 3.
    const rows = within(lanes).getAllByRole('listitem').filter((li) => li.parentElement?.parentElement === lanes);
    expect(rows.map((li) => within(li).getAllByText(/^Lane \d$/)[0].textContent)).toEqual(['Lane 1', 'Lane 2', 'Lane 3']);
    expect(within(rows[0]).getByText('East C')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Red hatband')).toBeInTheDocument();
    expect(within(rows[1]).getByText('North A')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Blue hatband')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Bibs: Red with white spots')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Lilac hatband')).toBeInTheDocument();
    expect(lanes.textContent).not.toMatch(/flag:|#B79CED/);
  });

  it('says a team sits out rather than giving it a lane colour', async () => {
    const comp = makeComp();
    comp.laneHatbands = ['Red', 'Blue', 'Green'];
    comp.sessions[0] = { ...comp.sessions[0], lanesPerHeat: 2 };
    renderWithCompetition('/competitions/1/commentary?section=9', comp);
    const lanes = await screen.findByRole('region', { name: 'Current heat · lanes in order' });
    const sitting = within(lanes).getByText('Sits out').closest('li')!;
    expect(within(sitting).queryByText(/hatband/)).toBeNull();
  });
});

describe('TvKioskPage', () => {
  it('shows its controls and slide names in French and Welsh', async () => {
    const fr = renderWithCompetition('/competitions/1/tv', makeComp(), 'fr');
    expect(await screen.findByRole('button', { name: 'Suivre automatiquement la catégorie en direct' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Diapositive du tableau d’affichage TV' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Diapositive suivante' })).toBeInTheDocument();
    fr.unmount();
    renderWithCompetition('/competitions/1/tv', makeComp(), 'cy');
    expect(await screen.findByRole('button', { name: 'Dilyn yr adran fyw yn awtomatig' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sleid nesaf' })).toBeInTheDocument();
  });

  it('supports Current heat table slide, removes redundant Club columns, and offers Auto-follow live section, Full screen, Stream Controls & QR access', async () => {
    const user = userEvent.setup();
    renderWithCompetition('/competitions/1/tv');

    expect(await screen.findByRole('heading', { name: /Spring Championships · Under 17/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auto-follow live section' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Full screen/ })).toBeInTheDocument();

    // Expand collapsible Stream Controls on TV kiosk
    await user.click(screen.getByRole('button', { name: /Stream Controls/ }));
    expect(await screen.findByRole('region', { name: 'Live stream control strip' })).toBeInTheDocument();

    // Switch to Current heat table slide (the old slide wipes off before the new one arrives)
    const slideGroup = screen.getByRole('group', { name: 'TV scoreboard slide' });
    await user.click(within(slideGroup).getByRole('button', { name: 'Current heat table' }));
    expect(await screen.findByRole('region', { name: 'Current heat table' })).toBeInTheDocument();

    // Switch to Latest Race Result slide and verify Club column is removed
    await user.click(within(slideGroup).getByRole('button', { name: 'Latest Race Result' }));
    const latestSection = await screen.findByRole('region', { name: 'Latest Race Result' });
    const latestHeaders = within(latestSection).getAllByRole('columnheader').map((th) => th.textContent);
    expect(latestHeaders).toEqual(['Place', 'Bib', 'Team', 'Race Pts', 'Total Pts']);
    expect(latestHeaders).not.toContain('Club');

    // Switch to Live toplist slide and verify Club column is removed
    await user.click(within(slideGroup).getByRole('button', { name: 'Live toplist' }));
    const standingsSection = await screen.findByRole('region', { name: 'Live toplist' });
    const standingsHeaders = within(standingsSection).getAllByRole('columnheader').map((th) => th.textContent);
    expect(standingsHeaders).toEqual(['Rank', 'Bib', 'Team', 'Heat Pts', 'Finals Pts', 'Total Pts']);
    expect(standingsHeaders).not.toContain('Club');

    // Open QR access Modal from TV kiosk
    await user.click(screen.getByRole('button', { name: /QR access/ }));
    expect(await screen.findByRole('dialog', { name: 'Share with QR codes' })).toBeInTheDocument();
  });

  it('lists the lane draw for the next race, rotated as the commentary desk shows it', async () => {
    renderWithCompetition('/competitions/1/tv');
    const draw = await screen.findByRole('region', { name: 'In the ring and next heat lane draw' });
    const first = within(draw).getAllByRole('list')[0];
    const rows = within(first).getAllByRole('listitem');
    // Same order as the commentary desk test above: race 2 moves everyone up one lane.
    expect(rows.map((li) => within(li).getByText(/^Lane \d$/).textContent)).toEqual(['Lane 1', 'Lane 2', 'Lane 3']);
    expect(within(rows[0]).getByText('East C')).toBeInTheDocument();
    expect(within(rows[1]).getByText('North A')).toBeInTheDocument();
  });

  it('handles offline stream list and scorer client mode in StreamControlStrip', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    render(<StreamControlStrip competitionId={1} />);
    const strip = screen.getByRole('region', { name: 'Live stream control strip' });
    expect(within(strip).getByText(/Ready for stream overlays & remote camera/)).toBeInTheDocument();
    await user.click(within(strip).getByRole('button', { name: /Show lanes on stream/ }));
    expect(within(strip).getByRole('status')).toHaveTextContent('Sign in as an organiser to change overlays.');

    render(<StreamControlStrip competitionId={1} useScorerClient />);
    render(<MemoryRouter><QrAccessModal open onClose={vi.fn()} competitionId={1} competitionName="Spring" /></MemoryRouter>);
  });
});

describe('CommentaryDeskPage in the dock', () => {
  it('moves the header controls into a sheet and keeps the title on the page', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/competitions/1/commentary?section=9']}>
        <CurrentCompetitionProvider>
          <TickerProvider>
            <CompactPageBarProvider>
              <CompetitionContext.Provider value={{ competition: makeComp(), saveOverlay, reload: vi.fn(), streams: sampleStreams, streamingEnabled: true, invoke: vi.fn(), ready: 1, streamMessages: [], sponsors: [] }}>
                <Routes><Route path="/competitions/:id/commentary" element={<CommentaryDeskPage />} /></Routes>
              </CompetitionContext.Provider>
            </CompactPageBarProvider>
            <TopBarTicker />
          </TickerProvider>
        </CurrentCompetitionProvider>
      </MemoryRouter>,
    );
    await screen.findByRole('region', { name: 'Current heat · lanes in order' });
    expect(screen.queryByRole('button', { name: /QR access/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /TV kiosk/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Commentary desk controls' }));
    const sheet = within(await screen.findByRole('dialog', { name: 'Commentary desk controls' }));
    expect(sheet.getByRole('button', { name: /^View/ })).toHaveTextContent('Side by side');
    expect(sheet.getByRole('link', { name: /TV kiosk/i })).toBeInTheDocument();
    expect(sheet.getByRole('link', { name: /Score and commentate/i })).toBeInTheDocument();
    expect(sheet.getByRole('button', { name: /^Heat/ })).toBeInTheDocument();
    await user.click(sheet.getByRole('button', { name: /QR access/ }));
    expect(await screen.findByRole('dialog', { name: 'Share with QR codes' })).toBeInTheDocument();
  });
});
