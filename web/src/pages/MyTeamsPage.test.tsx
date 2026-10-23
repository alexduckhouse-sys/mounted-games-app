import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { competition, heat, race, session, team } from '../test/factories';
import type { CompetitionDetail, Team } from '../types';
import { formatTime, roundTo5Min } from '../lib/time';
import { MyTeamsPage } from './MyTeamsPage';
import { chooseOption, optionLabels } from '../test/select';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
const auth = vi.hoisted(() => ({ roles: [] as string[], clubName: 'Stockport Pony Club' as string | null }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', clubName: auth.clubName }, hasRole: (role: string) => auth.roles.includes(role) }) }));
const notify = vi.hoisted(() => ({ enabled: false, permission: 'default', setEnabled: vi.fn() }));
vi.mock('../hooks/useTeamNotifications', () => ({ useTeamNotifications: () => notify }));

const entries = [{ id: 1, teamId: 1, teamName: 'Example Blue', laneIndex: 4 }];
let detail: CompetitionDetail;
let myTeams: Team[];
let forms: unknown[];

function mount() {
  return render(<MemoryRouter><MyTeamsPage /></MemoryRouter>);
}

beforeEach(() => {
  auth.roles = [];
  auth.clubName = 'Stockport Pony Club';
  Object.assign(notify, { enabled: false, permission: 'default', setEnabled: vi.fn() });
  myTeams = [team(1, { displayName: 'Example Blue', relationship: 'supporter' })];
  forms = [];
  detail = competition();
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/trainer/my-teams') return { data: myTeams };
    if (url === '/declaration-forms') return { data: forms };
    if (url.endsWith('/supporters')) return { data: [] };
    return { data: detail };
  });
});

