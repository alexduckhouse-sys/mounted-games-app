import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { draftKey, loadDraft } from '../../lib/heatDuties';
import { autoConfirm } from '../../test/confirm';
import { axiosError, competition as makeCompetition, heat, session, team } from '../../test/factories';
import type { CompetitionDetail, VolunteerShift } from '../../types';
import { HeatDutiesPage } from './HeatDutiesPage';

const ctx = vi.hoisted(() => ({ comp: null as unknown as CompetitionDetail, organiser: true }));
vi.mock('../competition/context', () => ({ useCompetition: () => ({ competition: ctx.comp, reload: vi.fn() }) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, canOrganise: () => ctx.organiser }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));

const entry = (teamId: number, lane = 1) => ({ id: teamId * 10 + lane, teamId, teamName: `Team ${teamId}`, laneIndex: lane });
const names = ['A', 'B', 'C', 'D', 'E', 'F'];
const build = (): CompetitionDetail => makeCompetition({
  id: 1, name: 'West Mids Pairs',
  teams: names.map((n, i) => team(i + 1, { displayName: `Team ${n}` })),
  sessions: [
    session(1, { name: 'Morning', arenaName: 'Arena 1', lanesPerHeat: 2, heats: [
      heat(1, { entries: [entry(1), entry(2, 2)] }), heat(2, { entries: [entry(3), entry(4, 2)] }), heat(3, { entries: [entry(5), entry(6, 2)] }),
    ] }),
    session(2, { name: 'Afternoon', lanesPerHeat: 2, heats: [heat(4, { entries: [entry(1), entry(3, 2)] })] }),
    session(3, { name: 'Lunch', isBreak: true, kind: 1, heats: [heat(5)] }),
  ],
});
const shift = (id: number, extra: Partial<VolunteerShift> = {}): VolunteerShift => ({
  id, competitionId: 1, role: 'Referee', requiredCount: 1, claimedCount: 0, remainingCount: 1, isFilled: false, claims: [], heatId: 1, assignedTeamId: null, ...extra,
});

function Landing() {
  const location = useLocation();
  return <p>Volunteers {JSON.stringify(location.state)}</p>;
}
const mount = () => render(
  <MemoryRouter initialEntries={['/competitions/1/operations/heat-duties']}>
    <Routes>
      <Route path="/competitions/1/operations/heat-duties" element={<HeatDutiesPage />} />
      <Route path="/competitions/1/volunteers" element={<Landing />} />
    </Routes>
  </MemoryRouter>,
);
const next = (name: RegExp | string) => userEvent.click(screen.getByRole('button', { name }));
/** Heat titles repeat across sessions, so every lookup is inside the Morning session unless another is named. */
const region = (session = 'Morning · Arena 1') => within(screen.getByRole('region', { name: session }));
const heatBtn = (title: string, session?: string) => region(session).getByRole('button', { name: new RegExp(`^${title}`) });
const heatCard = (title: string, session?: string) => heatBtn(title, session).closest('.hd-heat') as HTMLElement;
async function toHeats() {
  mount();
  await screen.findByText('Each heat needs');
  await next('Next: heats');
}
async function pickTeam(heatName: string, rowName: RegExp, team: RegExp) {
  await userEvent.click(heatBtn(heatName));
  await userEvent.click(within(heatCard(heatName)).getByRole('button', { name: rowName }));
  await userEvent.click(await screen.findByRole('radio', { name: team }));
}

beforeEach(() => {
  ctx.comp = build();
  ctx.organiser = true;
  window.scrollTo = vi.fn() as never;
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  vi.mocked(api.put).mockResolvedValue({ data: { shifts: [], created: 1, updated: 0, deleted: 0 } });
});

