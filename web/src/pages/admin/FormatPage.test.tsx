import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { resetRaceTemplates } from '../../lib/raceTemplates';
import { competition, heat, race, session, team } from '../../test/factories';
import type { CompetitionDetail, CompetitionSection } from '../../types';
import { FormatPage } from './FormatPage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
const auth = vi.hoisted(() => ({ organise: true }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => auth.organise }) }));

const section = (id: number, extra: Partial<CompetitionSection> = {}): CompetitionSection => ({
  id, competitionId: 5, format: 1, ageGroup: id === 1 ? 'Junior' : 'Open', displayName: id === 1 ? 'Junior pairs' : 'Open pairs',
  runoffRaceName: 'Speed Weave', finalistCount: 6, usesRaceFinals: false, ...extra,
});
const members = (sectionId: number, n: number) => Array.from({ length: n }, (_, i) => team(sectionId * 100 + i, { competitionSectionId: sectionId, displayName: `Pair ${sectionId}-${i}` }));
const start = new Date(2026, 9, 31, 9, 0).toISOString();

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
      session(11, { competitionSectionId: 2, name: 'Open pairs', arenaName: 'Arena 2', orderIndex: 2, minutesPerHeat: 12 }),
      session(12, { kind: 1, isBreak: true, name: 'Lunch', orderIndex: 3, scheduledStart: new Date(2026, 9, 31, 12, 0).toISOString(), durationMinutes: 30, arenaName: null }),
    ],
    ...extra,
  });
}

function mount() {
  return render(<MemoryRouter initialEntries={['/admin/competitions/5/format']}><Routes><Route path="/admin/competitions/:id/format" element={<FormatPage />} /></Routes></MemoryRouter>);
}
const sectionRegion = (name: string) => screen.findByRole('region', { name });

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