describe('MyTeamsPage heat rows', () => {
  it('shows the starting lane, and the arena only when there is more than one', async () => {
    detail = competition({ sessions: [session(1, { arenaName: 'Main Arena', heats: [heat(1, { label: 'Heat A', entries })] }), session(2, { arenaName: 'Ring 2' })] });
    const first = mount();
    await waitFor(() => expect(screen.getByText(/lane 4/)).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByText('Seniors · Heat A, lane 4 · Main Arena')).toBeInTheDocument();
    first.unmount();
    detail = competition({ sessions: [session(1, { arenaName: 'Main Arena', heats: [heat(1, { label: 'Heat A', entries })] })] });
    mount();
    await waitFor(() => expect(screen.getByText(/lane 4/)).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.queryByText(/Main Arena/)).not.toBeInTheDocument();
  });

  it('says how late the next heat is running', async () => {
    const at = (h: number, m: number) => new Date(2026, 5, 1, h, m).toISOString();
    detail = competition({ sessions: [session(1, { status: 1, scheduledStart: at(9, 0), startedAt: at(9, 8), heats: [
      heat(1, { startedAt: at(9, 8), races: [race(1, { isComplete: true })] }),
      heat(2, { label: 'Heat B', entries }),
    ] })] });
    mount();
    expect(await screen.findByText(/Heat B, lane 4 · \+8 min/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('On now')).toBeInTheDocument();
  });
});

describe('MyTeamsPage heat times', () => {
  it('counts a break before the heat, so the afternoon heat is not shown too early', async () => {
    const at = (h: number, m: number) => new Date(2026, 5, 1, h, m).toISOString();
    detail = competition({ sessions: [
      session(1, { orderIndex: 1, scheduledStart: at(9, 0), heats: [heat(1, { label: 'Early', durationMinutes: 30, entries, races: [race(1, { isComplete: true })] })] }),
      session(2, { orderIndex: 2, kind: 1, isBreak: true, durationMinutes: 45 }),
      session(3, { orderIndex: 3, heats: [heat(3, { label: 'Afternoon', durationMinutes: 30, entries })] }),
    ] });
    mount();
    const expected = formatTime(roundTo5Min(new Date(2026, 5, 1, 10, 15)));
    const row = await screen.findByText(/Afternoon/, undefined, { timeout: 5000 });
    expect(row.closest('div')?.parentElement).toHaveTextContent(expected);
  });
});

describe('MyTeamsPage layout', () => {
  beforeEach(() => {
    myTeams = [
      team(1, { displayName: 'Stockport A', sectionName: 'Open', relationship: 'trainer', supporterJoinKey: 'STOCKPORT-A' }),
      team(2, { displayName: 'Stockport B', sectionName: 'Junior', relationship: 'trainer', supporterJoinKey: null }),
      team(3, { displayName: 'Cheshire Hunt', sectionName: 'Under 17', relationship: 'supporter' }),
    ];
    forms = [{ id: 1, teamId: 1, riders: [1, 2, 3, 4, 5].map((id) => ({ id, isReserve: false })).concat([{ id: 6, isReserve: true }]) }];
  });

  it('opens the first team, with the others folded to a line each', async () => {
    mount();
    const open = await screen.findByRole('article', { name: 'Stockport A' });
    expect(within(open).getByText('Dec form in')).toBeInTheDocument();
    expect(within(open).getByText(/Open · 5 riders \+ reserve/)).toBeInTheDocument();
    expect(within(open).getByText('STOCKPORT-A')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Stockport B/ })).toHaveTextContent('Dec form due');
    expect(screen.getByRole('button', { name: /Cheshire Hunt/ })).toHaveTextContent('Supporter');
    expect(screen.getByRole('button', { name: /Cheshire Hunt/ })).not.toHaveTextContent('Dec form');
  });

  it('opens another team when tapped and folds the first', async () => {
    mount();
    await screen.findByRole('article', { name: 'Stockport A' });
    await userEvent.click(screen.getByRole('button', { name: /Stockport B/ }));
    expect(screen.getByRole('article', { name: 'Stockport B' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Stockport A' })).not.toBeInTheDocument();
    expect(screen.getByText('Not set')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Hide details for Stockport B' }));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('says so when there are no heats, or all of them are over', async () => {
    mount();
    expect(await screen.findByText('No heats scheduled yet.')).toBeInTheDocument();
  });

  it('copies the code and lets the trainer change it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    vi.mocked(api.put).mockResolvedValue({ data: {} });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Copy join code for Stockport A' }));
    expect(writeText).toHaveBeenCalledWith('STOCKPORT-A');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy join code for Stockport A' })).toHaveTextContent('Copied'));
    await userEvent.click(screen.getByRole('button', { name: /Change/ }));
    const box = screen.getByLabelText('New join code');
    await userEvent.clear(box);
    await userEvent.type(box, 'ab');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('At least 3 characters.');
    await userEvent.clear(box);
    await userEvent.type(box, 'stock-a1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/teams/1/team-code', { code: 'STOCK-A1' }));
    await waitFor(() => expect(screen.queryByLabelText('New join code')).not.toBeInTheDocument());
  });

  it('shows the server’s reason when a code is refused', async () => {
    vi.mocked(api.put).mockRejectedValue({ response: { data: { message: 'That code is taken.' } } });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Change/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is taken.');
  });

  it('can make a random code, turn the code off, and cancel', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Change/ }));
    await userEvent.click(screen.getByRole('button', { name: 'New random code' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/teams/1/supporter-key'));
    await userEvent.click(await screen.findByRole('button', { name: /Change/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Turn code off' }));
    expect(api.delete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Turn code off' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/teams/1/supporter-key'));
    await userEvent.click(await screen.findByRole('button', { name: /Change/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('New join code')).not.toBeInTheDocument();
  });

  it('offers to set a code when the team has none', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Stockport B/ }));
    await userEvent.click(screen.getByRole('button', { name: /Set code/ }));
    expect(screen.getByLabelText('New join code')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn code off' })).not.toBeInTheDocument();
  });

  it('switches heat alerts, and explains when the browser will not allow them', async () => {
    mount();
    await userEvent.click(await screen.findByRole('switch', { name: 'Heat alerts' }));
    expect(notify.setEnabled).toHaveBeenCalledWith(true);
  });

  it.each([
    ['denied', 'Browser permission denied'],
    ['unsupported', 'Not supported in this browser'],
  ])('disables the alerts switch when permission is %s', async (permission, note) => {
    notify.permission = permission;
    mount();
    expect(await screen.findByRole('switch', { name: 'Heat alerts' })).toBeDisabled();
    expect(screen.getByText(note)).toBeInTheDocument();
  });

  it('says when alerts are on', async () => {
    Object.assign(notify, { enabled: true, permission: 'granted' });
    mount();
    expect(await screen.findByText('60 minutes before each heat')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Heat alerts' })).toHaveAttribute('aria-checked', 'true');
  });

  it('lists all the heats under a fold-out', async () => {
    detail = competition({ sessions: [session(1, { arenaName: 'Main', heats: [heat(1, { label: 'Heat A', entries: [{ id: 1, teamId: 1, teamName: 'x', laneIndex: 2 }] }), heat(2, { label: 'Heat B', entries: [{ id: 2, teamId: 1, teamName: 'x', laneIndex: 3 }], races: [race(1, { isComplete: true })] })] }), session(2, { arenaName: 'Ring 2' })] });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /All heats/ }));
    expect(screen.getByText('Lane 3')).toBeInTheDocument();
    expect(screen.getByText('Over')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /All heats/ }));
    expect(screen.queryByText('Lane 3')).not.toBeInTheDocument();
  });

  it('shows who is in the dec form chip for a manager, and the bibs', async () => {
    auth.roles = ['Manager'];
    myTeams = [team(1, { displayName: 'Example Blue', relationship: 'manager', clubId: 7, bibDescription: 'Red bibs' })];
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/trainer/my-teams') return { data: myTeams };
      if (url === '/clubs/7/trainers') return { data: [] };
      if (url === '/admin/trainer-requests' || url.endsWith('/supporters') || url === '/declaration-forms') return { data: [] };
      return { data: detail };
    });
    mount();
    expect(await screen.findByText('Bibs: Red bibs')).toBeInTheDocument();
    expect(screen.getByText('Your club')).toBeInTheDocument();
  });
});

