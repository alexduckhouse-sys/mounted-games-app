import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { WIND_FRESH_MS, type WindPrompt } from '../lib/windForecast';
import type { QueuedScore } from '../offline/scoreOutbox';
import { competition, heat, race, session } from '../test/factories';
import type { CompetitionDetail } from '../types';
import { WindReviewSheet, type WindSelection } from './WindReviewSheet';

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
const NOW = Date.parse('2026-10-29T12:00:00Z');
const base = '/competitions/12';
const errorText = 'Couldn’t save or load this review. Check your signal and reload before trying again.';
const selection = (extra: Partial<WindSelection> = {}): WindSelection => ({
  sectionId: 0, profileId: 'pc2026', revision: 4, eventLevel: 'Test open event', publishedSpare: 'Bottle Shuttle',
  permittedRaces: ['Bottle Shuttle', 'Flag Fliers'], venueNotes: 'Check the test arena',
  reviewMph: 25, officialReviewMph: 35, venueLimitMph: null, adoptionConfirmed: true, ...extra,
});
const rules = (selections: WindSelection[] = [selection()]) => ({
  profiles: [
    { id: 'unverified', name: 'Manual review', source: '', clause: '', authority: 'Event official', guidance: 'Confirm the event rules.' },
    { id: 'pc2026', name: 'Test PC 2026 profile', source: 'https://example.test/rules', clause: 'Test clause 7', authority: 'Event official', guidance: 'Check the published spare.' },
  ], selections, candidates: ['Bottle Shuttle', 'Flag Fliers'],
});
const event = (extra: Partial<CompetitionDetail> = {}) => competition({
  id: 12,
  sections: [
    { id: 5, competitionId: 12, format: 1, ageGroup: 'Seniors', displayName: 'Seniors' },
    { id: 6, competitionId: 12, format: 1, ageGroup: 'Juniors', displayName: 'Juniors' },
  ],
  sessions: [
    session(10, { name: 'Morning', arenaName: 'North', heats: [heat(100, { label: 'Heat A', races: [race(101, { name: 'Flag Fliers' }), race(102, { name: 'Finished race', isComplete: true })] })] }),
    session(20, { name: 'Afternoon', arenaName: 'South', heats: [heat(200, { races: [race(201, { name: 'Bottle Shuttle' })] })] }),
    session(30, { name: 'Finished session', status: 2, arenaName: 'Closed', heats: [heat(300, { races: [race(301)] })] }),
  ], ...extra,
});
const freshPrompt = (extra: Partial<WindPrompt> = {}): WindPrompt => ({ startsAt: NOW, endsAt: NOW + 3_600_000, peakMph: 37.6, severity: 2, fetchedAt: NOW - 60_000, ...extra });
const preview = (extra = {}) => ({
  fingerprint: 'review-fingerprint-1', profileId: 'pc2026', authority: 'Event official', source: 'https://example.test/rules', clause: 'Test clause 7',
  races: [{ raceId: 101, heat: 'Heat A', before: 'Flag Fliers', after: 'Bottle Shuttle' }],
  diagramJson: '[]', rules: 'Use the approved published spare.', equipment: 'Two test bottles per lane.', canApply: true, blockedReason: null, ...extra,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function show(extra: Partial<React.ComponentProps<typeof WindReviewSheet>> = {}) {
  const props = { competition: event(), prompt: freshPrompt(), hours: null, reload: vi.fn(), onClose: vi.fn(), ...extra };
  return { ...render(<WindReviewSheet {...props} />), ...props, user: userEvent.setup() };
}
async function openRules(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText('Event rules and wind prompts'));
}
async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole('button', { name: new RegExp(`^${label}:`) }));
  await user.click(screen.getByRole('option', { name: option }));
}
async function openRace(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('Review race change'));
  await choose(user, 'Race', 'Morning · Heat A · Flag Fliers');
  await user.type(screen.getByLabelText('Replacement race name'), 'Bottle Shuttle');
}
async function reviewRace(user: ReturnType<typeof userEvent.setup>) {
  await openRace(user);
  await user.click(screen.getByRole('button', { name: 'Preview change' }));
  await screen.findByText('Use the approved published spare.');
}
async function approve(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Official decision and reason'), 'Official approved the published spare.');
  await user.click(screen.getByRole('switch', { name: 'Replacement equipment checked and ready' }));
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.mocked(api.get).mockResolvedValue({ data: rules() });
  vi.mocked(api.put).mockImplementation(async (_url, body) => ({ data: { ...body as WindSelection, revision: (body as WindSelection).revision + 1 } }));
  vi.mocked(api.post).mockImplementation(async url => ({ data: url.endsWith('/preview') ? preview() : {} }));
});
afterEach(() => vi.useRealTimers());

