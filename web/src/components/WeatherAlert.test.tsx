import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionConfig } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { competition, heat, session } from '../test/factories';
import { formatTime } from '../lib/time';
import type { ForecastHour } from '../lib/weatherAlert';
import type { CompetitionDetail, Session } from '../types';
import { WeatherAlert } from './WeatherAlert';
import { WeatherLine } from './WeatherLine';
import { WeatherLineProvider } from './WeatherLineContext';

const state = vi.hoisted(() => ({ organiser: true, hours: null as unknown, post: vi.fn(), forecastArgs: [] as unknown[] }));

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => state.organiser }) }));
vi.mock('../api', () => ({ api: { post: state.post } }));
vi.mock('../hooks/useDayForecast', () => ({
  useDayForecast: (...args: unknown[]) => { state.forecastArgs = args; return state.hours; },
}));

const at = (h: number, m = 0) => new Date(2026, 10, 2, h, m).getTime();
const hour = (h: number, extra: Partial<ForecastHour> = {}): ForecastHour => ({ startsAt: at(h), weatherCode: 3, rainMm: 0, rainChance: 0, ...extra });
const thunderAt = (...hs: number[]) => Array.from({ length: 24 }, (_, h) => hour(h, hs.includes(h) ? { weatherCode: 95 } : {}));
const rainAt = (...hs: number[]) => Array.from({ length: 24 }, (_, h) => hour(h, hs.includes(h) ? { rainMm: 6 } : {}));
const clock = (h: number, m = 0) => formatTime(new Date(at(h, m)));

const race = (id: number, extra: Partial<Session> = {}) =>
  session(id, { arenaName: 'Main Arena', scheduledStart: new Date(at(14)).toISOString(), heats: [heat(id * 10, { durationMinutes: 30 })], ...extra });

function mount(extra: Partial<CompetitionDetail> = {}, sessions: Session[] = [race(1)]) {
  const reload = vi.fn();
  const view = (
    <MotionConfig reducedMotion="always">
      <WeatherLineProvider>
        <WeatherLine />
        <WeatherAlert competition={competition({ id: 7, startDate: '2026-11-02', latitude: 51.5, longitude: -1.2, sessions, ...extra })} reload={reload} />
      </WeatherLineProvider>
    </MotionConfig>
  );
  return { reload, ...render(view) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(13, 30));
  state.organiser = true;
  state.hours = thunderAt(15, 16);
  state.post.mockReset();
  state.post.mockResolvedValue({ data: [] });
});
afterEach(() => vi.useRealTimers());

