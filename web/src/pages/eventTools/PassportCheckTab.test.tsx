import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { PassportCheckBoard } from '../../types';
import { PassportCheckTab } from './PassportCheckTab';

vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn() } }));

const get = vi.mocked(api.get);
const put = vi.mocked(api.put);

const on = (): PassportCheckBoard => ({
  enabled: true, checked: 1, total: 3,
  sections: [{
    sectionId: 5, sectionName: 'Under 12', teams: [
      { teamId: 1, teamName: 'Oak A', clubName: 'Oak', withdrawn: false, isHorsConcours: false, hasDeclaration: true, ponies: [
        { ponyName: 'Bramble', riders: ['Amy Archer'], checkedAt: null, checkedByName: null },
        { ponyName: 'Pepper', riders: ['Ben Brook'], checkedAt: '2031-05-04T08:15:00Z', checkedByName: 'Sue Steward' },
      ] },
      // Same pony name, another team: a separate pony, never flagged.
      { teamId: 2, teamName: 'Ash A', clubName: 'Ash', withdrawn: true, isHorsConcours: false, hasDeclaration: true, ponies: [
        { ponyName: 'Bramble', riders: ['Eve Ely'], checkedAt: null, checkedByName: null },
      ] },
      { teamId: 3, teamName: 'Elm A', clubName: 'Elm', withdrawn: false, isHorsConcours: false, hasDeclaration: false, ponies: [] },
      { teamId: 4, teamName: 'Yew A', clubName: 'Yew', withdrawn: false, isHorsConcours: false, hasDeclaration: true, ponies: [] },
    ],
  }],
});

beforeEach(() => { get.mockReset(); put.mockReset(); });

describe('passport check tab', () => {
  it('is off until turned on, and turning it on loads the ponies', async () => {
    get.mockResolvedValueOnce({ data: { enabled: false, checked: 0, total: 0, sections: [] } });
    put.mockResolvedValueOnce({ data: on() });
    render(<PassportCheckTab competitionId="12" />);

    const toggle = await screen.findByLabelText('Check passports at this event');
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(/Turn this on to tick off ponies/)).toBeInTheDocument();
    await userEvent.click(toggle);

    await waitFor(() => expect(put).toHaveBeenCalledWith('/event-tools/competitions/12/passport-check/settings', { enabled: true }));
    expect(await screen.findByText('No declaration yet, so no ponies to check.')).toBeInTheDocument();
    expect(screen.queryByText(/ponies checked/)).not.toBeInTheDocument();
    expect(screen.getByText('The declaration has no pony names.')).toBeInTheDocument();
    expect(screen.getByText(/checked \d\d:\d\d by Sue Steward/)).toBeInTheDocument();
    expect(screen.getByText('Ash (withdrawn)')).toBeInTheDocument();
  });

  it('ticks one team’s pony without touching a same-named pony in another team', async () => {
    get.mockResolvedValueOnce({ data: on() });
    put.mockResolvedValueOnce({ data: { ponyName: 'Bramble', riders: ['Amy Archer'], checkedAt: '2031-05-04T09:00:00Z', checkedByName: null } });
    render(<PassportCheckTab competitionId="12" />);

    const brambles = await screen.findAllByLabelText(/^Bramble/);
    expect(brambles).toHaveLength(2);
    await userEvent.click(brambles[0]);

    await waitFor(() => expect(put).toHaveBeenCalledWith('/event-tools/competitions/12/passport-check/teams/1', { ponyName: 'Bramble', checked: true }));
    await waitFor(() => expect(screen.getAllByLabelText(/^Bramble/)[0]).toBeChecked());
    const after = screen.getAllByLabelText(/^Bramble/);
    expect(after[0]).toBeChecked();
    expect(after[1]).not.toBeChecked();
  });

  it('filters by team or pony and reports a failed tick or toggle', async () => {
    get.mockResolvedValueOnce({ data: on() });
    put.mockRejectedValueOnce({ response: { data: { detail: 'The passport check is turned off for this competition.' } } })
      .mockRejectedValueOnce(new Error('offline'));
    render(<PassportCheckTab competitionId="12" />);

    await userEvent.type(await screen.findByLabelText('Find a team or pony'), 'pepper');
    expect(screen.queryByText('Ash A')).not.toBeInTheDocument();
    expect(screen.getByText('Oak A')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Find a team or pony'));
    await userEvent.type(screen.getByLabelText('Find a team or pony'), 'zzz');
    expect(screen.queryByText('Oak A')).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Find a team or pony'));

    await userEvent.click(screen.getByLabelText(/^Pepper/));
    expect(await screen.findByRole('alert')).toHaveTextContent('The passport check is turned off for this competition.');
    await userEvent.click(screen.getByLabelText('Check passports at this event'));
    expect(await screen.findByText(/Couldn’t change the passport check\./)).toBeInTheDocument();
  });

  it('offers a retry when the board does not load, and says when nothing is declared', async () => {
    get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { enabled: true, checked: 0, total: 0, sections: [] } });
    render(<PassportCheckTab competitionId="12" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the passport check.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No ponies have been declared yet.')).toBeInTheDocument();
    expect(screen.getByLabelText('Find a team or pony')).toBeInTheDocument();
  });

  it('saves a vet or official inspection, searches by passport or owner, and shows vaccine expired status', async () => {
    get.mockResolvedValueOnce({ data: on() });
    put.mockResolvedValueOnce({
      data: {
        ponyName: 'Bramble',
        riders: ['Amy Archer'],
        checkedAt: null,
        checkedByName: 'Dr Sarah Jones',
        passportCode: 'GBR-826001234',
        ownerFullName: 'Sarah Clarke',
        certified: false,
        status: 'Expired',
        lastFluVaccineDate: '2029-01-10',
        fluValidUntil: '2030-01-10',
        lastTetanusDate: '2029-01-10',
        tetanusValidUntil: '2031-01-10',
        inspectorRole: 'Vet',
        officialNotes: 'Booster overdue',
      },
    });
    render(<PassportCheckTab competitionId="12" />);

    const inspectButtons = await screen.findAllByRole('button', { name: 'Vet / Official inspection' });
    await userEvent.click(inspectButtons[0]);

    await userEvent.type(screen.getByLabelText('Passport code'), 'GBR-826001234');
    await userEvent.type(screen.getByLabelText('Owner full name'), 'Sarah Clarke');
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'Vet');
    await userEvent.type(screen.getByLabelText('What the vet / official said'), 'Booster overdue');
    await userEvent.click(screen.getByRole('button', { name: 'Save & certify' }));

    await waitFor(() => expect(put).toHaveBeenCalledWith(
      '/event-tools/competitions/12/passport-check/teams/1',
      expect.objectContaining({
        ponyName: 'Bramble',
        checked: true,
        passportCode: 'GBR-826001234',
        ownerFullName: 'Sarah Clarke',
        inspectorRole: 'Vet',
        officialNotes: 'Booster overdue',
      }),
    ));
    expect(await screen.findByText('Vaccine expired')).toBeInTheDocument();
    expect(screen.getByText(/Passport: GBR-826001234 · Owner: Sarah Clarke/)).toBeInTheDocument();
    expect(screen.getByText(/Vet Dr Sarah Jones: “Booster overdue”/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Find a team or pony'), 'sarah clarke');
    expect(screen.getByText('Oak A')).toBeInTheDocument();
    expect(screen.queryByText('Ash A')).not.toBeInTheDocument();
  });
});
