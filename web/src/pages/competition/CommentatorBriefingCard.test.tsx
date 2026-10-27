import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { heat, race, result, session, standing, team } from '../../test/factories';
import type { CommentatorBriefing } from '../../types';
import { CommentatorBriefingCard } from './CommentatorBriefingCard';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));

const h = heat(10, {
  sessionId: 1,
  label: 'Heat 1',
  orderIndex: 1,
  entries: [
    { id: 1, teamId: 1, teamName: 'North A', bibColour: 'Red', laneIndex: 1 },
    { id: 2, teamId: 2, teamName: 'South B', bibColour: 'Blue', laneIndex: 2 },
  ],
  races: [
    race(100, { heatId: 10, name: 'Bending', orderIndex: 1, isComplete: true, results: [result(1, 1, { teamName: 'North A', points: 2 }), result(2, 2, { teamName: 'South B', points: 1 })] }),
    race(101, { heatId: 10, name: 'Mug', orderIndex: 2, isComplete: false, results: [] }),
  ],
});
const s = session(1, { name: 'Session 1', heats: [h] });

const props = {
  competitionId: 1,
  session: s,
  heat: h,
  allSessions: [s],
  standings: [standing(1, 2, { teamName: 'North A' }), standing(2, 1, { teamName: 'South B' })],
  teams: [team(1, { displayName: 'North A' }), team(2, { displayName: 'South B' })],
  declarations: [],
  refreshTick: 0,
};

const server: CommentatorBriefing = {
  competitionId: 1, sessionId: 1, sessionName: 'Session 1', heatId: 10, heatLabel: 'Heat 1', currentRaceName: 'Mug',
  talkingPoints: ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'],
  biggestMoverHeadline: 'Biggest mover: South B climbed 1 place',
  lanes: [
    { laneIndex: 1, teamId: 1, teamName: 'North A', clubName: 'N', currentRank: 1, totalPoints: 2, ridersAndPonies: ['Emma R on Comet'], stakesHeadline: 'Leading overall', gameSpecialistNote: 'Won the last race' },
    { laneIndex: 2, teamId: 2, teamName: 'South B', clubName: 'S', currentRank: null, totalPoints: 1, ridersAndPonies: [] },
  ],
};

describe('CommentatorBriefingCard', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
  });

  it('shows the server briefing in the desk lane order, capped at six talking points', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: server });
    render(<CommentatorBriefingCard {...props} laneOrder={[{ teamId: 2, lane: '1', sitting: false }, { teamId: 1, lane: '2', sitting: false }]} />);
    expect(await screen.findByText('Biggest mover: South B climbed 1 place')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/competitions/1/sessions/1/heats/10/commentator-briefing');
    const lanes = within(screen.getByRole('region', { name: 'Briefing' })).getAllByRole('listitem');
    expect(screen.queryByText('Seven')).toBeNull();
    expect(screen.getByText('Six')).toBeInTheDocument();
    expect(screen.getByText('Emma R on Comet')).toBeInTheDocument();
    expect(screen.getByText('Leading overall')).toBeInTheDocument();
    const text = lanes.map((l) => l.textContent).join('|');
    expect(text.indexOf('South B')).toBeLessThan(text.indexOf('North A'));
    expect(screen.getByText('Rank 1 · 2 pts')).toBeInTheDocument();
  });

  it('names each team in the talking points by the lane it rides in this race, not the drawn one', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...server, talkingPoints: [
      'Lane 1 (North A): leading overall.', 'Lane 2 (South B) won the last race.', 'Lane 4 (West C) is new here.',
    ] } });
    render(<CommentatorBriefingCard {...props} laneOrder={[{ teamId: 2, lane: '1', sitting: false }, { teamId: 1, lane: 'S', sitting: true }]} />);
    expect(await screen.findByText('Sitting out (North A): leading overall.')).toBeInTheDocument();
    expect(screen.getByText('Lane 1 (South B) won the last race.')).toBeInTheDocument();
    expect(screen.getByText('Lane 4 (West C) is new here.')).toBeInTheDocument();
  });

  it('falls back to the local briefing when the request fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    render(<CommentatorBriefingCard {...props} laneOrder={[{ teamId: 1, lane: '1', sitting: true }]} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.getByText('Sits out')).toBeInTheDocument();
    expect(screen.getByText('Lane 2')).toBeInTheDocument();
    expect(screen.getByText('Heat 1 · Mug')).toBeInTheDocument();
  });

  it('ignores a response that is not a briefing for this heat', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    render(<CommentatorBriefingCard {...props} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.getByText('Lane 1')).toBeInTheDocument();
    vi.mocked(api.get).mockResolvedValue({ data: { ...server, heatId: 99 } });
    render(<CommentatorBriefingCard {...props} refreshTick={1} />);
    vi.mocked(api.get).mockResolvedValue({ data: null });
    render(<CommentatorBriefingCard {...props} refreshTick={2} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(3));
  });

  it('does not ask the server while offline', () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<CommentatorBriefingCard {...props} />);
    expect(api.get).not.toHaveBeenCalled();
    online.mockRestore();
  });

  it('starts closed on a phone, opens on tap, and says when there are no lanes', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    vi.mocked(api.get).mockResolvedValue({ data: { ...server, lanes: [] } });
    render(<CommentatorBriefingCard {...props} />);
    const toggle = screen.getByRole('button', { name: /Briefing/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('No lane draw for this heat yet.')).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByText('No lane draw for this heat yet.')).toBeNull();
  });

  it('starts closed when matchMedia is missing or throws', () => {
    vi.mocked(api.get).mockRejectedValue(new Error('x'));
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    const a = render(<CommentatorBriefingCard {...props} />);
    expect(screen.getByRole('button', { name: /Briefing/ })).toHaveAttribute('aria-expanded', 'false');
    a.unmount();
    window.matchMedia = (() => { throw new Error('no'); }) as unknown as typeof window.matchMedia;
    render(<CommentatorBriefingCard {...props} />);
    expect(screen.getByRole('button', { name: /Briefing/ })).toHaveAttribute('aria-expanded', 'false');
  });
});
