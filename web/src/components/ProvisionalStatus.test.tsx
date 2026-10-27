import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionProvisionalState } from '../lib/provisionalResults';
import { useProvisionalState } from '../hooks/useProvisionalState';
import { countdownText } from '../lib/provisionalCountdown';
import { ConfirmOfficialButton, ProvisionalBadge } from './ProvisionalStatus';

const post = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ api: { post } }));

const state = (status: SessionProvisionalState['status'], remainingSeconds = 0): SessionProvisionalState => ({
  status,
  isProvisional: status === 'provisional' || status === 'under-review-hold',
  isOfficial: status === 'official',
  hasUnderReview: status === 'under-review-hold',
  remainingSeconds,
  remainingMinutes: remainingSeconds > 0 ? Math.max(1, Math.ceil(remainingSeconds / 60)) : 0,
  provisionalUntilIso: null,
  officialConfirmedAtIso: null,
  badgeText: null,
});

beforeEach(() => { post.mockResolvedValue({ data: {} }); });
afterEach(() => { vi.useRealTimers(); });

describe('countdownText', () => {
  it('shows minutes and seconds, never below zero', () => {
    expect(countdownText(872)).toBe('14:32');
    expect(countdownText(5.7)).toBe('0:05');
    expect(countdownText(-3)).toBe('0:00');
  });
});

describe('ProvisionalBadge', () => {
  it('shows the time left for queries, with a spoken label in minutes', () => {
    render(<ProvisionalBadge state={state('provisional', 872)} className="ml-2" />);
    const pill = screen.getByRole('status', { name: 'Results provisional, 15 minutes left for queries' });
    expect(pill).toHaveTextContent('Provisional · 14:32 left for queries');
    expect(pill).toHaveClass('ml-2');
  });

  it('says one minute in the singular', () => {
    render(<ProvisionalBadge state={state('provisional', 40)} />);
    expect(screen.getByRole('status', { name: 'Results provisional, 1 minute left for queries' })).toBeInTheDocument();
  });

  it('shows a hold while a result is under review, and Official once confirmed', () => {
    const { rerender } = render(<ProvisionalBadge state={state('under-review-hold')} />);
    expect(screen.getByRole('status', { name: 'Results provisional while a result is under review' })).toHaveTextContent('Provisional · result under review');
    rerender(<ProvisionalBadge state={state('official')} />);
    expect(screen.getByRole('status', { name: 'Results official' })).toHaveTextContent('Official');
  });

  it('shows nothing while the session is running or there is no state', () => {
    const { container, rerender } = render(<ProvisionalBadge state={state('in-progress')} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ProvisionalBadge state={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('useProvisionalState', () => {
  it('ticks once a second while counting down, and stops once official', () => {
    vi.useFakeTimers();
    const start = Date.now();
    const until = start + 2_000;
    const compute = (now: number) => state(now < until ? 'provisional' : 'official', Math.max(0, (until - now) / 1000));
    const { result } = renderHook(() => useProvisionalState(compute));
    expect(result.current?.status).toBe('provisional');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current?.remainingSeconds).toBe(1);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current?.status).toBe('official');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not tick for other states', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useProvisionalState(() => null));
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('ConfirmOfficialButton', () => {
  it('confirms provisional results official', async () => {
    const onDone = vi.fn();
    render(<ConfirmOfficialButton competitionId={4} sessionId={9} state={state('provisional', 600)} onDone={onDone} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm official now' }));
    expect(post).toHaveBeenCalledWith('/competitions/4/sessions/9/confirm-official', {});
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('reopens queries on official results, and works without a callback', async () => {
    render(<ConfirmOfficialButton competitionId={4} sessionId={9} state={state('official')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reopen for queries' }));
    expect(post).toHaveBeenCalledWith('/competitions/4/sessions/9/confirm-official', { reopenQueries: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reopen for queries' })).toBeEnabled());
  });

  it('shows the busy wording while sending', async () => {
    let finish: (v: unknown) => void = () => {};
    post.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { rerender } = render(<ConfirmOfficialButton competitionId={4} sessionId={9} state={state('provisional', 60)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm official now' }));
    expect(screen.getByRole('button', { name: 'Confirming…' })).toBeDisabled();
    await act(async () => { finish({ data: {} }); });
    post.mockReturnValue(new Promise(() => {}));
    rerender(<ConfirmOfficialButton competitionId={4} sessionId={9} state={state('official')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reopen for queries' }));
    expect(screen.getByRole('button', { name: 'Reopening…' })).toBeDisabled();
  });

  it('is held while a result is under review', () => {
    render(<ConfirmOfficialButton competitionId={4} sessionId={9} state={state('under-review-hold')} />);
    expect(screen.getByRole('button', { name: 'Confirm official now' })).toBeDisabled();
    expect(screen.getByText('Settle the result under review first.')).toBeInTheDocument();
  });

  it('shows why the server refused, or a fallback for each action', async () => {
    post.mockRejectedValueOnce({ response: { data: { message: 'Resolve or clear all results flagged under review before confirming official results.' } } });
    const { rerender } = render(<ConfirmOfficialButton competitionId={4} sessionId={9} state={state('provisional', 60)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm official now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/under review/);
    post.mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm official now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t confirm the results. Try again.');
    rerender(<ConfirmOfficialButton competitionId={4} sessionId={9} state={state('official')} />);
    post.mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getByRole('button', { name: 'Reopen for queries' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t reopen queries. Try again.');
  });

  it('shows nothing while the session is running', () => {
    const { container, rerender } = render(<ConfirmOfficialButton competitionId={4} sessionId={9} state={state('in-progress')} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ConfirmOfficialButton competitionId={4} sessionId={9} state={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