describe('wind rule settings', () => {
  it('loads the saved rulebook, a section override and defaults for an unsaved section', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: rules([selection(), selection({ sectionId: 5, profileId: 'unverified', eventLevel: 'Test section', reviewMph: 20, venueLimitMph: 22 })]) });
    const { user } = show();
    await openRules(user);
    expect(api.get).toHaveBeenCalledWith(`${base}/wind-review/rules`);
    expect(screen.getByLabelText('Event level and age group')).toHaveValue('Test open event');
    for (const link of screen.getAllByRole('link', { name: 'Test clause 7' })) expect(link).toHaveAttribute('href', 'https://example.test/rules');
    expect(screen.getByText('Bottle Shuttle · Flag Fliers')).toBeVisible();
    await choose(user, 'Applies to', 'Seniors');
    expect(screen.getByLabelText('Event level and age group')).toHaveValue('Test section');
    expect(screen.getByText('Venue or equipment limit: 22 mph')).toBeVisible();
    expect(screen.getByText('Confirm the event rules.')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Test clause 7' })).not.toBeInTheDocument();
    await choose(user, 'Applies to', 'Juniors');
    expect(screen.getByLabelText('Event level and age group')).toHaveValue('');
    expect(screen.getByRole('switch', { name: 'Event adoption and race list checked' })).not.toBeChecked();
    expect(screen.queryByText(/Venue or equipment limit:/)).not.toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('clears adoption after changing edition and retains the returned revision across section selection', async () => {
    const saved = deferred<{ data: WindSelection }>();
    vi.mocked(api.put).mockReturnValueOnce(saved.promise);
    const notification = vi.fn();
    window.addEventListener('mg:wind-review', notification, { once: true });
    const { user } = show();
    await openRules(user);
    await choose(user, 'Rulebook edition', 'Manual review');
    expect(api.put).toHaveBeenCalledWith(`${base}/wind-review/rules`, { ...selection(), profileId: 'unverified', adoptionConfirmed: false, expectedRevision: 4 });
    expect(screen.getByRole('button', { name: /^Applies to:/ })).toBeDisabled();
    expect(screen.getByLabelText('Event level and age group')).toBeDisabled();
    await act(async () => saved.resolve({ data: selection({ profileId: 'unverified', adoptionConfirmed: false, revision: 5 }) }));
    expect(notification).toHaveBeenCalledTimes(1);
    await choose(user, 'Applies to', 'Juniors');
    await choose(user, 'Applies to', 'Whole event');
    expect(screen.getByRole('button', { name: 'Rulebook edition: Manual review' })).toBeEnabled();
    await user.click(screen.getByRole('switch', { name: 'Event adoption and race list checked' }));
    await waitFor(() => expect(api.put).toHaveBeenLastCalledWith(`${base}/wind-review/rules`, expect.objectContaining({ expectedRevision: 5, adoptionConfirmed: true })));
  });

  it.each([
    ['Event level and age group', 'Test novice event', 'eventLevel', 'Test novice event'],
    ['Published spare race', 'Three Pot Flag Race', 'publishedSpare', 'Three Pot Flag Race'],
    ['Permitted race names, separated by commas', ' Bottle Shuttle, , Flag Fliers, ', 'permittedRaces', ['Bottle Shuttle', 'Flag Fliers']],
    ['Venue and equipment requirements', 'Official to inspect test equipment', 'venueNotes', 'Official to inspect test equipment'],
    ['Lower venue or equipment limit (mph, if known)', '21', 'venueLimitMph', 21],
  ])('saves %s on blur with the expected revision', async (label, text, key, expected) => {
    const { user } = show();
    await openRules(user);
    const input = screen.getByLabelText(label as string);
    await user.clear(input);
    await user.type(input, text as string);
    expect(api.put).not.toHaveBeenCalled();
    fireEvent.blur(input);
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(`${base}/wind-review/rules`, expect.objectContaining({ [key as string]: expected, expectedRevision: 4 })));
    await waitFor(() => expect(input).toBeEnabled());
  });

  it('clears a venue limit without converting an empty field to zero', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: rules([selection({ venueLimitMph: 18 })]) });
    const { user } = show();
    await openRules(user);
    const input = screen.getByLabelText('Lower venue or equipment limit (mph, if known)');
    expect(input).toHaveValue('18');
    await user.clear(input);
    fireEvent.blur(input);
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(`${base}/wind-review/rules`, expect.objectContaining({ venueLimitMph: null })));
    expect(screen.queryByText(/Venue or equipment limit:/)).not.toBeInTheDocument();
  });

  it.each([['Equipment review prompt (mph)', 'reviewMph', 26], ['Official review prompt (mph)', 'officialReviewMph', 36]])('saves %s without altering the other threshold', async (label, key, value) => {
    const { user } = show();
    await openRules(user);
    await user.click(screen.getByRole('button', { name: `Add one ${label}` }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(`${base}/wind-review/rules`, { ...selection(), [key]: value, expectedRevision: 4 }));
  });

  it('retains a failed draft for retry with the original expected revision', async () => {
    vi.mocked(api.put).mockRejectedValueOnce(new Error('revision conflict'));
    const { user } = show();
    await openRules(user);
    const input = screen.getByLabelText('Published spare race');
    await user.clear(input);
    await user.type(input, 'Test replacement');
    fireEvent.blur(input);
    expect(await screen.findByRole('alert')).toHaveTextContent(errorText);
    expect(input).toHaveValue('Test replacement');
    fireEvent.blur(input);
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
    expect(api.put).toHaveBeenLastCalledWith(`${base}/wind-review/rules`, expect.objectContaining({ publishedSpare: 'Test replacement', expectedRevision: 4 }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('race change review and approval', () => {
  it('lists unfinished races by arena and warns about unsent scores for the selected session', async () => {
    const queued: QueuedScore = { raceId: 101, competitionId: 12, sessionId: 10, label: 'Test race', places: [], expected: [], teamNames: {}, queuedAt: new Date(NOW).toISOString(), state: 'waiting' };
    localStorage.setItem('mg.outbox.scores', JSON.stringify([queued]));
    const { user } = show();
    await user.click(screen.getByText('Review race change'));
    const button = screen.getByRole('button', { name: 'Preview change' });
    expect(button).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /^Race:/ }));
    const options = within(screen.getByRole('listbox', { name: 'Race' })).getAllByRole('option');
    expect(options.map(o => o.textContent)).toEqual(['Choose a race', 'Morning · Heat A · Flag Fliers', 'Afternoon ·  · Bottle Shuttle']);
    await user.click(screen.getByRole('option', { name: 'Morning · Heat A · Flag Fliers' }));
    expect(screen.getByText(/This phone has unsent scores/)).toBeVisible();
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Replacement race name'), '   ');
    expect(button).toBeDisabled();
    await choose(user, 'Arena', 'South');
    await choose(user, 'Race', 'Afternoon · · Bottle Shuttle');
    expect(screen.queryByText(/This phone has unsent scores/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Race:/ }));
    expect(screen.queryByRole('option', { name: /Flag Fliers/ })).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows the source, affected races, equipment and diagram and requires both approval fields before commit', async () => {
    const { user, reload, onClose } = show();
    await reviewRace(user);
    expect(api.post).toHaveBeenCalledWith(`${base}/wind-review/preview`, { sessionId: 10, raceId: 101, replacement: 'Bottle Shuttle' });
    expect(screen.getByText('Heat A: Flag Fliers → Bottle Shuttle')).toBeVisible();
    for (const link of screen.getAllByRole('link', { name: 'Test clause 7' })) expect(link).toHaveAttribute('href', 'https://example.test/rules');
    expect(screen.getByLabelText('Arena setup diagram')).toBeVisible();
    expect(screen.getByText('Two test bottles per lane.')).toBeVisible();
    const apply = screen.getByRole('button', { name: 'Apply approved change' });
    expect(apply).toBeDisabled();
    await user.click(screen.getByRole('switch', { name: 'Replacement equipment checked and ready' }));
    expect(apply).toBeDisabled();
    await user.type(screen.getByLabelText('Official decision and reason'), 'Official approved the published spare.');
    expect(apply).toBeEnabled();
    await user.click(apply);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenLastCalledWith(`${base}/race-changes`, { sessionId: 10, raceId: 101, replacement: 'Bottle Shuttle', fingerprint: 'review-fingerprint-1', requestId: expect.any(String), authority: 'Event official', decision: 'Official approved the published spare.', equipmentConfirmed: true });
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('shows a blocked review without offering a commit', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: preview({ canApply: false, blockedReason: 'Scores were recorded. Reload the event.' }) });
    const { user } = show();
    await reviewRace(user);
    expect(screen.getByText('Scores were recorded. Reload the event.')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('button', { name: 'Apply approved change' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Official decision and reason')).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('retries a failed preview without committing or losing the selected replacement', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    const { user, reload, onClose } = show();
    await openRace(user);
    await user.click(screen.getByRole('button', { name: 'Preview change' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(errorText);
    expect(reload).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Replacement race name')).toHaveValue('Bottle Shuttle');
    await user.click(screen.getByRole('button', { name: 'Preview change' }));
    await screen.findByText('Use the approved published spare.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.post).mock.calls.every(([url]) => url.endsWith('/preview'))).toBe(true);
  });

  it('retries an interrupted commit with the same request identity and official decision', async () => {
    const { user, onClose, reload } = show();
    await reviewRace(user);
    await approve(user);
    vi.mocked(api.post).mockRejectedValueOnce(new Error('response lost'));
    await user.click(screen.getByRole('button', { name: 'Apply approved change' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(errorText);
    const firstCommit = vi.mocked(api.post).mock.calls[1];
    expect(onClose).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Official decision and reason')).toHaveValue('Official approved the published spare.');
    expect(screen.getByRole('switch', { name: 'Replacement equipment checked and ready' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Apply approved change' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[2]).toEqual(firstCommit);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('invalidates approval and replaces the request identity when the replacement changes', async () => {
    const { user } = show();
    await reviewRace(user);
    await approve(user);
    vi.mocked(api.post).mockRejectedValueOnce(new Error('stale programme'));
    await user.click(screen.getByRole('button', { name: 'Apply approved change' }));
    await screen.findByRole('alert');
    const oldRequest = vi.mocked(api.post).mock.calls[1][1] as { requestId: string };
    await user.clear(screen.getByLabelText('Replacement race name'));
    await user.type(screen.getByLabelText('Replacement race name'), 'Flag Fliers');
    expect(screen.queryByRole('button', { name: 'Apply approved change' })).not.toBeInTheDocument();
    vi.mocked(api.post).mockResolvedValueOnce({ data: preview({ fingerprint: 'review-fingerprint-2' }) });
    await user.click(screen.getByRole('button', { name: 'Preview change' }));
    await screen.findByLabelText('Official decision and reason');
    expect(screen.getByLabelText('Official decision and reason')).toHaveValue('');
    expect(screen.getByRole('switch', { name: 'Replacement equipment checked and ready' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Apply approved change' })).toBeDisabled();
    await approve(user);
    await user.click(screen.getByRole('button', { name: 'Apply approved change' }));
    const newRequest = vi.mocked(api.post).mock.calls[3][1] as { requestId: string; fingerprint: string; replacement: string };
    expect(newRequest.requestId).not.toBe(oldRequest.requestId);
    expect(newRequest).toMatchObject({ fingerprint: 'review-fingerprint-2', replacement: 'Flag Fliers' });
  });

  it('does not commit a preview after the selected race disappears from the refreshed event', async () => {
    const view = show();
    await reviewRace(view.user);
    await approve(view.user);
    view.rerender(<WindReviewSheet competition={event({ sessions: [] })} prompt={freshPrompt()} hours={null} reload={view.reload} onClose={view.onClose} />);
    await view.user.click(screen.getByRole('button', { name: 'Apply approved change' }));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith(`${base}/wind-review/preview`, expect.anything());
    expect(view.onClose).not.toHaveBeenCalled();
  });

  it('removes the preview when another arena is selected', async () => {
    const { user } = show();
    await reviewRace(user);
    await choose(user, 'Arena', 'South');
    expect(screen.queryByText('Use the approved published spare.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply approved change' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preview change' }));
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});

describe('wind actions and forecast lifecycle', () => {
  it('pauses only the selected arena with the edited announcement', async () => {
    const { user, reload, onClose } = show();
    await choose(user, 'Arena', 'South');
    await user.type(screen.getByLabelText('Announcement (editable; optional for pause)'), '  Test arena pause.  ');
    expect(api.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Pause racing' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith(`${base}/sessions/pause`, { arenaName: 'South', reason: 'wind', announcement: 'Test arena pause.' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('can pause the whole event without an announcement or forecast', async () => {
    const { user } = show({ prompt: null, competition: event({ sessions: [session(10, { arenaName: undefined })] }) });
    expect(screen.queryByRole('button', { name: /^Arena:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Equipment reviewed on site' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pause racing' }));
    expect(api.post).toHaveBeenCalledWith(`${base}/sessions/pause`, { arenaName: undefined, reason: 'wind', announcement: undefined });
  });

  it('requires official approval for the wind-paused arena and does not resume an arena paused for rain', async () => {
    const { user, onClose } = show({ prompt: null, competition: event({ sessions: [session(10, { arenaName: 'North', notes: '[paused:123] [pausefor:wind]' }), session(20, { arenaName: 'South', notes: '[paused:456] [pausefor:rain]' })] }) });
    expect(screen.getByText('Racing paused for wind · Official review needed')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Resume racing' })).toBeDisabled();
    await choose(user, 'Arena', 'South');
    expect(screen.queryByRole('button', { name: 'Resume racing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /official has checked/ })).not.toBeInTheDocument();
    await choose(user, 'Arena', 'North');
    await user.click(screen.getByRole('switch', { name: /official has checked/ }));
    await user.click(screen.getByRole('button', { name: 'Resume racing' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith(`${base}/sessions/resume`, { arenaName: 'North', reason: 'wind', announcement: undefined });
  });

  it('retains a failed announcement for retry, then clears it without closing the review', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    const { user, reload, onClose } = show();
    const input = screen.getByLabelText('Announcement (editable; optional for pause)');
    const send = screen.getByRole('button', { name: 'Send announcement' });
    expect(send).toBeDisabled();
    await user.type(input, '   ');
    expect(send).toBeDisabled();
    await user.type(input, 'Test event update.  ');
    await user.click(send);
    expect(await screen.findByRole('alert')).toHaveTextContent(errorText);
    expect(input).toHaveValue('   Test event update.  ');
    expect(reload).not.toHaveBeenCalled();
    await user.click(send);
    await waitFor(() => expect(input).toHaveValue(''));
    expect(api.post).toHaveBeenLastCalledWith(`${base}/sessions/weather-notice`, { body: 'Test event update.' });
    expect(send).toBeDisabled();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(['All arenas', 'North'])('acknowledges the fresh forecast for %s after an explicit decision', async selectedArena => {
    const notification = vi.fn();
    window.addEventListener('mg:wind-review', notification, { once: true });
    const { user, reload, onClose, prompt } = show();
    if (selectedArena !== 'All arenas') await choose(user, 'Arena', selectedArena);
    expect(screen.getByText(/Gusts up to 38 mph forecast/)).toBeVisible();
    expect(api.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Equipment reviewed on site' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith(`${base}/wind-review/acknowledge`, { ...prompt, arena: selectedArena === 'All arenas' ? 'North|South' : 'North' });
    expect(notification).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('hides acknowledgement for a stale forecast but keeps manual decisions available', async () => {
    show({ prompt: freshPrompt({ fetchedAt: NOW - WIND_FRESH_MS - 1 }) });
    expect(screen.getByText(/Forecast unavailable/)).toBeVisible();
    expect(screen.queryByText(/Gusts up to/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Equipment reviewed on site' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause racing' })).toBeEnabled();
    await screen.findByText('Event rules and wind prompts');
  });

  it('derives a fresh prompt from forecast hours alongside a separate heavy rain warning', async () => {
    show({ prompt: null, hours: [{ startsAt: NOW + 3_600_000, gustMph: 31, fetchedAt: NOW, weatherCode: 61, rainMm: 5, rainChance: 90 }] });
    expect(screen.getByText(/Gusts up to 31 mph forecast/)).toBeVisible();
    expect(screen.getByText('Heavy rain is also forecast.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Equipment reviewed on site' })).toBeEnabled();
    await screen.findByText('Event rules and wind prompts');
  });

  it('snoozes locally and closes without changing the event', async () => {
    const onSnooze = vi.fn();
    const { user, onClose, reload } = show({ onSnooze });
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onSnooze).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('disables repeated writes while a pause is pending', async () => {
    const request = deferred<{ data: object }>();
    vi.mocked(api.post).mockReturnValueOnce(request.promise);
    const { user, onClose } = show();
    const pause = screen.getByRole('button', { name: 'Pause racing' });
    await user.click(pause);
    expect(pause).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Equipment reviewed on site' })).toBeDisabled();
    await user.click(pause);
    expect(api.post).toHaveBeenCalledTimes(1);
    await act(async () => request.resolve({ data: {} }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(pause).toBeEnabled();
  });

  it('shows a load error and loads settings when the review is reopened', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    const first = show();
    expect(await screen.findByRole('alert')).toHaveTextContent(errorText);
    expect(screen.queryByText('Event rules and wind prompts')).not.toBeInTheDocument();
    first.unmount();
    const second = show();
    await openRules(second.user);
    expect(screen.getByLabelText('Event level and age group')).toHaveValue('Test open event');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([{ profiles: null, selections: [] }, { profiles: [], selections: null }])('does not expose unusable rule data: %j', async data => {
    vi.mocked(api.get).mockResolvedValueOnce({ data });
    show();
    await act(async () => {});
    expect(screen.queryByText('Event rules and wind prompts')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause racing' })).toBeEnabled();
  });

  it.each(['success', 'failure'])('ignores a late rule-load %s from the previous event', async outcome => {
    const oldRequest = deferred<{ data: ReturnType<typeof rules> }>();
    vi.mocked(api.get).mockReturnValueOnce(oldRequest.promise);
    vi.mocked(api.get).mockResolvedValueOnce({ data: rules([selection({ eventLevel: 'Current test event' })]) });
    const view = show();
    view.rerender(<WindReviewSheet competition={event({ id: 13 })} prompt={null} hours={null} reload={view.reload} onClose={view.onClose} />);
    await openRules(view.user);
    await act(async () => {
      if (outcome === 'success') oldRequest.resolve({ data: rules([selection({ eventLevel: 'Old test event' })]) });
      else oldRequest.reject(new Error('old request failed'));
    });
    expect(screen.getByLabelText('Event level and age group')).toHaveValue('Current test event');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
