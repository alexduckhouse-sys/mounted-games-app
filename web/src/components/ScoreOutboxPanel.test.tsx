import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { Placing, QueuedScore } from '../offline/scoreOutbox';
import { heat } from '../test/factories';
import { ScoreOutboxPanel } from './ScoreOutboxPanel';
import { TOAST_MS } from './Toast';

import { autoConfirm } from '../test/confirm';
vi.mock('../api', () => ({ api: { post: vi.fn() } }));
const post = vi.mocked(api.post);

const KEY = 'mg.outbox.scores';
const mine: Placing[] = [{ teamId: 1, place: 1, eliminated: false }, { teamId: 2, place: 2, eliminated: false }];
const theirs: Placing[] = [{ teamId: 2, place: 1, eliminated: false }, { teamId: 1, place: 2, eliminated: false }];
const item = (raceId: number, extra: Partial<QueuedScore> = {}): QueuedScore => ({
  raceId, competitionId: 1, sessionId: 1, label: `Heat ${raceId} · Barrel Race`, places: mine, expected: [],
  teamNames: { 1: 'Red Rum', 2: 'Shergar' }, queuedAt: `2026-06-01T10:0${raceId}:00Z`, state: 'waiting', ...extra,
});
const seed = (...items: QueuedScore[]) => localStorage.setItem(KEY, JSON.stringify(items));
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? '[]') as QueuedScore[];

beforeEach(() => {
  post.mockResolvedValue({ data: heat(1) } as never);
});

