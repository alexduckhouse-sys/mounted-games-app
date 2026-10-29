import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../../api';
import { competition, heat as makeHeat, session as makeSession } from '../../../test/factories';
import { CallUpStrip, HeatCalledBadge } from './CallUpStrip';
import { callUpHeats, useHeatCalls } from './heatCalls';
import { RequestSubstitution, SubstitutionRequests } from './SubstitutionRequests';
import type { DeclarationForm, Heat, Session } from '../../../types';
const heat = (extra: Partial<Heat>) => makeHeat(extra.id ?? 1, extra);
const session = (extra: Partial<Session>) => makeSession(extra.id ?? 1, extra);
const auth = vi.hoisted(() => ({ user: { id: 'example-user', roles: ['Admin'] } as { id: string; roles: string[] } | null, token: 'example-session' }));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const live = vi.hoisted(() => ({ ready: 0, standingsVersion: 0 }));
vi.mock('../context', () => ({ useCompetition: () => live }));
beforeEach(() => { auth.user = { id: 'example-user', roles: ['Admin'] }; auth.token = 'example-session'; vi.mocked(api.get).mockResolvedValue({ data: [] }); vi.mocked(api.post).mockResolvedValue({ data: {} }); });
it('selects current and next two independently in each arena, excluding completed heats and breaks', () => {
  const rows = [session({ id: 1, orderIndex: 1, arenaName: 'A', heats: [heat({ id: 1, finishedAt: 'now' }), heat({ id: 2 }), heat({ id: 3 }), heat({ id: 4 }), heat({ id: 5 })] }),
    session({ id: 2, arenaName: 'B', heats: [heat({ id: 6 })] }), session({ id: 3, kind: 1, heats: [heat({ id: 7 })] })];
  expect(callUpHeats(rows).map(g => g.heats.map(x => x.heat.id))).toEqual([[2, 3, 4], [6]]);
  expect(callUpHeats(rows, 'B')).toHaveLength(1);
});
it('shares call status and sends the existing missing-team action', async () => {
  const comp = competition();
  render(<CallUpStrip competitionId={comp.id} sessions={[session({ heats: [heat({ id: 10 })] })]} />);
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /to collecting ring/ }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/competitions/${comp.id}/heat-calls/10`));
  render(<HeatCalledBadge heatId={10} calls={[{ heatId: 10, calledAt: 'now' }]} />);
  expect(screen.getByText('Called to collecting ring')).toBeInTheDocument();
});
it('stops showing previous call status when refresh fails', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [{ heatId: 10, calledAt: 'now' }] });
  render(<CallUpStrip competitionId={1} sessions={[session({ heats: [heat({ id: 10 })] })]} />);
  expect(await screen.findByRole('button', { name: 'Called to collecting ring' })).toBeDisabled();
  vi.mocked(api.get).mockRejectedValue(new Error());
  act(() => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByText(/could not be refreshed/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Called to collecting ring' })).toBeNull();
});
it('shows private pending changes and preserves a server stale-declaration reason', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [{ id: 7, teamName: 'Example Team', outRiderName: 'Example Rider', inRiderName: 'Example Reserve', reason: 'Example reason', status: 'pending' }] });
  vi.mocked(api.post).mockRejectedValue({ response: { data: { message: 'The declaration changed.' } } });
  render(<SubstitutionRequests competitionId={1} canDecide />);
  fireEvent.click(await screen.findByText('Approve'));
  expect(await screen.findByText('The declaration changed.')).toBeInTheDocument();
  expect(api.post).toHaveBeenCalledWith('/competitions/1/substitution-requests/7/decision', { approve: true });
});
it('requests a pony-only change with the outgoing rider and private reason', async () => {
  const form = { id: 1, teamName: 'Example Team', riders: [{ id: 2, fullName: 'Example Rider', isReserve: false }] } as DeclarationForm;
  render(<RequestSubstitution competitionId={3} form={form} />);
  fireEvent.click(screen.getByText(/Request substitution/));
  fireEvent.change(screen.getByLabelText('Replacement pony'), { target: { value: 'Example Pony' } });
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Example reason' } });
  fireEvent.click(screen.getByText('Send request'));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/3/substitution-requests/declarations/1', { outRiderEntryId: 2, inRiderEntryId: 0, replacementRiderName: null, replacementHorseName: 'Example Pony', reason: 'Example reason' }));
});

it('ignores old responses after competition changes and later refreshes', async () => {
  let resolveOld: (value: { data: Array<{ heatId: number; calledAt: string }> }) => void = () => {};
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const { result, rerender } = renderHook(({ id }) => useHeatCalls(id), { initialProps: { id: 1 } });
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  vi.mocked(api.get).mockResolvedValue({ data: [{ heatId: 22, calledAt: 'now' }] });
  rerender({ id: 2 });
  await waitFor(() => expect(result.current.calls[0]?.heatId).toBe(22));
  await act(async () => { resolveOld({ data: [{ heatId: 11, calledAt: 'old' }] }); });
  expect(result.current.calls.map(c => c.heatId)).toEqual([22]);
  let resolveSlow: typeof resolveOld = () => {};
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { resolveSlow = resolve; }));
  act(() => { void result.current.reload(); });
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  await act(async () => { await result.current.reload(); });
  await act(async () => { resolveSlow({ data: [{ heatId: 22, calledAt: 'old' }] }); });
  expect(result.current.calls).toEqual([]);
});

const requestRow = (id: number, teamName: string) => ({ id, teamName, outRiderName: 'Example Rider', inRiderName: 'Example Reserve', reason: 'Example private reason', status: 'pending' });
it('scopes private requests to the event and ignores an older response', async () => {
  let resolveOld: (value: { data: ReturnType<typeof requestRow>[] }) => void = () => {};
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const { rerender } = render(<SubstitutionRequests competitionId={1} canDecide />);
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/competitions/1/substitution-requests'));
  vi.mocked(api.get).mockResolvedValue({ data: [requestRow(22, 'Example New Event')] });
  rerender(<SubstitutionRequests competitionId={2} canDecide />);
  expect(await screen.findByText('Example New Event')).toBeInTheDocument();
  await act(async () => { resolveOld({ data: [requestRow(11, 'Example Old Event')] }); });
  expect(screen.queryByText('Example Old Event')).toBeNull();
  fireEvent.click(screen.getByText('Approve'));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/2/substitution-requests/22/decision', { approve: true }));
  expect(api.post).not.toHaveBeenCalledWith('/competitions/2/substitution-requests/11/decision', expect.anything());
});
it('clears private rows on failed refresh and ignores a slower successful refresh', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [requestRow(1, 'Example Private Team')] });
  render(<SubstitutionRequests competitionId={1} canDecide />);
  expect(await screen.findByText('Example Private Team')).toBeInTheDocument();
  let resolveSlow: (value: { data: ReturnType<typeof requestRow>[] }) => void = () => {};
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { resolveSlow = resolve; }));
  act(() => window.dispatchEvent(new Event('mg:substitutions')));
  vi.mocked(api.get).mockRejectedValue(new Error('Offline'));
  act(() => window.dispatchEvent(new Event('mg:substitutions')));
  expect(await screen.findByText(/Substitution requests could not be loaded/)).toBeInTheDocument();
  expect(screen.queryByText('Example Private Team')).toBeNull();
  expect(screen.queryByText('Approve')).toBeNull();
  await act(async () => { resolveSlow({ data: [requestRow(1, 'Example Private Team')] }); });
  expect(screen.queryByText('Example Private Team')).toBeNull();
});
it('hides private rows immediately when the account, permission or sign-in session changes', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [requestRow(1, 'Example Private Team')] });
  const { rerender } = render(<SubstitutionRequests competitionId={1} canDecide />);
  expect(await screen.findByText('Example Private Team')).toBeInTheDocument();
  vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
  auth.user = { id: 'another-example-user', roles: ['Admin'] };
  rerender(<SubstitutionRequests competitionId={1} canDecide />);
  expect(screen.queryByText('Example Private Team')).toBeNull();
  vi.mocked(api.get).mockResolvedValue({ data: [requestRow(2, 'Another Example Team')] });
  act(() => window.dispatchEvent(new Event('mg:substitutions')));
  expect(await screen.findByText('Another Example Team')).toBeInTheDocument();
  vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
  auth.user = { ...auth.user!, roles: ['Trainer'] };
  rerender(<SubstitutionRequests competitionId={1} canDecide={false} />);
  expect(screen.queryByText('Another Example Team')).toBeNull();
  vi.mocked(api.get).mockResolvedValue({ data: [requestRow(3, 'Example Session Team')] });
  act(() => window.dispatchEvent(new Event('mg:substitutions')));
  expect(await screen.findByText('Example Session Team')).toBeInTheDocument();
  vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
  auth.token = 'different-example-session';
  rerender(<SubstitutionRequests competitionId={1} canDecide={false} />);
  expect(screen.queryByText('Example Session Team')).toBeNull();
  auth.token = '';
  rerender(<SubstitutionRequests competitionId={1} canDecide={false} />);
  vi.mocked(api.get).mockClear();
  act(() => window.dispatchEvent(new Event('mg:substitutions')));
  expect(api.get).not.toHaveBeenCalled();
  auth.user = null;
  rerender(<SubstitutionRequests competitionId={1} canDecide={false} />);
  expect(screen.queryByRole('region', { name: 'Substitution requests' })).toBeNull();
});
it('ignores a decision completing after the event changes', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [requestRow(1, 'Example Private Team')] });
  let complete: (value: { data: object }) => void = () => {};
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const onChanged = vi.fn();
  const { rerender } = render(<SubstitutionRequests competitionId={1} canDecide onChanged={onChanged} />);
  fireEvent.click(await screen.findByText('Approve'));
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  rerender(<SubstitutionRequests competitionId={2} canDecide onChanged={onChanged} />);
  await act(async () => { complete({ data: {} }); });
  expect(onChanged).not.toHaveBeenCalled();
});

it('refreshes call status from parent live invalidation', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  const { result, rerender } = renderHook(() => useHeatCalls(1));
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  vi.mocked(api.get).mockResolvedValue({ data: [{ heatId: 10, calledAt: 'now' }] });
  live.standingsVersion++;
  rerender();
  await waitFor(() => expect(result.current.calls).toEqual([{ heatId: 10, calledAt: 'now' }]));
});
it('does not poll private requests while signed out', () => {
  auth.token = '';
  const interval = vi.spyOn(window, 'setInterval');
  render(<SubstitutionRequests competitionId={1} canDecide />);
  expect(interval).not.toHaveBeenCalled();
  expect(api.get).not.toHaveBeenCalled();
});
