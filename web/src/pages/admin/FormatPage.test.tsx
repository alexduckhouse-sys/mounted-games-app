import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { resetRaceTemplates } from '../../lib/raceTemplates';
import { competition, heat, race, session, team } from '../../test/factories';
import type { CompetitionDetail, CompetitionSection } from '../../types';
import { FormatPage } from './FormatPage';

import { autoConfirm } from '../../test/confirm';
vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
const auth = vi.hoisted(() => ({ organise: true }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => auth.organise }) }));

const section = (id: number, extra: Partial<CompetitionSection> = {}): CompetitionSection => ({
  id, competitionId: 5, format: 1, ageGroup: id === 1 ? 'Junior' : 'Open', displayName: id === 1 ? 'Junior pairs' : 'Open pairs',
  runoffRaceName: 'Speed Weave', finalistCount: 6, usesRaceFinals: false, ...extra,
});
const members = (sectionId: number, n: number) => Array.from({ length: n }, (_, i) => team(sectionId * 100 + i, { competitionSectionId: sectionId, displayName: `Pair ${sectionId}-${i}` }));
const start = new Date(2026, 9, 31, 9, 0).toISOString();
const at = (h: number, m = 0) => new Date(2026, 9, 31, h, m);

let comp: CompetitionDetail;
let signups: unknown[];

function build(extra: Partial<CompetitionDetail> = {}): CompetitionDetail {
  return competition({
    id: 5, name: 'Cheshire Halloween Pairs', location: 'Kelsall Hill', startDate: start, signupsLocked: true,
    sections: [section(1), section(2, { usesRaceFinals: true, finalistCount: 4 })],
    teams: [...members(1, 6), ...members(2, 8)],
    sessions: [
      session(10, { competitionSectionId: 1, name: 'Junior pairs', arenaName: 'Main arena', orderIndex: 1, minutesPerHeat: 10, scheduledStart: start, heats: [
        heat(1, { entries: [1, 2, 3].map((n) => ({ id: n, teamId: n, teamName: 'x', laneIndex: n })), races: [race(1, { name: 'Bending' }), race(2, { name: 'Bottle' })] }),
        heat(2, { entries: [4, 5, 6].map((n) => ({ id: n, teamId: n, teamName: 'x', laneIndex: n })), races: [race(3, { name: 'Bending' }), race(4, { name: 'Bottle' })] }),
      ] }),
      session(11, { competitionSectionId: 2, name: 'Open pairs', arenaName: 'Arena 2', orderIndex: 2, minutesPerHeat: 12, plannedRaces: ['Litter', 'Bending', 'Bottle'] }),
      session(12, { kind: 1, isBreak: true, name: 'Lunch', orderIndex: 3, scheduledStart: new Date(2026, 9, 31, 12, 0).toISOString(), durationMinutes: 30, arenaName: null }),
    ],
    ...extra,
  });
}

function mount() {
  return render(<MemoryRouter initialEntries={['/admin/competitions/5/format']}><Routes><Route path="/admin/competitions/:id/format" element={<FormatPage />} /></Routes></MemoryRouter>);
}
const region = (name: string) => screen.findByRole('region', { name });

beforeEach(() => {
  resetRaceTemplates();
  localStorage.clear();
  auth.organise = true;
  comp = build();
  signups = [{ id: 1, competitionSectionId: 1, status: 1 }, { id: 2, competitionSectionId: 1, status: 0 }];
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/competitions/5') return { data: comp } as never;
    if (url === '/competitions/5/signups') return { data: signups } as never;
    if (url === '/race-templates') return { data: [{ id: 1, name: 'Speed Weave', isBuiltIn: true }, { id: 2, name: 'Flag Race', isBuiltIn: true }] } as never;
    return { data: [] } as never;
  });
  vi.mocked(api.put).mockResolvedValue({ data: {} });
  vi.mocked(api.post).mockResolvedValue({ data: {} });
  vi.mocked(api.delete).mockResolvedValue({ data: {} });
});