describe('ScoreOutboxPanel', () => {
  it.each([
    { viaLink: false, hasQueued: false },
    { viaLink: false, hasQueued: true },
    { viaLink: true, hasQueued: false },
    { viaLink: true, hasQueued: true },
  ])('imports with the screen mode (viaLink=$viaLink, hasQueued=$hasQueued)', async ({ viaLink, hasQueued }) => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    if (!viaLink) localStorage.setItem('mg.scorer.token', 'synthetic-old-scorer-token');
    if (hasQueued) seed(item(1));
    render(<ScoreOutboxPanel competitionId={1} viaLink={viaLink} alwaysImport />);
    await userEvent.click(screen.getByText('Import scores from another phone'));
    fireEvent.change(screen.getByLabelText('Backup'), { target: { value: JSON.stringify([item(3, { viaLink: !viaLink })]) } });
    await userEvent.click(screen.getByRole('button', { name: 'Add scores' }));

    const imported = stored().find((q) => q.raceId === 3);
    expect(imported).toBeDefined();
    expect(Boolean(imported?.viaLink)).toBe(viaLink);
  });

  it('shows nothing when there is nothing waiting for this competition', () => {
    seed(item(1, { competitionId: 2 }));
    const { container } = render(<ScoreOutboxPanel competitionId={1} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing at all with an empty outbox', () => {
    const { container } = render(<ScoreOutboxPanel competitionId={1} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('tells the scorer a single saved race will send when there is signal', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    seed(item(1));
    render(<ScoreOutboxPanel competitionId={1} />);
    expect(screen.getByRole('status')).toHaveTextContent('Heat 1 · Barrel Race is saved on this phone and will send when you have signal.');
  });

  it('counts several saved races', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    seed(item(1), item(2));
    render(<ScoreOutboxPanel competitionId={1} />);
    expect(screen.getByRole('status')).toHaveTextContent('2 races are saved on this phone');
  });

  it('sends waiting results on request', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    seed(item(1));
    render(<ScoreOutboxPanel competitionId={1} />);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/races/1/results', expect.anything(), expect.anything()));
    // The toast says it was sent for a moment, then the panel empties.
    expect(await screen.findByText('Heat 1 · Barrel Race sent')).toBeInTheDocument();
    expect(screen.queryByText(/saved on this phone/)).toBeNull();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument(), { timeout: TOAST_MS + 1000 });
  });

  it('holds back the saved-on-this-phone notice while a fresh online save is still going out', () => {
    seed(item(1, { queuedAt: new Date().toISOString() }));
    post.mockReturnValue(new Promise(() => undefined) as never);
    render(<ScoreOutboxPanel competitionId={1} />);
    expect(screen.queryByText(/saved on this phone/)).toBeNull();
  });

  it('does not say anything was sent when a waiting save is removed without being sent', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    seed(item(1));
    render(<ScoreOutboxPanel competitionId={1} />);
    expect(screen.getByRole('status')).toHaveTextContent('saved on this phone');
    act(() => { localStorage.removeItem(KEY); window.dispatchEvent(new CustomEvent('mg:outbox')); });
    await new Promise((r) => setTimeout(r, 120));
    expect(screen.queryByText(/sent/)).toBeNull();
  });

  describe('when another phone scored the race differently', () => {
    const conflict = () => seed(item(1, { state: 'conflict', theirs }));

    it('shows both sets of results side by side', () => {
      conflict();
      render(<ScoreOutboxPanel competitionId={1} />);
      expect(screen.getByRole('dialog')).toHaveAccessibleName('Heat 1 · Barrel Race was scored on another phone too');
      expect(screen.getByRole('dialog')).toHaveAccessibleDescription('The results don’t match. Choose which to keep.');
      expect(screen.getByText('Theirs').nextSibling).toHaveTextContent('1st Shergar · 2nd Red Rum');
      expect(screen.getByText('Yours').nextSibling).toHaveTextContent('1st Red Rum · 2nd Shergar');
    });

    it('lets the scorer keep theirs, which drops the local copy', async () => {
      conflict();
      render(<ScoreOutboxPanel competitionId={1} />);
      await userEvent.click(screen.getByRole('button', { name: 'Keep theirs' }));
      expect(stored()).toEqual([]);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('requires a reason before replacing the other phone’s results', async () => {
      conflict();
      render(<ScoreOutboxPanel competitionId={1} />);
      expect(screen.getByRole('button', { name: 'Use mine' })).toBeDisabled();
      await userEvent.type(screen.getByRole('textbox', { name: 'Reason for replacing these results' }), 'Judge checked the finish');
      await userEvent.click(screen.getByRole('button', { name: 'Use mine' }));
      await waitFor(() => expect(post).toHaveBeenCalledWith('/races/1/results', expect.objectContaining({ places: mine, expected: theirs, reason: 'Judge checked the finish' }), expect.anything()));
    });

    it('shows an empty "theirs" when the other results are unknown', () => {
      seed(item(1, { state: 'conflict' }));
      render(<ScoreOutboxPanel competitionId={1} />);
      expect(screen.getByText('Theirs').nextSibling).toHaveTextContent('No results');
    });
  });

  describe('when a save was rejected', () => {
    const failed = () => seed(item(1, { state: 'failed', error: 'These results were rejected.' }));

    it('explains what went wrong along with the results', () => {
      failed();
      render(<ScoreOutboxPanel competitionId={1} />);
      expect(screen.getByRole('alert')).toHaveTextContent('Heat 1 · Barrel Race wasn’t saved');
      expect(screen.getByRole('alert')).toHaveTextContent('These results were rejected. (1st Red Rum · 2nd Shergar)');
    });

    it('queues it again on "Try again"', async () => {
      failed();
      render(<ScoreOutboxPanel competitionId={1} />);
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    });

    it('deletes the results only after the scorer confirms', async () => {
      failed();
      const confirm = autoConfirm([false, true]);
      render(<ScoreOutboxPanel competitionId={1} />);
      await userEvent.click(screen.getByRole('button', { name: 'Delete mine' }));
      await waitFor(() => expect(confirm).toHaveBeenCalledWith('Your results for Heat 1 · Barrel Race on this phone go for good.'));
      expect(stored()).toHaveLength(1);
      await userEvent.click(screen.getByRole('button', { name: 'Delete mine' }));
      await waitFor(() => expect(stored()).toEqual([]));
    });
  });

  it('keeps the saved results and explains a failed storage update', async () => {
    seed(item(1, { state: 'failed' }));
    const block = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    render(<ScoreOutboxPanel competitionId={1} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText(/couldn’t be saved on this phone/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    expect(stored()[0].state).toBe('failed');
    block.mockRestore();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/couldn’t be saved on this phone/)).not.toBeInTheDocument();
  });

  it('shows each kind of problem separately', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    seed(item(1, { state: 'conflict', theirs }), item(2, { state: 'failed', error: 'x' }), item(3));
    render(<ScoreOutboxPanel competitionId={1} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

it('offers timing recovery without discarding scores or their conflict check', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  seed(item(1, { state: 'failed', error: 'Clock outside event', startedAt: '2020-01-01T10:00:00Z', finishedAt: '2020-01-01T10:03:00Z', expected: theirs, reason: 'Checked with referee' }));
  render(<ScoreOutboxPanel competitionId={1} />);
  await userEvent.click(screen.getByRole('button', { name: 'Send scores without timing' }));
  expect(stored()).toEqual([expect.objectContaining({ state: 'waiting', places: mine, expected: theirs, reason: 'Checked with referee', timingOmitted: true })]);
  expect(stored()[0].startedAt).toBeUndefined();
  expect(stored()[0].finishedAt).toBeUndefined();
});