describe('the Heat duties page', () => {
  it('says why when it can’t be used', async () => {
    ctx.organiser = false;
    mount();
    expect(await screen.findByText(/Only the organisers/)).toBeInTheDocument();
    ctx.organiser = true;
    ctx.comp = makeCompetition({ id: 1, sessions: [session(1, { isBreak: true, kind: 1 })] });
    mount();
    expect(await screen.findByText(/no heats to give duties to/)).toBeInTheDocument();
  });

  it('offers a retry when the saved duties can’t be loaded', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Each heat needs')).toBeInTheDocument();
  });

  it('starts from the defaults and counts duties and heats, leaving out the break', async () => {
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(await screen.findByText('Each heat needs')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3 · Roles')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to volunteers' })).toHaveAttribute('href', '/competitions/1/volunteers');
    const stats = document.querySelector('.hd-stats')!;
    expect(stats).toHaveTextContent('5duties a heat');
    expect(stats).toHaveTextContent('4heats in 2 sessions');
    expect(screen.getByRole('switch', { name: 'Referee' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Teams in the heat' })).toBeChecked();
  });

  it('changes the roles: switches, steppers, a custom role and the arena party', async () => {
    mount();
    await screen.findByText('Each heat needs');
    await userEvent.click(screen.getByRole('switch', { name: 'Referee' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add one Collecting ring' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add one Changeover stewards' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove one Line stewards' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Teams in the heat' }));
    expect(document.querySelector('.hd-stats')).toHaveTextContent('6duties a heat');
    await userEvent.click(screen.getByRole('button', { name: 'Add a role' }));
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Role name'), 'Water carrier{Enter}');
    expect(screen.getByText('Water carrier')).toBeInTheDocument();
    expect(document.querySelector('.hd-stats')).toHaveTextContent('7duties a heat');
    await userEvent.click(screen.getByRole('button', { name: 'Add a role' }));
    await userEvent.click(within(document.querySelector<HTMLElement>('.hd-addform')!).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Water carrier' }));
    expect(screen.queryByText('Water carrier')).not.toBeInTheDocument();
  });

  it('lists each session’s heats, with the gaps in orange, and opens a heat to show who is riding', async () => {
    await toHeats();
    expect(screen.getByText('Step 2 of 3 · Heat by heat')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Morning · Arena 1' })).toHaveTextContent('3 heats · 15 duties to fill');
    expect(screen.queryByText('Lunch')).not.toBeInTheDocument();
    const one = heatCard('Heat 1');
    expect(one).toHaveTextContent('Nothing set yet');
    await userEvent.click(heatBtn('Heat 1'));
    expect(within(one).getByText('Riding: Team 1, Team 2')).toBeInTheDocument();
    expect(within(one).getAllByText('Choose')).toHaveLength(5);
    expect(within(one).getByText('Lane 2')).toBeInTheDocument();
    await userEvent.click(heatBtn('Heat 1'));
    expect(within(one).queryByText('Riding: Team 1, Team 2')).not.toBeInTheDocument();
  });

  it('summarises what is left with proper plurals, and says nothing is set when nothing is', async () => {
    await toHeats();
    expect(heatCard('Heat 2')).toHaveTextContent('Nothing set yet');
    await pickTeam('Heat 2', /^Referee/, /^Team A/);
    await waitFor(() => expect(heatCard('Heat 2')).toHaveTextContent('Starter, Scorer, 2 line stewards'));
  });

  it('picks a team: fewest duties first, riders and teams already on duty blocked, neighbours warned, Leave empty last', async () => {
    await toHeats();
    await pickTeam('Heat 2', /^Scorer/, /^Team E/);
    await waitFor(() => expect(within(heatCard('Heat 2')).getByText('Team E')).toBeInTheDocument());
    await userEvent.click(within(heatCard('Heat 2')).getByRole('button', { name: /^Referee/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Referee · Heat 2' });
    expect(dialog).toHaveAccessibleDescription('Swipe down to close');
    const radios = within(dialog).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual([
      'Team ARides Heat 10 duties', 'Team BRides Heat 10 duties', 'Team FRides Heat 30 duties',
      'Team CRiding this heat', 'Team DRiding this heat', 'Team EAlready on duty', 'Leave empty',
    ]);
    // Teams riding heat 1 or heat 3 only get a warning.
    expect(within(dialog).getByRole('radio', { name: /Team A/ })).toBeEnabled();
    expect(within(dialog).getByRole('radio', { name: /Team A/ })).toHaveTextContent('Rides Heat 1');
    expect(within(dialog).getByRole('radio', { name: /Team C/ })).toBeDisabled();
    expect(within(dialog).getByRole('radio', { name: /Team C/ })).toHaveTextContent('Riding this heat');
    expect(within(dialog).getByRole('radio', { name: /Team E/ })).toBeDisabled();
    expect(within(dialog).getByRole('radio', { name: /Team E/ })).toHaveTextContent('Already on duty');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Leave empty' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('clears a team with Leave empty, removes a duty from one heat, adds one and copies the roles of the heat before', async () => {
    await toHeats();
    await pickTeam('Heat 2', /^Scorer/, /^Team E/);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(within(heatCard('Heat 2')).getByRole('button', { name: /^Scorer/ }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Leave empty' }));
    await waitFor(() => expect(within(heatCard('Heat 2')).queryByText('Team E')).not.toBeInTheDocument());

    await userEvent.click(within(heatCard('Heat 2')).getByRole('button', { name: /^Starter/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove this duty from Heat 2' }));
    await waitFor(() => expect(within(heatCard('Heat 2')).queryByRole('button', { name: /^Starter/ })).not.toBeInTheDocument());
    expect(within(heatCard('Heat 2')).getByText('Own list of duties')).toBeInTheDocument();

    await userEvent.click(within(heatCard('Heat 2')).getByRole('button', { name: 'Add a duty' }));
    const add = await screen.findByRole('dialog', { name: 'Add a duty to Heat 2' });
    await userEvent.type(within(add).getByPlaceholderText('Job name'), 'Water carrier{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(heatCard('Heat 2')).toHaveTextContent('Water carrier');

    await userEvent.click(within(heatCard('Heat 2')).getByRole('button', { name: 'Add a duty' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Starter' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(within(heatCard('Heat 2')).getByRole('button', { name: 'Same roles as Heat 1' }));
    expect(within(heatCard('Heat 2')).queryByText('Water carrier')).not.toBeInTheDocument();
    expect(within(heatCard('Heat 2')).queryByRole('button', { name: 'Same roles as Heat 1' })).not.toBeInTheDocument();
  });

  describe('Auto', () => {
    const proposal = (teamIds: (number | null)[]) => ({ data: {
      sessionId: 1, unfilledCount: 0, warnings: [], teamDutyCounts: {},
      duties: [1, 2, 3].flatMap((heatId, i) => ['Referee', 'Starter', 'Scorer'].map((role, j) => ({
        sessionId: 1, heatId, heatLabel: `Heat ${heatId}`, role, dutyCategory: 'General', requiredCount: 1, assignedTeamId: teamIds[(i * 3 + j) % teamIds.length],
      }))),
    } });

    it('fills the session from this session’s teams with the rules on, and nothing is saved yet', async () => {
      await toHeats();
      vi.mocked(api.post).mockResolvedValue(proposal([6, 5, 4, 3, 2, 1, 6, 5, 4]));
      await userEvent.click(screen.getByRole('button', { name: 'Fill Morning · Arena 1 automatically' }));
      const sheet = await screen.findByRole('dialog', { name: 'Fill Morning · Arena 1' });
      expect(within(sheet).getByRole('radio', { name: /This session/ })).toBeChecked();
      expect(within(sheet).queryByRole('button', { name: 'Afternoon' })).not.toBeInTheDocument();
      expect(within(sheet).getByRole('switch', { name: 'Only empty duties' })).toBeChecked();
      expect(within(sheet).getByRole('switch', { name: 'Not straight before or after their own heat' })).toBeChecked();
      expect(within(sheet).queryByRole('switch', { name: 'Share duties out evenly' })).not.toBeInTheDocument();
      expect(within(sheet).getByText('Share duties out evenly')).toBeInTheDocument();
      await userEvent.click(within(sheet).getByRole('button', { name: 'Fill 15 duties' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(api.post).toHaveBeenCalledWith('/competitions/1/sessions/1/heat-duties/auto-fill', expect.objectContaining({
        heatIds: [1, 2, 3], keepExisting: true, avoidNeighbouringHeats: true, teamSessionIds: [1],
        roles: [expect.objectContaining({ role: 'Referee' }), expect.objectContaining({ role: 'Starter' }), expect.objectContaining({ role: 'Scorer' }), expect.objectContaining({ role: 'Line steward', laneNumber: 1 }), expect.objectContaining({ role: 'Line steward', laneNumber: 2 })],
      }));
      expect(api.put).not.toHaveBeenCalled();
      await userEvent.click(heatBtn('Heat 1'));
      expect(within(heatCard('Heat 1')).getByText('Team F')).toBeInTheDocument();
      // The proposal only covered three roles, so the two line stewards are still empty, and we say so.
      expect(screen.getByRole('alert')).toHaveTextContent('6 duties couldn’t be filled');
    });

    it('needs a session to be chosen once Other sessions is picked, and sends the chosen ones', async () => {
      await toHeats();
      vi.mocked(api.post).mockResolvedValue({ data: { sessionId: 1, duties: [], unfilledCount: 1, warnings: ['Heat 1: not enough teams.'], teamDutyCounts: {} } });
      await userEvent.click(screen.getByRole('button', { name: 'Fill Morning · Arena 1 automatically' }));
      const sheet = await screen.findByRole('dialog', { name: 'Fill Morning · Arena 1' });
      await userEvent.click(within(sheet).getByRole('radio', { name: /Other sessions/ }));
      expect(within(sheet).getByText('Pick at least one session.')).toBeInTheDocument();
      expect(within(sheet).getByRole('button', { name: 'Fill 15 duties' })).toBeDisabled();
      expect(within(sheet).queryByRole('button', { name: 'Morning' })).not.toBeInTheDocument();
      await userEvent.click(within(sheet).getByRole('button', { name: 'Afternoon' }));
      await userEvent.click(within(sheet).getByRole('switch', { name: 'Only empty duties' }));
      await userEvent.click(within(sheet).getByRole('switch', { name: 'Not straight before or after their own heat' }));
      await userEvent.click(within(sheet).getByRole('button', { name: 'Fill 15 duties' }));
      await waitFor(() => expect(api.post).toHaveBeenCalled());
      expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ teamSessionIds: [2], keepExisting: false, avoidNeighbouringHeats: false });
      expect(await screen.findByText('Heat 1: not enough teams.')).toBeInTheDocument();
    });

    it('tells the organiser when the fill fails and keeps the sheet open', async () => {
      await toHeats();
      vi.mocked(api.post).mockRejectedValue(new Error('offline'));
      await userEvent.click(screen.getByRole('button', { name: 'Fill Morning · Arena 1 automatically' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Fill 15 duties' }));
      expect(await screen.findByText(/Couldn’t fill the duties/)).toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Fill Morning · Arena 1' })).toBeInTheDocument();
      vi.mocked(api.post).mockResolvedValue({ data: { nope: true } });
      await userEvent.click(screen.getByRole('button', { name: 'Fill 15 duties' }));
      expect(await screen.findByText(/Couldn’t fill the duties/)).toBeInTheDocument();
    });

    it('says there is nothing to choose when the event has one session', async () => {
      ctx.comp = makeCompetition({ ...build(), sessions: [build().sessions[0]] });
      await toHeats();
      await userEvent.click(screen.getByRole('button', { name: /Fill Morning · Arena 1 automatically/ }));
      await userEvent.click(await screen.findByRole('radio', { name: /Other sessions/ }));
      expect(screen.getByText('There are no other sessions.')).toBeInTheDocument();
    });
  });

  describe('Check and save', () => {
    async function toCheck() {
      await toHeats();
      await pickTeam('Heat 1', /^Referee/, /^Team C/);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await next('Next: check');
    }

    it('lists what is still empty, then the grid with a team name or “n of N”, and each team’s duties', async () => {
      await toCheck();
      expect(screen.getByText('Step 3 of 3 · Check')).toBeInTheDocument();
      expect(screen.getByText('19')).toBeInTheDocument();
      expect(screen.getByText('duties still empty')).toBeInTheDocument();
      expect(screen.getByText(/Heat 1 starter · Heat 1 scorer/)).toBeInTheDocument();
      expect(screen.getByText('+15 more', { exact: false })).toBeInTheDocument();
      const grids = screen.getAllByRole('table');
      const morning = within(grids[0]);
      expect(morning.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Heat', 'Ref', 'Start', 'Score', 'Lines']);
      const rows = morning.getAllByRole('row');
      expect(within(rows[1]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Team C', 'Empty', 'Empty', '0 of 2']);
      expect(within(rows[1]).getByRole('rowheader')).toHaveTextContent('H1');
      expect(screen.getByRole('region', { name: 'Duties for Morning' })).toBeInTheDocument();
      expect(screen.getByText('fewest 0 · most 1')).toBeInTheDocument();
      expect(within(screen.getByRole('region', { name: 'Duties per team' })).getAllByRole('listitem')).toHaveLength(6);
    });

    it('saves every session, shows a toast on the volunteers page and clears the draft', async () => {
      await toCheck();
      expect(loadDraft(1)).not.toBeNull();
      await next('Save duties');
      expect(await screen.findByText(/Volunteers/)).toHaveTextContent('"dutiesSaved":true');
      expect(api.put).toHaveBeenCalledTimes(1);
      const [url, body] = vi.mocked(api.put).mock.calls[0] as [string, { sessionIds: number[]; duties: Array<Record<string, unknown>> }];
      expect(url).toBe('/competitions/1/heat-duties');
      expect(body.sessionIds).toEqual([1, 2]);
      expect(body.duties).toHaveLength(20);
      expect(body.duties[0]).toEqual({ heatId: 1, role: 'Referee', dutyCategory: 'General', laneNumber: null, assignedTeamId: 3, requiredCount: 1, notes: null });
      expect(body).not.toHaveProperty('confirmRemoveCheckedIn');
      expect(localStorage.getItem(draftKey(1))).toBeNull();
    });

    it('asks before replacing a duty that has been checked in, and resends with the confirmation', async () => {
      const asked = autoConfirm(true);
      vi.mocked(api.put).mockRejectedValueOnce(axiosError({ status: 409, data: { message: 'x', checkedInShifts: [shift(1), shift(2)] } }));
      await toCheck();
      await next('Save duties');
      expect(await screen.findByText(/Volunteers/)).toBeInTheDocument();
      expect(asked.titles).toEqual(['Replace duties that are checked in?']);
      expect(asked).toHaveBeenCalledWith('2 stewards have already checked in. Saving replaces or removes their duties.');
      expect(vi.mocked(api.put).mock.calls[1][1]).toMatchObject({ confirmRemoveCheckedIn: true });
    });

    it('stays put when the organiser says no, and keeps the draft', async () => {
      autoConfirm(false);
      vi.mocked(api.put).mockRejectedValueOnce(axiosError({ status: 409, data: { message: 'x' } }));
      await toCheck();
      await next('Save duties');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Save duties' })).toBeEnabled());
      expect(api.put).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Step 3 of 3 · Check')).toBeInTheDocument();
      expect(loadDraft(1)).not.toBeNull();
    });

    it('shows the server’s reason when saving fails', async () => {
      vi.mocked(api.put).mockRejectedValueOnce(axiosError({ status: 400, data: { message: 'Team A rides in this heat.' } }));
      await toCheck();
      await next('Save duties');
      expect(await screen.findByText('Team A rides in this heat.')).toBeInTheDocument();
      vi.mocked(api.put).mockRejectedValueOnce(new Error('offline'));
      await next('Save duties');
      expect(await screen.findByText(/Couldn’t save the heat duties/)).toBeInTheDocument();
    });

    it('goes back a step, and cancels out of the first', async () => {
      await toCheck();
      await next('Back');
      expect(screen.getByText('Step 2 of 3 · Heat by heat')).toBeInTheDocument();
      await next('Back');
      await next('Cancel');
      expect(await screen.findByText(/Volunteers/)).toBeInTheDocument();
    });

    it('shows a clash in red and a calm line when every duty has a team', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: [
        shift(1, { heatId: 1, role: 'Referee', assignedTeamId: 1 }), shift(2, { heatId: 1, role: 'Starter', assignedTeamId: 5 }), shift(3, { heatId: 1, role: 'Scorer', assignedTeamId: 5 }),
      ] });
      mount();
      await screen.findByText('Each heat needs');
      expect(screen.getByRole('switch', { name: 'Referee' })).toBeChecked();
      await next('Next: heats');
      await next('Next: check');
      const clashes = screen.getByRole('list', { name: 'Clashes' });
      expect(clashes).toHaveTextContent('Heat 1: Team A is on duty in a heat it rides');
      expect(clashes).toHaveTextContent('Heat 1: Team E is on 2 duties');
    });
  });

  it('keeps a draft and picks up where the organiser left off', async () => {
    await toHeats();
    await pickTeam('Heat 2', /^Scorer/, /^Team E/);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(loadDraft(1)).toMatchObject({ step: 1 });
    expect(loadDraft(1)!.overridden).toEqual([]);
    document.body.innerHTML = '';
    mount();
    expect(await screen.findByText('Step 2 of 3 · Heat by heat')).toBeInTheDocument();
    await userEvent.click(heatBtn('Heat 2'));
    expect(within(heatCard('Heat 2')).getByText('Team E')).toBeInTheDocument();
  });

  it('opening the page without changing anything leaves no draft', async () => {
    mount();
    await screen.findByText('Each heat needs');
    expect(localStorage.getItem(draftKey(1))).toBeNull();
  });

  it('starts from the duties already saved, and sends their ids back so nothing is added twice', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [
      shift(11, { heatId: 1, role: 'Referee', assignedTeamId: 6 }),
      shift(12, { heatId: 1, role: 'Water carrier', assignedTeamId: 4 }),
      shift(13, { heatId: 2, role: 'Referee' }),
      shift(99, { heatId: null }),
    ] });
    mount();
    await screen.findByText('Each heat needs');
    expect(screen.getByRole('switch', { name: 'Starter' })).not.toBeChecked();
    expect(screen.getByText('Water carrier')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove one Line stewards' })).toBeDisabled();
    await next('Next: heats');
    await userEvent.click(heatBtn('Heat 1'));
    expect(within(heatCard('Heat 1')).getByText('Team F')).toBeInTheDocument();
    await next('Next: check');
    await next('Save duties');
    await screen.findByText(/Volunteers/);
    const body = vi.mocked(api.put).mock.calls[0][1] as { duties: Array<{ id?: number; heatId: number; role: string }> };
    expect(body.duties.filter((d) => d.id !== undefined).map((d) => [d.id, d.heatId, d.role])).toEqual([[11, 1, 'Referee'], [12, 1, 'Water carrier'], [13, 2, 'Referee']]);
    expect(body.duties.filter((d) => d.id === undefined && d.heatId === 1)).toHaveLength(0);
  });
});