describe('On the day', () => {
  it('is called On the day, shows the competition and the four steps, and links back to the creator for structure', async () => {
    mount();
    expect(await screen.findByRole('heading', { level: 1, name: 'On the day' })).toBeInTheDocument();
    expect(screen.getByText(/Cheshire Halloween Pairs · .* · Kelsall Hill/)).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'Steps' });
    expect(within(steps).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Close signups'), expect.stringContaining('Form teams'), expect.stringContaining('Race lists'), expect.stringContaining('Timetable')]);
    expect(within(steps).getByText('Timetable').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('link', { name: 'Change the structure' })).toHaveAttribute('href', '/admin/competitions/5');
  });

  it('no longer edits the structure: no sessions to add or remove, no heat, heat, final switch, minutes or finalists', async () => {
    mount();
    await region('Junior pairs');
    for (const name of [/Add a session/, /Remove Junior pairs/, /Heat, heat, final/, /Standard/]) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Minutes per heat|Teams in finals/)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Arena for|Run-off race/ })).not.toBeInTheDocument();
  });

  it('lists each age group’s sessions with their heats, start and race list', async () => {
    mount();
    const junior = await region('Junior pairs');
    expect(within(junior).getByText(/2 heats of 3 · starts/)).toBeInTheDocument();
    expect(within(junior).getByRole('button', { name: /Races for Junior pairs: 2 races/ })).toHaveTextContent('Bending, Bottle');
    const open = await region('Open pairs');
    expect(open).toHaveTextContent('heat, heat, final');
    expect(within(open).getByText(/2 heats of 4 · would start/)).toBeInTheDocument();
    expect(within(open).getByRole('button', { name: /Races for Open pairs: 3 races/ })).toHaveTextContent('Litter, Bending…');
    expect(within(open).getByRole('button', { name: /3 races/ })).not.toHaveTextContent('standard list');
  });

  it('shows the timetable as provisional until every session has heats, with the break where it was put', async () => {
    mount();
    const timetable = await region('Timetable');
    expect(timetable).toHaveTextContent('Provisional');
    const rows = within(within(timetable).getByRole('list', { name: 'Timetable so far' })).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('strong')?.textContent)).toEqual(['Junior pairs', 'Open pairs', 'Lunch']);
    expect(rows[2]).toHaveTextContent('Break · All arenas');
    expect(rows[2]).toHaveTextContent('30 min');
    expect(within(timetable).getByText(/An estimate from the structure and the teams formed so far/)).toBeInTheDocument();
  });

  it('calls the timetable exact once every session has heats', async () => {
    comp = build({ sessions: build().sessions.map((s) => (s.id === 11 ? { ...s, heats: [heat(9, { entries: [{ id: 1, teamId: 1, teamName: 'x', laneIndex: 1 }], races: [race(9, { name: 'Litter' })] })], scheduledStart: start } : s)) });
    mount();
    const timetable = await region('Timetable');
    expect(timetable).toHaveTextContent('Exact');
    expect(within(timetable).queryByText(/An estimate from the structure/)).not.toBeInTheDocument();
  });
});

describe('On the day: hatbands', () => {
  it('shows which hatband goes with which lane when the creator set them, and nothing when it did not', async () => {
    mount();
    await region('Timetable');
    expect(screen.queryByRole('list', { name: 'Hatbands by lane' })).not.toBeInTheDocument();
  });

  it('lists them', async () => {
    comp = build({ laneHatbands: ['Red', 'White', 'Blue'] });
    mount();
    expect((await screen.findAllByRole('listitem')).some((li) => li.textContent === 'Lane 3 · Blue')).toBe(true);
  });
});

describe('On the day: breaks and briefings', () => {
  it('lists them, adds one to the timetable and removes one after asking', async () => {
    mount();
    const breaks = await region('Breaks and briefings');
    expect(breaks).toHaveTextContent('Lunch');
    expect(breaks).toHaveTextContent('30 min');
    const form = within(breaks).getByRole('group', { name: 'Add a break or briefing' });
    await userEvent.selectOptions(within(form).getByLabelText('Type'), 'Briefing');
    await userEvent.type(within(form).getByLabelText('Name'), 'Riders briefing');
    fireEvent.change(within(form).getByLabelText('Starts'), { target: { value: '08:45' } });
    await userEvent.selectOptions(within(form).getByLabelText('Who stops'), 'Arena 2');
    await userEvent.click(within(form).getByRole('button', { name: 'Add to timetable' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/5/sessions', expect.objectContaining({
      competitionSectionId: null, name: 'Riders briefing', arenaName: 'Arena 2', kind: 2, isBreak: false, durationMinutes: 45, orderIndex: 4,
      scheduledStart: new Date(2026, 9, 31, 8, 45).toISOString(),
    })));
    expect(await screen.findByText('Riders briefing added to the timetable.')).toBeInTheDocument();

    const confirm = autoConfirm([false, true]);
    await userEvent.click(within(breaks).getByRole('button', { name: 'Remove Lunch' }));
    expect(api.delete).not.toHaveBeenCalled();
    await userEvent.click(within(breaks).getByRole('button', { name: 'Remove Lunch' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/competitions/5/sessions/12'));
    expect(confirm).toHaveBeenCalledWith('Remove Lunch?');
  });

  it('shows a refusal when adding fails', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { data: { message: 'Not allowed.' } } });
    mount();
    const form = within(await region('Breaks and briefings')).getByRole('group', { name: 'Add a break or briefing' });
    await userEvent.click(within(form).getByRole('button', { name: 'Add to timetable' }));
    expect(await screen.findByText('Not allowed.')).toBeInTheDocument();
  });
});

