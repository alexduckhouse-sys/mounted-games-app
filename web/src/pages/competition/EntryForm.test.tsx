import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition } from '../../test/factories';
import type { CompetitionSection, UserProfile } from '../../types';
import { EntryForm } from './EntryForm';
import { entryDraftKey, readEntryDraft } from './entryDraft';

const state = vi.hoisted(() => ({ user: null as UserProfile | null }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: state.user, hasRole: () => true, canOrganise: () => false }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const person: UserProfile = { id: 'example-a', fullName: 'Example Adult', email: 'adult@example.test', clubName: 'Fictional Club', clubId: 7, roles: ['Member'] };
const section: CompetitionSection = { id: 5, competitionId: 1, format: 2, ageGroup: 'Open', displayName: 'Open', priceMinor: 0 };
const key = entryDraftKey(person.id, 1, 5, 'standard');
const onSent = vi.fn();
const view = (overrides: Partial<Parameters<typeof EntryForm>[0]> = {}) => <MemoryRouter><EntryForm competition={competition({ id: 1 })} section={section} kind="standard" step="details" onSent={onSent} {...overrides} /></MemoryRouter>;
const agree = () => userEvent.click(screen.getByRole('checkbox', { name: 'I agree' }));
const submit = () => userEvent.click(screen.getByRole('button', { name: 'Submit' }));

beforeEach(() => {
  state.user = { ...person };
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  vi.mocked(api.post).mockResolvedValue({ data: { id: 9, status: 1, amountMinor: 0 } });
});

describe('entry form convenience and isolation', () => {
  it('prefills known details once and lets an adult enter for someone else without profile refresh replacing typing', async () => {
    const mounted = render(view());
    expect(screen.getByLabelText('Your name')).toHaveValue('Example Adult');
    expect(screen.getByLabelText('Club (optional)')).toHaveValue('Fictional Club');
    expect(screen.getByLabelText('Your email (optional)')).toHaveValue('adult@example.test');
    expect(screen.getByRole('checkbox', { name: 'I agree' })).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Example Rider' } });
    fireEvent.change(screen.getByLabelText('Club (optional)'), { target: { value: 'Example Riding Club' } });
    state.user = { ...person, fullName: 'Refreshed Example', clubName: 'Refreshed Club' };
    mounted.rerender(view());
    expect(screen.getByLabelText('Your name')).toHaveValue('Example Rider');
    await agree();
    await submit();
    expect(api.post).toHaveBeenCalledWith('/competitions/1/sections/5/signups', expect.objectContaining({ fullName: 'Example Rider', ponyClubName: 'Example Riding Club', contactEmail: 'adult@example.test' }));
  });

  it.each(['example@mg.local', 'example@username.mg.local', 'not-an-email'])('does not prefill a placeholder address: %s', (email) => {
    state.user = { ...person, email };
    render(view());
    expect(screen.getByLabelText('Your email (optional)')).toHaveValue('');
  });

  it('restores all unfinished details after remount but requires fresh consent and email opt-in', async () => {
    const mounted = render(view());
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Example Entrant' } });
    fireEvent.change(screen.getByLabelText('Mobile (optional)'), { target: { value: '07700 900123' } });
    fireEvent.change(screen.getByLabelText('Team name (optional)'), { target: { value: 'Example Team' } });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Enter a whole team' }));
    fireEvent.change(screen.getByLabelText('Number of teams'), { target: { value: '2' } });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Looking for guest riders' }));
    await userEvent.click(screen.getByRole('button', { name: 'One more stable' }));
    fireEvent.change(screen.getByLabelText('Stabling club or team'), { target: { value: 'Example Stable Team' } });
    await agree();
    await userEvent.click(screen.getByLabelText(/Email me when/));
    const requestId = readEntryDraft(key)?.requestId;
    mounted.unmount();
    render(view());
    expect(screen.getByLabelText('Your name')).toHaveValue('Example Entrant');
    expect(screen.getByLabelText('Mobile (optional)')).toHaveValue('07700 900123');
    expect(screen.getByLabelText('Team name')).toHaveValue('Example Team');
    expect(screen.getByLabelText('Number of teams')).toHaveValue(2);
    expect(screen.getByRole('checkbox', { name: 'Looking for guest riders' })).toBeChecked();
    expect(screen.getByLabelText('Stabling club or team')).toHaveValue('Example Stable Team');
    expect(screen.getByRole('checkbox', { name: 'I agree' })).not.toBeChecked();
    expect(screen.getByLabelText(/Email me when/)).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    expect(readEntryDraft(key)?.requestId).toBe(requestId);
  });

  it('keeps deliberately cleared prefills empty when reopened', () => {
    const mounted = render(view());
    for (const label of ['Your name', 'Club (optional)', 'Your email (optional)']) fireEvent.change(screen.getByLabelText(label), { target: { value: '' } });
    mounted.unmount();
    render(view());
    for (const label of ['Your name', 'Club (optional)', 'Your email (optional)']) expect(screen.getByLabelText(label)).toHaveValue('');
  });

  it('separates accounts, events, sections and entry types while the component stays mounted', () => {
    const mounted = render(view());
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Private Example Draft' } });
    state.user = { ...person, id: 'example-b', fullName: 'Other Example' };
    mounted.rerender(view());
    expect(screen.getByLabelText('Your name')).toHaveValue('Other Example');
    state.user = person;
    mounted.rerender(view({ competition: competition({ id: 2 }) }));
    expect(screen.getByLabelText('Your name')).toHaveValue('Example Adult');
    mounted.rerender(view({ section: { ...section, id: 6 } }));
    expect(screen.getByLabelText('Your name')).toHaveValue('Example Adult');
    mounted.rerender(view({ kind: 'guest' }));
    expect(screen.getByLabelText('Your name')).toHaveValue('Example Adult');
    mounted.rerender(view());
    expect(screen.getByLabelText('Your name')).toHaveValue('Private Example Draft');
    state.user = null;
    mounted.rerender(view());
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
  });

  it('reuses the request id after an uncertain submission and reload, then clears the confirmed draft', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('reply lost'));
    const mounted = render(view());
    await agree();
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t submit your entry');
    const firstRequest = vi.mocked(api.post).mock.calls[0][1] as { requestId: string };
    expect(readEntryDraft(key)?.requestId).toBe(firstRequest.requestId);
    mounted.unmount();
    const again = render(view());
    await agree();
    await submit();
    await waitFor(() => expect(onSent).toHaveBeenCalledOnce());
    expect(vi.mocked(api.post).mock.calls[1][1]).toMatchObject({ requestId: firstRequest.requestId });
    expect(localStorage.getItem(key)).toBeNull();
    again.unmount();
    render(view());
    expect(readEntryDraft(key)?.requestId).not.toBe(firstRequest.requestId);
  });

  it('does not display another account’s late submission result', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(api.post).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const mounted = render(view());
    await agree();
    await submit();
    state.user = { ...person, id: 'example-b', fullName: 'Other Example' };
    mounted.rerender(view());
    await act(async () => finish({ data: { id: 9, status: 1, amountMinor: 0 } }));
    expect(onSent).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Your name')).toHaveValue('Other Example');
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('keeps entry usable when storage is blocked and explains that it is not saved', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(view());
    expect(screen.getByText(/Your details can’t be saved on this device/)).toBeInTheDocument();
    expect(screen.queryByText(/Unfinished entry saved/)).not.toBeInTheDocument();
    await agree();
    await submit();
    expect(onSent).toHaveBeenCalledOnce();
  });
});