describe('MyTeamsPage joining a team', () => {
  it('opens the join box, joins, and reloads the teams', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { status: 1, teamName: 'Cheshire A' } });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Join a team with a code' }));
    await userEvent.type(screen.getByLabelText('Join key'), 'abcd');
    expect(screen.getByLabelText('Join key')).toHaveValue('ABCD');
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByRole('status')).toHaveTextContent("You're now supporting Cheshire A.");
    expect(api.post).toHaveBeenCalledWith('/teams/join', { key: 'ABCD' });
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/trainer/my-teams').length).toBeGreaterThan(1));
  });

  it('says the trainer needs to accept, and why a join failed', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { status: 0, teamName: 'Cheshire A' } }).mockRejectedValueOnce({}).mockRejectedValueOnce({ response: { data: 'Nope' } });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Join a team with a code' }));
    const box = screen.getByLabelText('Join key');
    await userEvent.type(box, 'one{Enter}');
    expect(await screen.findByText('Request sent for Cheshire A. The trainer needs to accept.')).toBeInTheDocument();
    await userEvent.type(box, 'two');
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not join. Check the key.');
    await userEvent.type(box, 'three');
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Nope'));
  });

  it('explains when nobody has made the person a trainer yet', async () => {
    myTeams = [];
    mount();
    expect(await screen.findByText(/No teams assigned to you yet/)).toBeInTheDocument();
  });
});

describe('MyTeamsPage for a club manager', () => {
  it('lets the manager choose the trainer and describe the bibs, then saves both', async () => {
    auth.roles = ['Manager'];
    detail = competition();
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/trainer/my-teams') return { data: [team(1, { displayName: 'Example Blue', relationship: 'manager', clubId: 7 })] };
      if (url === '/clubs/7/trainers') return { data: [{ userId: 'tr-1', fullName: 'Pat Trainer' }] };
      if (url === '/admin/trainer-requests' || url.endsWith('/supporters') || url === '/declaration-forms') return { data: [] };
      return { data: detail };
    });
    vi.mocked(api.put).mockResolvedValue({ data: {} });
    mount();
    await waitFor(() => expect(optionLabels(screen.getByLabelText('Trainer'))).toContain('Pat Trainer'), { timeout: 5000 });
    chooseOption(screen.getByLabelText('Trainer'), 'tr-1');
    fireEvent.change(screen.getByPlaceholderText('e.g. Red bibs, numbered 1 to 5'), { target: { value: 'Blue bibs 1-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save team details' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/teams/1/trainer', { trainerUserId: 'tr-1', bibDescription: 'Blue bibs 1-5' }));
    expect(await screen.findByText('Saved.', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Your club')).toBeInTheDocument();
  });

  it('says when saving fails', async () => {
    auth.roles = ['Manager'];
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/trainer/my-teams') return { data: [team(1, { displayName: 'Example Blue', relationship: 'manager', clubId: 7 })] };
      if (url === '/clubs/7/trainers') throw new Error('offline');
      if (url === '/admin/trainer-requests' || url.endsWith('/supporters') || url === '/declaration-forms') return { data: [] };
      return { data: detail };
    });
    vi.mocked(api.put).mockRejectedValue(new Error('offline'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Save team details' }));
    expect(await screen.findByText(/Could not save/)).toBeInTheDocument();
  });
});