describe('On the day: race lists', () => {
  it('edits a race list in a dialog and saves it on the session, so it is there until the timetable is generated', async () => {
    mount();
    const junior = await region('Junior pairs');
    await userEvent.click(within(junior).getByRole('button', { name: /Races for Junior pairs/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Races for Junior pairs' });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move Bottle up' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove Bending' }));
    await userEvent.type(within(dialog).getByLabelText('Race name'), 'Litter{Enter}');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Add a race from the library' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Flag Race' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save race list' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/5/sessions/10', { plannedRaces: ['Bottle', 'Litter', 'Flag Race'] }));
    expect(await screen.findByRole('status')).toHaveTextContent('Race list saved for Junior pairs');
    expect(localStorage.length).toBe(0);
  });

  it('starts from a standard list when none was chosen, and cancels without saving', async () => {
    comp = build({ sessions: build().sessions.map((s) => (s.id === 11 ? { ...s, plannedRaces: null } : s)) });
    mount();
    const open = await region('Open pairs');
    expect(within(open).getByRole('button', { name: /3 races|10 races/ })).toHaveTextContent('standard list');
    await userEvent.click(within(open).getByRole('button', { name: /Races for Open pairs/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Races for Open pairs' });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(10);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use Pony Club Area list' }));
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(8);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('does not let the races of a session that has started be changed', async () => {
    comp = build({ sessions: build().sessions.map((s) => (s.id === 10 ? { ...s, status: 1 as const } : s)) });
    mount();
    const junior = await region('Junior pairs');
    expect(within(junior).queryByRole('button', { name: /Races for Junior pairs/ })).not.toBeInTheDocument();
    expect(junior).toHaveTextContent('Started');
  });

  it('shows the reason when a race list cannot be saved', async () => {
    vi.mocked(api.put).mockRejectedValue({ response: { data: { message: 'This session has started.' } } });
    mount();
    const open = await region('Open pairs');
    await userEvent.click(within(open).getByRole('button', { name: /Races for Open pairs/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save race list' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This session has started.');
  });

  it('works out the race list of a heat, heat, final session from its heats', async () => {
    comp = build({ sessions: build().sessions.map((s) => (s.id === 11 ? { ...s, plannedRaces: null, heats: [
      heat(5, { label: 'Litter · Q1', races: [race(5, { name: 'Litter' })] }), heat(6, { label: 'Litter · Q2', races: [race(6, { name: 'Litter' })] }), heat(7, { label: 'Litter · Final', races: [race(7, { name: 'Litter' })] }),
      heat(8, { label: 'Bottle · Q1', races: [race(8, { name: 'Bottle' })] }),
    ] } : s)) });
    mount();
    expect(await screen.findByRole('button', { name: /Races for Open pairs: 2 races/ })).toHaveTextContent('Litter, Bottle');
    expect(screen.getAllByText(/4 heats, qualifiers and finals/).length).toBeGreaterThan(0);
  });
});

describe('On the day: generating the exact timetable', () => {
  it('previews nothing but generates heats from the planned races with a start for each session, after asking', async () => {
    autoConfirm([false, true]);
    mount();
    await region('Open pairs');
    await userEvent.click(screen.getByRole('button', { name: 'Generate timetable' }));
    expect(api.post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Generate timetable' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/5/sessions/10/generate-heats', expect.objectContaining({
      teamIds: members(1, 6).map((t) => t.id), raceNames: ['Bending', 'Bottle'], lanesPerHeat: 4, replaceExisting: true,
    })));
    // The heat, heat, final age group is generated as race finals, from its planned races.
    expect(api.post).toHaveBeenCalledWith('/competitions/5/sessions/11/generate-race-finals', expect.objectContaining({
      teamIds: members(2, 8).map((t) => t.id), raceNames: ['Litter', 'Bending', 'Bottle'], lanesPerHeat: 4, replaceExisting: true,
    }));
    expect(api.put).toHaveBeenCalledWith('/competitions/5/sessions/10', { scheduledStart: expect.any(String) });
    expect(await screen.findByText('Timetable generated for 2 sessions.')).toBeInTheDocument();
  });

  it('leaves breaks and briefings alone and plans the sessions around them', async () => {
    comp = build({ sessions: [
      ...build().sessions.filter((s) => s.id !== 12),
      session(12, { kind: 1, isBreak: true, name: 'Lunch', orderIndex: 3, scheduledStart: at(9).toISOString(), durationMinutes: 45, arenaName: null }),
      session(13, { kind: 2, name: 'Briefing', orderIndex: 4, scheduledStart: at(8, 30).toISOString(), durationMinutes: 15, arenaName: 'Arena 2' }),
    ] });
    autoConfirm(true);
    mount();
    await region('Open pairs');
    await userEvent.click(screen.getByRole('button', { name: 'Generate timetable' }));
    await screen.findByText('Timetable generated for 2 sessions.');
    // Nothing that is a break or briefing is touched.
    expect(api.delete).not.toHaveBeenCalled();
    const touched = [...vi.mocked(api.put).mock.calls, ...vi.mocked(api.post).mock.calls].map(([url]) => String(url));
    expect(touched.some((url) => /sessions\/1[23]/.test(url))).toBe(false);
    // The whole-event lunch (9:00 to 9:45) pushes the first session to 9:45; the Arena 2 briefing ended before 9:00.
    const startOf = (sessionId: number) => new Date((vi.mocked(api.put).mock.calls.find(([url]) => url === `/competitions/5/sessions/${sessionId}`)![1] as { scheduledStart: string }).scheduledStart);
    expect(startOf(10)).toEqual(at(9, 45));
    expect(startOf(11)).toEqual(at(9, 45));
  });

  it('leaves a session that has already started alone, and says so', async () => {
    comp = build({ sessions: build().sessions.map((s) => (s.id === 10 ? { ...s, status: 1 as const } : s)) });
    autoConfirm(true);
    mount();
    await region('Open pairs');
    await userEvent.click(screen.getByRole('button', { name: 'Generate timetable' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/5/sessions/11/generate-race-finals', expect.anything()));
    expect(api.post).not.toHaveBeenCalledWith('/competitions/5/sessions/10/generate-heats', expect.anything());
    expect(await screen.findByText(/1 left alone because they had started/)).toBeInTheDocument();
  });

  it('says why when there is nothing to generate, and shows the server’s reason when generating fails', async () => {
    comp = build({ teams: [] });
    mount();
    await region('Open pairs');
    await userEvent.click(screen.getByRole('button', { name: 'Generate timetable' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('There are no teams to put in heats yet.');
  });

  it('shows the server’s reason when generating fails', async () => {
    autoConfirm(true);
    vi.mocked(api.post).mockRejectedValue({ response: { data: { message: 'Some of those teams aren’t in this competition.' } } });
    mount();
    await region('Open pairs');
    await userEvent.click(screen.getByRole('button', { name: 'Generate timetable' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Some of those teams aren’t in this competition.');
  });
});

describe('On the day: signups and teams', () => {
  it('closes and re-opens signups from the first step', async () => {
    comp = build({ signupsLocked: false });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Close signups now' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/5/signups-locked', { locked: true }));
  });

  it('forms teams from paid signups with a preview first', async () => {
    comp = build({ teams: [] });
    vi.mocked(api.post).mockResolvedValue({ data: { teams: [{ clubName: 'Wirral', suffix: 'A', riderNames: ['Ellie', 'Sam'] }], paidSignups: 2 } });
    mount();
    const panel = await screen.findByRole('region', { name: 'Form teams' });
    const card = within(panel).getByText('Junior pairs').closest('div.mg-card') as HTMLElement;
    expect(card).toHaveTextContent('1 paid signup');
    await userEvent.click(within(card).getByRole('button', { name: 'Preview' }));
    expect(await within(card).findByText(/Preview · 1 team from 2 signups/)).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: /Create teams/ }));
    expect(await within(card).findByText(/Created · 1 team from 2 signups/)).toBeInTheDocument();
    expect(api.post).toHaveBeenLastCalledWith('/competitions/5/sections/1/form-teams', { ridersPerTeam: 2, preview: false, replaceExisting: true });
  });

  it('shows a refusal when someone who does not run the competition opens it', async () => {
    auth.organise = false;
    mount();
    expect(await screen.findByText(/Only admins, the person who runs this competition/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to comp' })).toHaveAttribute('href', '/competitions/5');
  });

  it('says so when the competition will not load', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    mount();
    expect(await screen.findByText('Could not load organiser details. Please try again.')).toBeInTheDocument();
  });
});
