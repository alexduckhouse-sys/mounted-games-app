import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import type { CreatorDraft } from '../../lib/creatorDraft';
import { SaveError, saveCreator } from '../admin/creator/save';
import { SectionsPage } from './SectionsPage';

const reload = vi.fn();
const session = (id: number, sectionId: number, name: string, extra: Record<string, unknown> = {}) => ({
  id, competitionId: 7, competitionSectionId: sectionId, name, arenaName: 'Main arena', kind: 0, isBreak: false, status: 0, orderIndex: id,
  minutesPerHeat: 10, lanesPerHeat: 6, heats: [], plannedRaces: ['Flag', 'Bending'], laneRotationMode: 0, raceOrderAlternating: false, ...extra,
});
const competition = {
  id: 7, name: 'Spring Open', startDate: '2031-05-04T09:00:00.000Z', endDate: null, isActive: true, isArchived: false, laneHatbands: null,
  sections: [
    { id: 11, format: 2, ageGroup: 'Under 12', displayName: 'Under 12', usesRaceFinals: false, tieBreakRule: 0, activeSignupsCount: 0, hasFinal: false },
    { id: 12, format: 1, ageGroup: 'Under 15', displayName: 'Under 15 Pairs', usesRaceFinals: true, tieBreakRule: 2, activeSignupsCount: 0 },
  ],
  teams: [],
  sessions: [session(1, 11, 'Under 12 · Session 1'), session(2, 11, 'Under 12 · Session 2', { plannedRaces: [] }), session(3, 12, 'Under 15 Pairs')],
};
vi.mock('../competition/context', () => ({ useCompetition: () => ({ competition, reload }) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasRole: (role: string) => role === 'Admin' }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../lib/raceTemplates', () => ({ loadRaceTemplates: () => Promise.resolve([{ name: 'Flag' }, { name: 'Bending' }, { name: 'Sack' }]) }));
vi.mock('../admin/creator/save', async (original) => ({ ...(await original<typeof import('../admin/creator/save')>()), saveCreator: vi.fn() }));

function show() {
  return render(<MemoryRouter><SectionsPage /></MemoryRouter>);
}
const lastDraft = () => vi.mocked(saveCreator).mock.calls.at(-1)![0] as CreatorDraft;

describe('SectionsPage', () => {
  beforeEach(() => {
    vi.mocked(saveCreator).mockResolvedValue(7);
    vi.mocked(api.put).mockResolvedValue({ data: {} });
  });

  it('shows each section as a card under its name, with the rows in order and no Save button', async () => {
    show();
    expect(await screen.findByRole('heading', { name: 'Under 12' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Under 15 Pairs' })).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'Under 12' });
    const labels = within(card).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(labels.slice(0, 2)).toEqual(['Format: Standard', 'Arena: Main arena']);
    expect(within(card).getByText('Sessions')).toBeInTheDocument();
    expect(within(card).getByText('Minutes per heat')).toBeInTheDocument();
    expect(within(card).getByText('Scoring extras')).toBeInTheDocument();
    expect(within(card).getByRole('switch', { name: 'Run 2 heats in parallel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Carry points|Double points|Add a final/)).not.toBeInTheDocument();
  });

  it('shows heat, heat, final as a single session with no lane option, parallel switch or final', async () => {
    show();
    const card = await screen.findByRole('region', { name: 'Under 15 Pairs' });
    expect(within(card).getByRole('button', { name: 'Format: Heat, heat, final' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Lane after each race/ })).not.toBeInTheDocument();
    expect(within(card).queryByRole('switch')).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Fewer sessions' })).toBeDisabled();
    expect(within(card).getByRole('button', { name: 'More sessions' })).toBeDisabled();
    // The tie-break is a run-off here, so the run-off race row shows.
    expect(within(card).getByRole('button', { name: 'Run-off race: None' })).toBeInTheDocument();
  });

  it('summarises the races and opens the editor with tabs only when there is more than one session', async () => {
    const user = userEvent.setup();
    show();
    const card = await screen.findByRole('region', { name: 'Under 12' });
    expect(card).toHaveTextContent('Session 1: 2 races');
    expect(card).toHaveTextContent('Session 2: Left for later');
    await user.click(within(card).getByRole('button', { name: 'Edit' }));
    expect(within(card).getByRole('tab', { name: 'Session 1' })).toHaveAttribute('aria-selected', 'true');
    expect(within(card).queryByRole('tab', { name: 'Final' })).not.toBeInTheDocument();

    const pairs = screen.getByRole('region', { name: 'Under 15 Pairs' });
    await user.click(within(pairs).getByRole('button', { name: 'Edit' }));
    expect(within(pairs).queryByRole('tablist')).not.toBeInTheDocument();
    expect(within(pairs).getByRole('button', { name: 'Remove Flag' })).toBeInTheDocument();
  });

  it('edits a race list: add from the library, move, remove, preset and leave for later, saving each time', async () => {
    const user = userEvent.setup();
    show();
    const pairs = await screen.findByRole('region', { name: 'Under 15 Pairs' });
    await user.click(within(pairs).getByRole('button', { name: 'Edit' }));
    await user.click(await within(pairs).findByRole('button', { name: 'Sack' }));
    await waitFor(() => expect(lastDraft().sections[1].sessions[0].races).toEqual(['Flag', 'Bending', 'Sack']));

    await user.click(within(pairs).getByRole('button', { name: 'Move Sack up' }));
    await waitFor(() => expect(lastDraft().sections[1].sessions[0].races).toEqual(['Flag', 'Sack', 'Bending']));
    await user.click(within(pairs).getByRole('button', { name: 'Remove Flag' }));
    await waitFor(() => expect(lastDraft().sections[1].sessions[0].races).toEqual(['Sack', 'Bending']));

    await user.click(within(pairs).getByRole('button', { name: 'Use a preset list' }));
    await user.click(within(pairs).getAllByRole('button', { name: 'Use this' })[0]);
    await waitFor(() => expect(lastDraft().sections[1].sessions[0].races!.length).toBeGreaterThan(3));

    await user.click(within(pairs).getByRole('button', { name: 'Leave for later' }));
    await waitFor(() => expect(lastDraft().sections[1].sessions[0].races).toBeNull());
    expect(pairs).toHaveTextContent('Left for later');
  });

  it('saves taps on the steppers once they stop, and minutes go in fives', async () => {
    const user = userEvent.setup();
    show();
    const card = await screen.findByRole('region', { name: 'Under 12' });
    await user.click(within(card).getByRole('button', { name: 'More minutes per heat' }));
    await user.click(within(card).getByRole('button', { name: 'More minutes per heat' }));
    expect(saveCreator).not.toHaveBeenCalled();
    await waitFor(() => expect(saveCreator).toHaveBeenCalledTimes(1));
    expect(lastDraft().sections[0].minutesPerRace).toBe('20');

    await user.click(within(card).getByRole('button', { name: 'More sessions' }));
    await waitFor(() => expect(saveCreator).toHaveBeenCalledTimes(2));
    expect(lastDraft().sections[0].sessions).toHaveLength(3);
  });

  it('turns a section into heat, heat, final from the Format row', async () => {
    const user = userEvent.setup();
    show();
    const card = await screen.findByRole('region', { name: 'Under 12' });
    await user.click(within(card).getByRole('button', { name: 'Format: Standard' }));
    await user.click(screen.getByRole('option', { name: 'Heat, heat, final' }));
    await waitFor(() => expect(saveCreator).toHaveBeenCalled());
    expect(lastDraft().sections[0].usesRaceFinals).toBe(true);
    expect(lastDraft().sections[0].sessions).toHaveLength(1);
  });

  it('saves the tie-break on the section, and lane and parallel settings on every session', async () => {
    const user = userEvent.setup();
    show();
    const card = await screen.findByRole('region', { name: 'Under 12' });
    await user.click(within(card).getByRole('button', { name: 'Tie-break: Most wins' }));
    await user.click(screen.getByRole('option', { name: 'Last race' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/sections/11', { runoffRaceName: null, tieBreakRule: 1, finalistCount: null }));

    await user.click(within(card).getByRole('switch', { name: 'Run 2 heats in parallel' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/2/settings', { minutesPerHeat: 10, raceOrderAlternating: true, laneRotationMode: 0 }));
    expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/1/settings', expect.objectContaining({ raceOrderAlternating: true }));

    await user.click(within(card).getByRole('button', { name: 'Lane after each race: Move up one lane' }));
    await user.click(screen.getByRole('option', { name: 'Stay in the drawn lane' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/1/settings', expect.objectContaining({ laneRotationMode: 1 })));
  });

  it('adds a section through the save: type, then age group', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Add a section' }));
    const card = screen.getByRole('region', { name: 'New section' });
    await user.click(within(card).getByRole('button', { name: 'Type: Teams' }));
    await user.click(screen.getByRole('option', { name: 'Individual' }));
    await user.click(within(card).getByRole('button', { name: 'Age group: Choose' }));
    await user.click(screen.getByRole('option', { name: 'Under 14' }));

    await waitFor(() => expect(saveCreator).toHaveBeenCalled());
    const added = lastDraft().sections[2];
    expect(added).toMatchObject({ format: 3, ageGroup: 'Under 14' });
    expect(added.existingId).toBeUndefined();
    expect(screen.queryByRole('region', { name: 'New section' })).not.toBeInTheDocument();
  });

  it('takes an age group typed in under Other', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Add a section' }));
    await user.click(screen.getByRole('button', { name: 'Age group: Choose' }));
    await user.click(screen.getByRole('option', { name: 'Other…' }));
    await user.type(screen.getByLabelText('Age group, your own'), 'Veterans');
    await user.click(screen.getByRole('button', { name: 'Use' }));
    await waitFor(() => expect(lastDraft().sections[2].ageGroup).toBe('Veterans'));
  });

  it('can drop a half-made section without saving anything, and removes a saved one after asking', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    show();
    await user.click(await screen.findByRole('button', { name: 'Add a section' }));
    const fresh = screen.getByRole('region', { name: 'New section' });
    await user.click(within(fresh).getByRole('button', { name: 'Remove this section' }));
    expect(screen.queryByRole('region', { name: 'New section' })).not.toBeInTheDocument();
    expect(saveCreator).not.toHaveBeenCalled();

    const card = screen.getByRole('region', { name: 'Under 12' });
    await user.click(within(card).getByRole('button', { name: 'Remove this section' }));
    await waitFor(() => expect(saveCreator).toHaveBeenCalled());
    expect(asked.titles).toEqual(['Remove this section?']);
    expect(lastDraft().sections.map((s) => s.ageGroup)).toEqual(['Under 15']);
  });

  it('shows why a save failed', async () => {
    vi.mocked(saveCreator).mockRejectedValueOnce(new Error('Saving details failed: nope'));
    const user = userEvent.setup();
    show();
    const card = await screen.findByRole('region', { name: 'Under 12' });
    await user.click(within(card).getByRole('button', { name: 'Arena: Main arena' }));
    await user.click(screen.getByRole('option', { name: 'Other…' }));
    await user.type(screen.getByLabelText('Arena, your own'), 'Ring 2');
    await user.click(screen.getByRole('button', { name: 'Use' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Saving details failed: nope');
  });

  describe('the final', () => {
    const extra = { id: 13, format: 3, ageGroup: 'Under 9', displayName: 'Under 9 Individuals', usesRaceFinals: false, tieBreakRule: 0, activeSignupsCount: 0, hasFinal: true, carryPointsIntoFinal: false, doublePointsInFinal: false };
    beforeEach(() => { competition.sections.push(extra as never); });
    afterEach(() => { competition.sections.splice(competition.sections.indexOf(extra as never), 1); });

    it('shows the carry and double switches only once a final exists, and never for heat, heat, final', async () => {
      show();
      const withFinal = await screen.findByRole('region', { name: 'Under 9 Individuals' });
      expect(within(withFinal).getByRole('switch', { name: 'Carry points into the final' })).toHaveAttribute('aria-checked', 'false');
      expect(within(withFinal).getByRole('switch', { name: 'Double points in the final' })).toHaveAttribute('aria-checked', 'false');
      expect(withFinal).toHaveTextContent('Final: Left for later');
      const without = screen.getByRole('region', { name: 'Under 12' });
      expect(within(without).queryByRole('switch', { name: /final/ })).not.toBeInTheDocument();
      const hhf = screen.getByRole('region', { name: 'Under 15 Pairs' });
      expect(within(hhf).queryByRole('switch', { name: /final/ })).not.toBeInTheDocument();
      await userEvent.click(within(hhf).getByRole('button', { name: 'Edit' }));
      expect(within(hhf).queryByRole('button', { name: /Add a final|Remove the final/ })).not.toBeInTheDocument();
    });

    it('saves the switches as they are turned', async () => {
      const user = userEvent.setup();
      show();
      const card = await screen.findByRole('region', { name: 'Under 9 Individuals' });
      await user.click(within(card).getByRole('switch', { name: 'Carry points into the final' }));
      await waitFor(() => expect(saveCreator).toHaveBeenCalled());
      expect(lastDraft().sections.find((x) => x.existingId === 13)).toMatchObject({ carryPointsIntoFinal: true, doublePointsInFinal: false });
      await user.click(within(card).getByRole('switch', { name: 'Double points in the final' }));
      await waitFor(() => expect(lastDraft().sections.find((x) => x.existingId === 13)).toMatchObject({ doublePointsInFinal: true }));
    });

    it('adds a final from the race editor with a bar, and removes it with red text', async () => {
      const user = userEvent.setup();
      show();
      const none = await screen.findByRole('region', { name: 'Under 12' });
      await user.click(within(none).getByRole('button', { name: 'Edit' }));
      const add = within(none).getByRole('button', { name: 'Add a final' });
      expect(add).toHaveClass('ops-addbar');
      await user.click(add);
      await waitFor(() => expect(lastDraft().sections.find((x) => x.existingId === 11)).toMatchObject({ hasFinal: true }));
      expect(within(none).getByRole('tab', { name: 'Final' })).toHaveAttribute('aria-selected', 'true');
      expect(within(none).getByRole('switch', { name: 'Carry points into the final' })).toBeInTheDocument();
      const remove = within(none).getByRole('button', { name: 'Remove the final' });
      expect(remove).toHaveClass('ops-danger-link');
      await user.click(remove);
      await waitFor(() => expect(lastDraft().sections.find((x) => x.existingId === 11)).toMatchObject({ hasFinal: false }));
      expect(within(none).queryByRole('switch', { name: 'Carry points into the final' })).not.toBeInTheDocument();
    });

    it('shows the API’s reason when a final can’t be changed, and shows the saved state again', async () => {
      vi.mocked(saveCreator).mockRejectedValueOnce(new SaveError('Saving Under 9 Individuals failed: Final races have already been scored, so double points can’t be changed.', 7, 409));
      const user = userEvent.setup();
      show();
      const card = await screen.findByRole('region', { name: 'Under 9 Individuals' });
      await user.click(within(card).getByRole('switch', { name: 'Double points in the final' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('double points can’t be changed');
      expect(alert).not.toHaveTextContent('Change something');
      expect(reload).toHaveBeenCalled();
    });
  });
});
