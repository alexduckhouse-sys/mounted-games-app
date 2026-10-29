import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import { PassportCheckTab } from './PassportCheckTab';
import { EntrantVaccinationCheck } from './vaccinations/EntrantVaccinationCheck';
import { latestEvidence, type Board, type Evidence, type Pony } from './vaccinations/types';

vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(api.get); const put = vi.mocked(api.put); const post = vi.mocked(api.post);
const evidence = (source = 'entrant', revision = 1): Evidence => ({ id: revision, revision, source, dates: ['2025-06-01', '2025-07-01', '2025-12-01'], completeHistory: true, arrivalOn: '2026-10-20', exceptionReview: false, notes: null, recordedAt: '2026-10-01T09:00:00Z', evaluation: { status: 'DatesMeetRules', referenceOn: '2026-10-20', policyVersionId: 'pc-2026-01-v1', mandatory: [], recommendations: [{ code: 'recommendation', message: 'A recent booster is recommended.', sourceUrl: 'https://example.com/policy', relevantOn: '2026-06-22' }], review: [], nextRelevantOn: '2026-12-01' } });
const pony = (id = 1): Pony => ({ riderEntryId: id, declarationFormId: 10, teamId: 11, teamName: 'Fake team', ponyName: 'Fake pony', revision: 0, horseId: null, identityChanged: false, legacyInspection: false, provisional: null, verified: null, inspection: null, inspectionHistory: [] });
const board = (ponies: Pony[] = [pony()]): Board => ({ enabled: true, settings: { revision: 1, policyVersionId: 'pc-2026-01-v1', referenceDateBasis: 'arrival', venueRules: [], eventStartOn: '2026-10-20' }, policies: [{ id: 'pc-2026-01-v1', organisation: 'Pony Club', edition: 'January 2026', automatic: true, sourceUrl: 'https://example.com/policy', effectiveFrom: '2026-01-01', effectiveUntil: '2026-12-31', verifiedOn: '2026-10-29', mandatory: ['Annual booster required.'], recommended: ['Six months plus 21 days recommended.'] }], ponies });
beforeEach(() => { get.mockReset(); put.mockReset(); post.mockReset(); });

describe('event vaccination board', () => {
  it('keeps same-name declaration rows separate and filters by team', async () => {
    get.mockResolvedValue({ data: board([pony(), { ...pony(2), teamName: 'Other fake team' }]) });
    render(<PassportCheckTab competitionId="12" />);
    expect(await screen.findAllByText('Fake pony')).toHaveLength(2);
    await userEvent.type(screen.getByLabelText('Find a pony or team'), 'Other');
    expect(screen.getAllByText('Fake pony')).toHaveLength(1);
    expect(screen.queryByText('Fake team')).not.toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });
  it('shows recommendations separately and never turns supplied dates into an admission', async () => {
    get.mockResolvedValue({ data: board([{ ...pony(), revision: 1, provisional: evidence() }]) });
    render(<PassportCheckTab competitionId="12" />);
    await userEvent.click(await screen.findByRole('button', { name: /Fake pony/ }));
    expect(screen.getByText(/A recent booster is recommended/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record official decision' })).toBeDisabled();
    expect(screen.getAllByText('Dates meet the selected rules')).toHaveLength(2);
    expect(post).not.toHaveBeenCalled();
  });
  it('records an explicit inspection against the displayed evidence and settings revisions', async () => {
    const current = { ...pony(), revision: 2, verified: evidence('staff', 2) };
    get.mockResolvedValue({ data: board([current]) }); post.mockResolvedValue({ data: { ...current, revision: 3 } });
    render(<PassportCheckTab competitionId="12" />);
    await userEvent.click(await screen.findByRole('button', { name: /Fake pony/ }));
    await userEvent.click(screen.getByRole('switch', { name: 'I have inspected the passport and its vaccination record' }));
    await userEvent.type(screen.getByLabelText('Reason for the decision'), 'Fake official review');
    autoConfirm(true);
    await userEvent.click(screen.getByRole('button', { name: 'Record official decision' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/event-tools/competitions/12/passport-check/vaccinations/riders/1/inspection', expect.objectContaining({ expectedRevision: 2, expectedSettingsRevision: 1, evidenceId: 2, expectedEventStartOn: '2026-10-20', passportInspected: true, decision: 'review' })));
  });
  it('keeps the draft on a conflict and offers an explicit reload', async () => {
    get.mockResolvedValue({ data: board([pony()]) }); put.mockRejectedValue({ response: { data: { detail: 'The entrant changed these dates. Reload.' } } });
    render(<PassportCheckTab competitionId="12" />);
    await userEvent.click(await screen.findByRole('button', { name: /Fake pony/ }));
    fireEvent.change(screen.getByLabelText('Vaccination date 1'), { target: { value: '2026-01-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Record passport dates' }));
    expect(await screen.findByText('The entrant changed these dates. Reload.')).toBeInTheDocument();
    expect(screen.getByLabelText('Vaccination date 1')).toHaveValue('2026-01-01');
    await userEvent.click(screen.getByRole('button', { name: 'Reload latest record' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
  it('marks earlier decisions as stale and does not provide an admission tick', async () => {
    get.mockResolvedValue({ data: board([{ ...pony(), revision: 3, provisional: evidence(), inspection: { id: 1, decision: 'admitted', reason: 'Fake prior reason', inspectedAt: '2026-10-01T09:00:00Z', evidenceId: 1, evidenceRevision: 1, settingsRevision: 0, current: false, inspectedByUserId: 'fake-official' } }]) });
    render(<PassportCheckTab competitionId="12" />);
    await userEvent.click(await screen.findByRole('button', { name: /Fake pony/ }));
    expect(screen.getByText(/A fresh decision is needed/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
describe('entrant vaccination pre-check', () => {
  it('only requests the authorised declaration on demand, and cannot record an official inspection', async () => {
    get.mockResolvedValue({ data: board() }); put.mockResolvedValue({ data: { ...pony(), revision: 1, provisional: evidence() } });
    render(<EntrantVaccinationCheck competitionId={12} riderId={1} />);
    expect(get).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Check vaccination dates' }));
    expect(get).toHaveBeenCalledWith('/event-tools/competitions/12/passport-check/vaccinations/riders/1/mine');
    fireEvent.change(await screen.findByLabelText('Vaccination date 1'), { target: { value: '2026-01-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Check these dates' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/event-tools/competitions/12/passport-check/vaccinations/riders/1/mine', expect.objectContaining({ expectedRevision: 0, dates: ['2026-01-01'], completeHistory: false })));
    expect(screen.queryByText('Official passport inspection')).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
  it('rejects an unauthorised or malformed private response without showing another record', async () => {
    get.mockResolvedValue({ data: '<html>not a record</html>' });
    render(<EntrantVaccinationCheck competitionId={12} riderId={1} />);
    await userEvent.click(screen.getByRole('button', { name: 'Check vaccination dates' }));
    expect(await screen.findByText('The passport check is not available for this declaration.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Vaccination date 1')).not.toBeInTheDocument();
  });
  it('selects the latest evidence without discarding the staff record', () => {
    const current = { ...pony(), provisional: evidence('entrant', 4), verified: evidence('staff', 2) };
    expect(latestEvidence(current)?.source).toBe('entrant'); expect(current.verified?.revision).toBe(2);
  });
});