describe('FormatPage', () => {
  it('shows the competition, the four steps and each age group with its settings and sessions', async () => {
    mount();
    expect(await screen.findByRole('heading', { level: 1, name: 'Format' })).toBeInTheDocument();
    expect(screen.getByText(/Cheshire Halloween Pairs · .* · Kelsall Hill/)).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'Steps' });
    expect(within(steps).getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('Close signups'), expect.stringContaining('Form teams'), expect.stringContaining('Sessions'), expect.stringContaining('Ready to run')]);
    expect(within(steps).getByText('Sessions').closest('li')).toHaveAttribute('aria-current', 'step');
    const junior = await sectionRegion('Junior pairs');
    expect(within(junior).getByText('6 pairs')).toBeInTheDocument();
    expect(within(junior).getByRole('radio', { name: 'Standard' })).toHaveAttribute('aria-checked', 'true');
    expect(within(junior).getByRole('radio', { name: 'Heat, heat, final' })).toHaveAttribute('aria-checked', 'false');
    expect(within(junior).getByLabelText('Teams in finals')).toHaveValue('6');
    expect(within(junior).getByLabelText(/Minutes per heat/)).toHaveValue('10');
    expect(within(junior).getByText(/2 heats of 3 · starts/)).toBeInTheDocument();
    expect(within(junior).getByRole('button', { name: /Races for Junior pairs: 2 races/ })).toHaveTextContent('Bending, Bottle');
    const open = await sectionRegion('Open pairs');
    expect(within(open).getByText(/2 heats of 4 · would start/)).toBeInTheDocument();
    expect(within(open).getByText('Final')).toBeInTheDocument();
    expect(within(open).getByRole('radio', { name: 'Heat, heat, final' })).toHaveAttribute('aria-checked', 'true');
  });

  it('lists breaks and briefings, and links to the timetable to add one', async () => {
    mount();
    const breaks = await sectionRegion('Breaks and briefings');
    expect(breaks).toHaveTextContent('Lunch');
    expect(breaks).toHaveTextContent('30 min');
    expect(within(breaks).getByRole('link', { name: /Add a break or briefing/ })).toHaveAttribute('href', '/competitions/5');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(within(breaks).getByRole('button', { name: 'Remove Lunch' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/competitions/5/sessions/12'));
  });

  it('switches an age group to heat, heat, final, and saves the run-off race and teams in finals', async () => {
    mount();
    const junior = await sectionRegion('Junior pairs');
    await userEvent.click(within(junior).getByRole('radio', { name: 'Heat, heat, final' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/5/sections/1', { runoffRaceName: 'Speed Weave', usesRaceFinals: true, finalistCount: 6 }));
    await userEvent.click(within(junior).getByRole('combobox', { name: 'Run-off race for Junior pairs' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Flag Race' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/5/sections/1', expect.objectContaining({ runoffRaceName: 'Flag Race' })));
    const box = within(junior).getByLabelText('Teams in finals');
    await userEvent.clear(box);
    await userEvent.type(box, '8');
    await userEvent.tab();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/5/sections/1', expect.objectContaining({ finalistCount: 8 })));
    await userEvent.clear(box);
    await userEvent.tab();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/5/sections/1', expect.objectContaining({ finalistCount: null })));
  });

  it('refuses a teams in finals value that is not a number from 1 to 50', async () => {
    mount();
    const box = (await sectionRegion('Junior pairs')).querySelector('input[inputmode="numeric"]') as HTMLInputElement;
    await userEvent.clear(box);
    await userEvent.type(box, '99');
    await userEvent.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Teams in finals must be a number from 1 to 50.');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('writes minutes per heat onto every session of the age group', async () => {
    mount();
    const junior = await sectionRegion('Junior pairs');
    const box = within(junior).getByLabelText(/Minutes per heat/);
    await userEvent.clear(box);
    await userEvent.type(box, '14');
    await userEvent.tab();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/5/sessions/10/settings', { minutesPerHeat: 14 }));
    expect(api.put).not.toHaveBeenCalledWith('/competitions/5/sessions/11/settings', expect.anything());
    await userEvent.clear(box);
    await userEvent.type(box, '0');
    await userEvent.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Minutes per heat must be a number from 1 to 180.');
  });

  it('adds a session with the next name and the minutes of its age group', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 20 } });
    mount();
    const junior = await sectionRegion('Junior pairs');
    await userEvent.click(within(junior).getByRole('button', { name: 'Add a session' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/5/sessions', expect.objectContaining({
      competitionSectionId: 1, name: 'Junior pairs · Session 2', arenaName: 'Main arena', kind: 0, orderIndex: 4,
    })));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/5/sessions/20/settings', { minutesPerHeat: 10 }));
  });

  it('allows only one session for heat, heat, final', async () => {
    mount();
    const open = await sectionRegion('Open pairs');
    expect(within(open).getByRole('button', { name: 'Add a session' })).toBeDisabled();
  });

  it('renames a session and moves it to another arena', async () => {
    mount();
    const junior = await sectionRegion('Junior pairs');
    const name = within(junior).getByLabelText('Name of Junior pairs');
    await userEvent.clear(name);
    await userEvent.type(name, 'Junior pairs · Morning');
    await userEvent.tab();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/5/sessions/10', { name: 'Junior pairs · Morning' }));
    await userEvent.click(within(junior).getByRole('combobox', { name: 'Arena for Junior pairs' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Arena 2' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/5/sessions/10', { arenaName: 'Arena 2' }));
  });

  it('puts a blank or unchanged name back as it was', async () => {
    mount();
    const junior = await sectionRegion('Junior pairs');
    const name = within(junior).getByLabelText('Name of Junior pairs');
    await userEvent.clear(name);
    await userEvent.tab();
    expect(name).toHaveValue('Junior pairs');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('removes a session after asking, and forgets its race list', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    mount();
    const junior = await sectionRegion('Junior pairs');
    await userEvent.click(within(junior).getByRole('button', { name: 'Remove Junior pairs' }));
    expect(api.delete).not.toHaveBeenCalled();
    await userEvent.click(within(junior).getByRole('button', { name: 'Remove Junior pairs' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/competitions/5/sessions/10'));
    expect(confirm).toHaveBeenLastCalledWith('Remove Junior pairs and its 2 heats?');
  });

  it('edits a race list in a dialog and keeps it until the timetable is generated', async () => {
    mount();
    const junior = await sectionRegion('Junior pairs');
    await userEvent.click(within(junior).getByRole('button', { name: /Races for Junior pairs/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Races for Junior pairs' });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move Bottle up' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove Bending' }));
    await userEvent.type(within(dialog).getByLabelText('Race name'), 'Litter{Enter}');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Add a race from the library' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Flag Race' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save race list' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Race list saved for Junior pairs');
    expect(within(junior).getByRole('button', { name: /Races for Junior pairs: 3 races/ })).toHaveTextContent('Bottle, Litter…');
    expect(within(junior).getByRole('button', { name: /3 races/ })).toHaveTextContent('not generated yet');
    expect(JSON.parse(localStorage.getItem('mg.format.races.v1.5')!)).toEqual({ 10: ['Bottle', 'Litter', 'Flag Race'] });
  });

  it('starts a race list from a standard list, and cancels without saving', async () => {
    mount();
    const open = await sectionRegion('Open pairs');
    await userEvent.click(within(open).getByRole('button', { name: /Races for Open pairs/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Races for Open pairs' });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(10);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use Pony Club Area list' }));
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(8);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem('mg.format.races.v1.5')).toBeNull();
  });

  it('previews start times without saving anything', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Preview timetable' }));
    const preview = screen.getByRole('region', { name: 'Timetable preview' });
    expect(within(preview).getAllByRole('listitem')).toHaveLength(2);
    expect(preview).toHaveTextContent('Open pairs');
    expect(preview).toHaveTextContent('2 heats of 4');
    expect(api.post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Preview timetable' }));
    expect(screen.queryByRole('region', { name: 'Timetable preview' })).not.toBeInTheDocument();
  });

  it('generates heats with the chosen races and a planned start for each session, after asking', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    mount();
    await screen.findByRole('region', { name: 'Open pairs' });
    await userEvent.click(screen.getByRole('button', { name: 'Generate timetable' }));
    expect(api.post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Generate timetable' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/5/sessions/11/generate-heats', expect.objectContaining({
      teamIds: members(2, 8).map((t) => t.id), lanesPerHeat: 4, replaceExisting: true,
    })));
    expect(api.post).toHaveBeenCalledWith('/competitions/5/sessions/10/generate-heats', expect.objectContaining({ raceNames: ['Bending', 'Bottle'], teamIds: members(1, 6).map((t) => t.id) }));
    expect(api.put).toHaveBeenCalledWith('/competitions/5/sessions/10', { scheduledStart: expect.any(String) });
    expect(await screen.findByText('Timetable generated for 2 sessions.')).toBeInTheDocument();
  });

  it('leaves a session that has already started alone, and says so', async () => {
    comp = build({ sessions: build().sessions.map((s) => (s.id === 10 ? { ...s, status: 1 as const } : s)) });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    await screen.findByRole('region', { name: 'Open pairs' });
    await userEvent.click(screen.getByRole('button', { name: 'Generate timetable' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/5/sessions/11/generate-heats', expect.anything()));
    expect(api.post).not.toHaveBeenCalledWith('/competitions/5/sessions/10/generate-heats', expect.anything());
    expect(await screen.findByText(/1 left alone because they had started/)).toBeInTheDocument();
  });

  it('says why when there is nothing to generate, and when generating fails', async () => {
    comp = build({ teams: [] });
    mount();
    await screen.findByRole('region', { name: 'Open pairs' });
    await userEvent.click(screen.getByRole('button', { name: 'Generate timetable' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('There are no teams to put in heats yet.');
  });

  it('shows the server’s reason when generating fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.post).mockRejectedValue({ response: { data: { message: 'Some of those teams aren’t in this competition.' } } });
    mount();
    await screen.findByRole('region', { name: 'Open pairs' });
    await userEvent.click(screen.getByRole('button', { name: 'Generate timetable' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Some of those teams aren’t in this competition.');
  });

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
