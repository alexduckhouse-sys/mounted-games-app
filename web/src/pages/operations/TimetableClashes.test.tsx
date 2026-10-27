import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { detectTimetableClashes } from '../../lib/timetableClashes';
import { clashReason, clashesForSession } from './clashText';
import { TimetableClashes } from './TimetableClashes';
import { competition as makeCompetition, session, team } from '../../test/factories';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));
vi.mock('../../lib/timetableClashes', () => ({ detectTimetableClashes: vi.fn() }));

const side = (sessionId: number, name: string, arena: string, time: string) => ({
  team: team(sessionId, { displayName: name }), heatId: sessionId * 10, sessionId, heatLabel: 'Heat 1', arenaName: arena, lane: 1, effectiveStart: new Date(), timeText: time,
});
const clash = (reason: 'trainer' | 'pony' | 'followed', detail: string | null = 'Sam Lee') => ({
  key: `k-${reason}`, reason, sharedDetail: detail, gapMinutes: 10, summary: '', first: side(1, 'Oak A', 'Arena 1', '10:30'), second: side(2, 'Elm B', 'Arena 2', '10:40'),
});
const comp = makeCompetition({ id: 7, sessions: [session(1, { name: 'Under 12, session 1' }), session(2, { name: 'Under 14, session 1' }), session(3, { name: 'Open' })] });

describe('clash text', () => {
  it('says why two teams are tied together', () => {
    expect(clashReason(clash('trainer'))).toBe('Same trainer: Sam Lee');
    expect(clashReason(clash('pony', 'Biscuit'))).toBe('Same pony: Biscuit');
    expect(clashReason(clash('trainer', null))).toBe('Same trainer: a shared trainer');
    expect(clashReason(clash('pony', null))).toBe('Same pony: a shared pony');
    expect(clashReason(clash('followed', null))).toBe('Followed together');
  });
  it('finds the clashes on either side', () => {
    const list = [clash('trainer')];
    expect(clashesForSession(list, 1)).toHaveLength(1);
    expect(clashesForSession(list, 2)).toHaveLength(1);
    expect(clashesForSession(list, 3)).toHaveLength(0);
  });
});

describe('TimetableClashes', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({ data: [{ teamId: 1, riders: [{ horseName: 'Biscuit', ponyPassportNumber: 'P1' }] }] });
    vi.mocked(detectTimetableClashes).mockReturnValue([clash('trainer')] as never);
  });

  it('puts a calm warning under each affected session with names and times', async () => {
    render(<TimetableClashes competition={comp} />);
    expect(await screen.findByRole('region', { name: 'Clashes between sessions' })).toBeInTheDocument();
    expect(screen.getByLabelText('Under 12, session 1')).toHaveTextContent('1 clash');
    expect(screen.getByLabelText('Under 14, session 1')).toHaveTextContent('Oak A and Elm B');
    expect(screen.getAllByText('Same trainer: Sam Lee')).toHaveLength(2);
    expect(screen.getAllByText('Arena 1 10:30 and Arena 2 10:40, 10 min apart')).toHaveLength(2);
    expect(screen.queryByLabelText('Open')).not.toBeInTheDocument();
  });

  it('hands the riders’ ponies to the detector once they are loaded', async () => {
    render(<TimetableClashes competition={comp} />);
    await waitFor(() => expect(detectTimetableClashes).toHaveBeenLastCalledWith(comp, { declarations: [{ teamId: 1, riders: [{ horseName: 'Biscuit', ponyPassportNumber: 'P1' }] }] }));
  });

  it('says same time for a zero gap', async () => {
    vi.mocked(detectTimetableClashes).mockReturnValue([{ ...clash('pony', 'Biscuit'), gapMinutes: 0 }] as never);
    render(<TimetableClashes competition={comp} />);
    expect((await screen.findAllByText('Arena 1 10:30 and Arena 2 10:40, at the same time')).length).toBeGreaterThan(0);
  });

  it('shows nothing when nothing clashes, and still works if declarations cannot be read', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('403'));
    vi.mocked(detectTimetableClashes).mockReturnValue([]);
    const { container } = render(<TimetableClashes competition={comp} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('ignores a declarations reply that is not a list', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: '<html>' });
    render(<TimetableClashes competition={comp} />);
    expect(await screen.findByRole('region')).toBeInTheDocument();
  });
});