describe('WeatherAlert: the warning line', () => {
  it('puts one quiet line in the top bar for thunder that is near', () => {
    mount();
    const line = screen.getByRole('button', { name: /Thunder likely from about/ });
    expect(line).toHaveTextContent(clock(15));
    expect(line).toHaveTextContent('What to do');
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('is for organisers on an event day with a place, and only while racing is to come', () => {
    state.organiser = false;
    mount();
    expect(state.forecastArgs[2]).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each([
    ['another day', { startDate: '2026-11-09' }, [race(1, { scheduledStart: new Date(at(14) + 7 * 86_400_000).toISOString() })]],
    ['racing finished', {}, [race(1, { status: 2 })]],
  ])('shows nothing on %s', (_name, extra, sessions) => {
    mount(extra, sessions as Session[]);
    expect(state.forecastArgs[2]).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('asks for the forecast of the venue, and shows nothing without a forecast', () => {
    state.hours = null;
    mount();
    expect(state.forecastArgs).toEqual([51.5, -1.2, true]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('words heavy rain differently and tells instead of asking what to do', () => {
    state.hours = rainAt(14, 15);
    mount();
    expect(screen.getByRole('button', { name: /Heavy rain from about/ })).toHaveTextContent('Tell everyone');
  });

  it('says "now" when the storm is already here', () => {
    state.hours = thunderAt(13, 14);
    mount();
    expect(screen.getByRole('button', { name: /Thunder likely now/ })).toBeInTheDocument();
  });

  it('says "now" for rain too', () => {
    state.hours = rainAt(13);
    mount();
    expect(screen.getByRole('button', { name: /Heavy rain now/ })).toBeInTheDocument();
  });
});

describe('WeatherAlert: the pause sheet', () => {
  const openSheet = async () => userEvent.click(screen.getByRole('button', { name: /Thunder likely/ }));

  it('opens "Thunder on the way" with the pause switch on and a drafted announcement', async () => {
    mount();
    await openSheet();
    const sheet = screen.getByRole('dialog', { name: 'Thunder on the way' });
    expect(sheet).toHaveAccessibleDescription(new RegExp(`from about ${clock(15)} until about ${clock(17)}`));
    expect(within(sheet).getByRole('switch', { name: 'Pause racing' })).toBeChecked();
    expect((within(sheet).getByRole('textbox', { name: 'Announcement' }) as HTMLTextAreaElement).value).toContain('stopping because of thunder');
    expect(within(sheet).getByRole('button', { name: 'Pause and tell everyone' })).toBeEnabled();
    expect(within(sheet).queryByRole('button', { name: /Arenas/ })).toBeNull();
  });

  it('shows how the day shifts if racing restarts after the storm', async () => {
    mount();
    await openSheet();
    // Storm ends 17:00, plus the 30-minute wait: restart 17:30. Racing stopped at 13:30, so the 14:00 half-hour session is pushed four hours: 18:00 to 18:30.
    expect(screen.getByText(`If you start again at ${clock(17, 30)}, the last race finishes about ${clock(18, 30)}.`)).toBeInTheDocument();
  });

  it('pauses with the reason and the announcement in one request, then snoozes and closes', async () => {
    const { reload } = mount();
    await openSheet();
    await userEvent.click(screen.getByRole('button', { name: 'Pause and tell everyone' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(state.post).toHaveBeenCalledWith('/competitions/7/sessions/pause', {
      arenaName: undefined,
      reason: 'thunder',
      announcement: expect.stringContaining('stopping because of thunder'),
    });
    expect(reload).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('mg.weather.snooze.7') ?? '{}').thunder).toBeGreaterThan(at(17));
    expect(screen.queryByRole('button', { name: /Thunder likely/ })).toBeNull();
  });

  it('tells without pausing when the switch is off, and the draft follows the switch until it is edited', async () => {
    mount();
    await openSheet();
    await userEvent.click(screen.getByRole('switch', { name: 'Pause racing' }));
    const box = screen.getByRole('textbox', { name: 'Announcement' });
    expect((box as HTMLTextAreaElement).value).toContain('Racing carries on for now');
    expect(screen.queryByText(/If you start again/)).toBeNull();
    await userEvent.clear(box);
    await userEvent.type(box, 'Keep an eye on the sky');
    await userEvent.click(screen.getByRole('switch', { name: 'Pause racing' }));
    expect(box).toHaveValue('Keep an eye on the sky');
    await userEvent.click(screen.getByRole('switch', { name: 'Pause racing' }));
    await userEvent.click(screen.getByRole('button', { name: 'Tell everyone' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(state.post).toHaveBeenCalledTimes(1);
    expect(state.post).toHaveBeenCalledWith('/competitions/7/sessions/weather-notice', { body: 'Keep an eye on the sky' });
  });

  it('will not send an empty announcement', async () => {
    mount();
    await openSheet();
    await userEvent.clear(screen.getByRole('textbox', { name: 'Announcement' }));
    expect(screen.getByRole('button', { name: 'Pause and tell everyone' })).toBeDisabled();
  });

  it('keeps the sheet open and says so when the request fails, then lets the organiser try again', async () => {
    state.post.mockRejectedValueOnce(new Error('no signal'));
    mount();
    await openSheet();
    await userEvent.click(screen.getByRole('button', { name: 'Pause and tell everyone' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That didn’t go through');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Announcement' }), '!');
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Pause and tell everyone' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(state.post).toHaveBeenCalledTimes(2);
  });

  it('"Not now" hides the line for this storm and remembers it on this device', async () => {
    mount();
    await openSheet();
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(state.post).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
    expect(JSON.parse(localStorage.getItem('mg.weather.snooze.7') ?? '{}').thunder).toBeGreaterThan(0);
  });

  it('stays hidden after a reload of the page', () => {
    localStorage.setItem('mg.weather.snooze.7', JSON.stringify({ thunder: at(18) }));
    mount();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('starts rain with the switch off and an announcement that racing carries on', async () => {
    state.hours = rainAt(14, 15);
    mount();
    await userEvent.click(screen.getByRole('button', { name: /Heavy rain/ }));
    const sheet = screen.getByRole('dialog', { name: 'Heavy rain on the way' });
    expect(within(sheet).getByRole('switch', { name: 'Pause racing' })).not.toBeChecked();
    expect((within(sheet).getByRole('textbox', { name: 'Announcement' }) as HTMLTextAreaElement).value).toContain('Racing carries on unless we say otherwise');
    expect(within(sheet).getByRole('button', { name: 'Tell everyone' })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('switch', { name: 'Pause racing' }));
    expect((within(sheet).getByRole('textbox', { name: 'Announcement' }) as HTMLTextAreaElement).value).toContain('pausing for heavy rain');
  });

  it('describes a storm that is under way from now rather than from a time', async () => {
    state.hours = rainAt(13, 14);
    mount();
    await userEvent.click(screen.getByRole('button', { name: /Heavy rain now/ }));
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(new RegExp(`now, until about ${clock(15)}`));
  });

  it('lets the organiser pick one arena when there are several', async () => {
    mount({}, [race(1), race(2, { arenaName: 'Second Arena', scheduledStart: new Date(at(14, 30)).toISOString() })]);
    await openSheet();
    const row = screen.getByRole('button', { name: /Arenas/ });
    expect(row).toHaveTextContent('All arenas');
    await userEvent.click(row);
    await userEvent.click(screen.getByRole('radio', { name: 'Second Arena' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Arenas/ })).toHaveTextContent('Second Arena'));
    await userEvent.click(screen.getByRole('button', { name: 'Pause and tell everyone' }));
    await waitFor(() => expect(state.post).toHaveBeenCalled());
    expect(state.post.mock.calls[0][1]).toMatchObject({ arenaName: 'Second Arena', reason: 'thunder' });
  });

  it('hides the arena row when the switch is off', async () => {
    mount({}, [race(1), race(2, { arenaName: 'Second Arena' })]);
    await openSheet();
    await userEvent.click(screen.getByRole('switch', { name: 'Pause racing' }));
    expect(screen.queryByRole('button', { name: /Arenas/ })).toBeNull();
  });

  it('has no switch when every arena is already paused for another reason, and only tells everyone', async () => {
    mount({}, [race(1, { notes: `[paused:${at(13, 10)}]` })]);
    await openSheet();
    expect(screen.queryByRole('switch')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Tell everyone' }));
    await waitFor(() => expect(state.post).toHaveBeenCalledWith('/competitions/7/sessions/weather-notice', expect.anything()));
  });
});

describe('WeatherAlert: paused and all clear', () => {
  // Thunder in the 15:00 hour only, so it is over at 16:00 and clear from 16:30.
  beforeEach(() => { state.hours = thunderAt(15); });
  const pausedFor = (kind: string, minute = 10) => [race(1, { notes: `[paused:${at(14, minute)}] [pausefor:${kind}]` })];

  it('says racing is paused for thunder and promises to say when it is clear, without a way to tap it', () => {
    vi.setSystemTime(at(15, 20));
    mount({}, pausedFor('thunder'));
    expect(screen.getByRole('status')).toHaveTextContent('Paused for thunder. We’ll say when it’s clear');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('drops the promise when there is no forecast', () => {
    vi.setSystemTime(at(15, 20));
    state.hours = null;
    mount({}, pausedFor('rain'));
    expect(screen.getByRole('status')).toHaveTextContent(/^Paused for rain$/);
  });

  it('words a pause for rain', () => {
    vi.setSystemTime(at(15, 20));
    state.hours = rainAt(15);
    mount({}, pausedFor('rain'));
    expect(screen.getByRole('status')).toHaveTextContent('Paused for rain. We’ll say when it’s clear');
  });

  it('turns green with "Start again" once the storm has passed and the wait is over', () => {
    vi.setSystemTime(at(16, 45));
    const { container } = mount({}, pausedFor('thunder'));
    expect(screen.getByRole('button', { name: /No thunder since/ })).toHaveTextContent(`No thunder since ${clock(16)}Start again`);
    expect(container.querySelector('.mg-weather-bar-clear')).not.toBeNull();
  });

  it('says heavy rain when that was the reason', () => {
    vi.setSystemTime(at(16, 45));
    state.hours = rainAt(15);
    mount({}, pausedFor('rain'));
    expect(screen.getByRole('button', { name: /No heavy rain since/ })).toBeInTheDocument();
  });

  it('shows the paused line even for a pause note left from earlier, as long as it is an event day', () => {
    vi.setSystemTime(at(16, 45));
    state.hours = null;
    mount({}, pausedFor('thunder'));
    expect(screen.getByRole('status')).toHaveTextContent('Paused for thunder');
  });

  it('resumes and tells everyone from "Start again?", with the forecaster line', async () => {
    vi.setSystemTime(at(16, 45));
    const { reload } = mount({}, pausedFor('thunder'));
    await userEvent.click(screen.getByRole('button', { name: /No thunder since/ }));
    const sheet = screen.getByRole('dialog', { name: 'Start again?' });
    expect(sheet).toHaveAccessibleDescription(new RegExp(`last thunder was forecast for ${clock(16)}`));
    expect(within(sheet).getByText(/If you start again at .*, the last race finishes about/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Continue and tell everyone' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(state.post).toHaveBeenCalledWith('/competitions/7/sessions/resume', {
      arenaName: 'Main Arena',
      announcement: expect.stringContaining('Racing is starting again'),
    });
    expect(reload).toHaveBeenCalled();
  });

  it('explains rain in its own words', async () => {
    vi.setSystemTime(at(16, 45));
    state.hours = rainAt(15);
    mount({}, pausedFor('rain'));
    await userEvent.click(screen.getByRole('button', { name: /No heavy rain since/ }));
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(/heavy rain was forecast to stop/);
  });

  it('"Not yet" closes the sheet and leaves the line where it was', async () => {
    vi.setSystemTime(at(16, 45));
    mount({}, pausedFor('thunder'));
    await userEvent.click(screen.getByRole('button', { name: /No thunder since/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Not yet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(state.post).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /No thunder since/ })).toBeInTheDocument();
  });

  it('resumes each paused arena, and a retry after a failure does not announce twice', async () => {
    vi.setSystemTime(at(16, 45));
    const sessions = [
      race(1, { notes: `[paused:${at(14, 10)}] [pausefor:thunder]` }),
      race(2, { arenaName: 'Second Arena', notes: `[paused:${at(14, 10)}] [pausefor:thunder]` }),
    ];
    state.post.mockResolvedValueOnce({ data: [] }).mockRejectedValueOnce(new Error('no signal')).mockResolvedValue({ data: [] });
    mount({}, sessions);
    await userEvent.click(screen.getByRole('button', { name: /No thunder since/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue and tell everyone' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue and tell everyone' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const calls = state.post.mock.calls.map(([, body]) => body as { arenaName?: string; announcement?: string });
    // The retry goes over the arenas again (resuming an arena twice is harmless), but never repeats the announcement.
    expect(calls.map((c) => c.arenaName)).toEqual(['Main Arena', 'Second Arena', 'Main Arena', 'Second Arena']);
    expect(calls[0].announcement).toBeTruthy();
    expect(calls.slice(1).every((c) => c.announcement === undefined)).toBe(true);
  });

  it('resumes everything in one request when a paused session has no arena', async () => {
    vi.setSystemTime(at(16, 45));
    const sessions = [race(1, { arenaName: null, notes: `[paused:${at(14, 10)}] [pausefor:thunder]` }), race(2, { arenaName: 'Second Arena', notes: `[paused:${at(14, 10)}] [pausefor:thunder]` })];
    mount({}, sessions);
    await userEvent.click(screen.getByRole('button', { name: /No thunder since/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue and tell everyone' }));
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
    expect(state.post.mock.calls[0][1]).toMatchObject({ arenaName: undefined });
  });

  it('will not send an empty announcement when starting again', async () => {
    vi.setSystemTime(at(16, 45));
    mount({}, pausedFor('thunder'));
    await userEvent.click(screen.getByRole('button', { name: /No thunder since/ }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Announcement' }));
    expect(screen.getByRole('button', { name: 'Continue and tell everyone' })).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Announcement' }), 'Go');
    expect(screen.getByRole('button', { name: 'Continue and tell everyone' })).toBeEnabled();
  });
});

describe('WeatherAlert: the line goes with the page', () => {
  it('takes its line away when the page is left', () => {
    const view = mount();
    expect(screen.getByRole('status')).toBeInTheDocument();
    view.unmount();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
