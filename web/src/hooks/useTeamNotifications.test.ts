import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { subscribeForPush, unsubscribeFromPush } from '../lib/push';
import { competition, heat, session, team } from '../test/factories';
import type { CompetitionDetail, Session, Team } from '../types';
import { useTeamNotifications } from './useTeamNotifications';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));
vi.mock('../lib/push', () => ({ subscribeForPush: vi.fn(), unsubscribeFromPush: vi.fn() }));
const get = vi.mocked(api.get);

const now = new Date('2026-06-01T10:00:00Z');
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
const clock = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const shown: { title: string; options?: NotificationOptions }[] = [];
class FakeNotification {
  static permission = 'granted';
  static failToShow = false;
  static requestPermission = vi.fn();
  constructor(title: string, options?: NotificationOptions) {
    if (FakeNotification.failToShow) throw new Error('permission changed');
    shown.push({ title, options });
  }
}

let competitions: Record<number, CompetitionDetail>;
const withSessions = (...sessions: Session[]) => { competitions = { 1: competition({ name: 'Spring Games', sessions }) }; };
const enable = () => localStorage.setItem('mg.notify.enabled', '1');
const myTeam = (extra: Partial<Team> = {}) => team(1, { competitionId: 1, relationship: 'trainer', displayName: 'Ashdown A', ...extra });

/** Mount the hook, let the competition load and the first check run. */
async function mount(teams: Team[] = [myTeam()]) {
  const view = renderHook(({ list }) => useTeamNotifications(list), { initialProps: { list: teams } });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return view;
}

beforeEach(() => {
  vi.useFakeTimers({ now });
  shown.length = 0;
  FakeNotification.permission = 'granted';
  FakeNotification.failToShow = false;
  FakeNotification.requestPermission = vi.fn().mockResolvedValue('granted');
  vi.stubGlobal('Notification', FakeNotification);
  vi.mocked(subscribeForPush).mockResolvedValue(true);
  vi.mocked(unsubscribeFromPush).mockResolvedValue(undefined);
  competitions = { 1: competition() };
  get.mockImplementation(async (url) => ({ data: competitions[Number(String(url).split('/').pop())] }));
});
afterEach(() => { vi.useRealTimers(); });

describe('useTeamNotifications: switching on and off', () => {
  it('starts off, and reports the browser’s permission', () => {
    FakeNotification.permission = 'default';
    const { result } = renderHook(() => useTeamNotifications([]));
    expect(result.current).toMatchObject({ enabled: false, permission: 'default' });
  });

  it('remembers that notifications were switched on', () => {
    enable();
    expect(renderHook(() => useTeamNotifications([])).result.current.enabled).toBe(true);
  });

  it('starts off when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(renderHook(() => useTeamNotifications([])).result.current.enabled).toBe(false);
  });

  it('reports "unsupported" when the browser has no notifications', () => {
    Reflect.deleteProperty(globalThis, 'Notification');
    expect(renderHook(() => useTeamNotifications([])).result.current.permission).toBe('unsupported');
  });

  it('asks permission, then enables and registers for push when allowed', async () => {
    FakeNotification.permission = 'default';
    const { result } = renderHook(() => useTeamNotifications([]));
    await act(async () => { await result.current.setEnabled(true); });
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ enabled: true, permission: 'granted' });
    expect(localStorage.getItem('mg.notify.enabled')).toBe('1');
    expect(subscribeForPush).toHaveBeenCalledTimes(1);
  });

  it('stays off when the user refuses permission', async () => {
    FakeNotification.permission = 'default';
    FakeNotification.requestPermission = vi.fn().mockResolvedValue('denied');
    const { result } = renderHook(() => useTeamNotifications([]));
    await act(async () => { await result.current.setEnabled(true); });
    expect(result.current).toMatchObject({ enabled: false, permission: 'denied' });
    expect(subscribeForPush).not.toHaveBeenCalled();
    expect(localStorage.getItem('mg.notify.enabled')).toBeNull();
  });

  it('does not ask again when permission was already granted', async () => {
    const { result } = renderHook(() => useTeamNotifications([]));
    await act(async () => { await result.current.setEnabled(true); });
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    expect(result.current.enabled).toBe(true);
  });

  it('tells the user when the browser cannot show notifications', async () => {
    Reflect.deleteProperty(globalThis, 'Notification');
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { result } = renderHook(() => useTeamNotifications([]));
    await act(async () => { await result.current.setEnabled(true); });
    expect(alertSpy).toHaveBeenCalledWith('Browser notifications are not supported here. Try a different browser.');
    expect(result.current.enabled).toBe(false);
  });

  it('switches off, forgets the setting and unregisters push', async () => {
    enable();
    const { result } = renderHook(() => useTeamNotifications([]));
    await act(async () => { await result.current.setEnabled(false); });
    expect(result.current.enabled).toBe(false);
    expect(localStorage.getItem('mg.notify.enabled')).toBeNull();
    expect(unsubscribeFromPush).toHaveBeenCalledTimes(1);
    expect(subscribeForPush).not.toHaveBeenCalled();
  });

  it('keeps working when the setting cannot be stored', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const { result } = renderHook(() => useTeamNotifications([]));
    await act(async () => { await result.current.setEnabled(true); });
    expect(result.current.enabled).toBe(true);
  });

  it('notices a permission change when the window regains focus', () => {
    FakeNotification.permission = 'default';
    const { result } = renderHook(() => useTeamNotifications([]));
    FakeNotification.permission = 'denied';
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(result.current.permission).toBe('denied');
  });
});

describe('useTeamNotifications: loading competitions', () => {
  it('loads nothing while switched off or without teams', async () => {
    await mount([myTeam()]);
    enable();
    await mount([]);
    expect(get).not.toHaveBeenCalled();
  });

  it('loads each competition once, even with several teams in it', async () => {
    enable();
    competitions = { 1: competition({ id: 1 }), 2: competition({ id: 2 }) };
    await mount([myTeam(), team(2, { competitionId: 1 }), team(3, { competitionId: 2 })]);
    expect(get.mock.calls.map(([url]) => url).sort()).toEqual(['/competitions/1', '/competitions/2']);
  });

  it('refreshes every minute', async () => {
    enable();
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('refreshes when the page becomes visible or the phone comes online', async () => {
    enable();
    await mount();
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('skips the refresh while the page is hidden or the phone is offline', async () => {
    enable();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await mount();
    expect(get).not.toHaveBeenCalled();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(get).not.toHaveBeenCalled();
  });

  it('ignores a competition that fails to load and keeps the others', async () => {
    enable();
    withSessions(session(1, { scheduledStart: at(58) }));
    get.mockImplementation(async (url) => {
      if (String(url).endsWith('/2')) throw new Error('offline');
      return { data: competitions[1] };
    });
    await mount([myTeam(), team(2, { competitionId: 2 })]);
    expect(shown).toHaveLength(1);
  });

  it('stops refreshing and ignores late answers after unmounting', async () => {
    enable();
    let answer!: (value: { data: CompetitionDetail }) => void;
    get.mockImplementation(() => new Promise((resolve) => { answer = resolve as typeof answer; }));
    withSessions(session(1, { scheduledStart: at(58) }));
    const { unmount } = await mount();
    unmount();
    answer({ data: competitions[1] });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(get).toHaveBeenCalledTimes(1);
    expect(shown).toHaveLength(0);
  });
});

describe('useTeamNotifications: what it announces', () => {
  const ready = async (sessions: Session[], teams: Team[] = [myTeam()]) => {
    enable();
    withSessions(...sessions);
    return mount(teams);
  };

  it('says an hour is to go when a team’s session is 55 to 60 minutes away', async () => {
    await ready([session(1, { name: 'Seniors heats', scheduledStart: at(58) })]);
    expect(shown).toEqual([{ title: 'Ashdown A — 1 hour to go', options: { body: `Seniors heats starts at ${clock(58)} (Spring Games).`, tag: '1h:1:1' } }]);
  });

  it('includes the lane number and hatband/silk colour in the session reminder when assigned', async () => {
    enable();
    competitions = {
      1: competition({
        name: 'Spring Games',
        laneHatbands: ['White', 'Red', 'Yellow'],
        sessions: [
          session(1, {
            name: 'Seniors heats',
            scheduledStart: at(58),
            heats: [heat(10, { entries: [{ id: 1, laneIndex: 2, teamId: 1, teamName: 'Ashdown A' }] })],
          }),
        ],
      }),
    };
    await mount([myTeam()]);
    expect(shown).toEqual([{
      title: 'Ashdown A — 1 hour to go',
      options: {
        body: `Seniors heats starts at ${clock(58)} · Lane 2 (Red hatband/silk) (Spring Games).`,
        tag: '1h:1:1',
      },
    }]);
  });

  it('notifies immediately when a team is drawn into a Final with time, lane and hatband/silk colour', async () => {
    enable();
    competitions = {
      1: competition({
        name: 'Spring Games',
        laneHatbands: ['White', 'Red', 'Yellow'],
        sessions: [
          session(1, {
            name: 'Seniors Finals',
            scheduledStart: at(120),
            heats: [
              heat(21, {
                label: 'A Final',
                raceRoundStage: 2,
                entries: [
                  { id: 1, laneIndex: 3, teamId: 1, teamName: 'Ashdown A' },
                  { id: 2, laneIndex: 1, teamId: 9, teamName: 'Other Team' },
                ],
              }),
              heat(22, {
                label: 'B Final',
                raceRoundStage: 2,
                entries: [{ id: 3, laneIndex: 1, teamId: 8, teamName: 'Third Team' }],
              }),
            ],
          }),
        ],
      }),
    };
    await mount([myTeam()]);
    expect(shown).toEqual([{
      title: 'Ashdown A — A Final',
      options: {
        body: `A Final at ${clock(120)} · Lane 3 (Yellow hatband/silk) (Spring Games).`,
        tag: 'final-draw:21:1:3',
      },
    }]);
  });

  it('notifies for a Final draw without hatbands or scheduled time when omitted', async () => {
    enable();
    competitions = {
      1: competition({
        name: 'Spring Games',
        laneHatbands: null,
        sessions: [
          session(1, {
            name: 'Open Finals',
            heats: [
              heat(31, {
                label: '',
                entries: [{ id: 1, laneIndex: 4, teamId: 1, teamName: 'Ashdown A' }],
              }),
            ],
          }),
        ],
      }),
    };
    await mount([myTeam()]);
    expect(shown).toEqual([{
      title: 'Ashdown A — Open Finals',
      options: {
        body: 'Open Finals · Lane 4 (Spring Games).',
        tag: 'final-draw:31:1:4',
      },
    }]);
  });

  it.each([[61], [55], [30], [-5]])('stays quiet for a race starting in %i minutes', async (minutes) => {
    await ready([session(1, { scheduledStart: at(minutes) })]);
    expect(shown).toEqual([]);
  });

  it('fires at exactly an hour before', async () => {
    await ready([session(1, { scheduledStart: at(60) })]);
    expect(shown).toHaveLength(1);
  });

  it('tells supporters they are supporting the team', async () => {
    await ready([session(1, { scheduledStart: at(58) })], [myTeam({ relationship: 'supporter' })]);
    expect(shown[0].title).toBe('Supporting Ashdown A — 1 hour to go');
  });

  it('announces a briefing 25 to 30 minutes ahead for each team', async () => {
    await ready([session(1, { kind: 2, name: 'Riders briefing', scheduledStart: at(28) })], [myTeam(), team(2, { competitionId: 1, displayName: 'Ashdown B', relationship: 'supporter' })]);
    expect(shown.map((n) => n.title)).toEqual(['Briefing in 30 minutes', 'Briefing in 30 minutes']);
    expect(shown[0].options).toEqual({ body: 'Riders briefing — Spring Games (Ashdown A)', tag: 'briefing:1:1' });
    expect(shown[1].options!.body).toBe('Riders briefing — Spring Games (Supporting Ashdown B)');
  });

  it('does not announce a race an hour ahead as a briefing, or a briefing an hour ahead', async () => {
    await ready([session(1, { orderIndex: 1, scheduledStart: at(28) }), session(2, { orderIndex: 2, kind: 2, scheduledStart: at(58) })]);
    expect(shown).toEqual([]);
  });

  it('ignores breaks, custom items, finished sessions and sessions with no time', async () => {
    await ready([
      session(1, { kind: 1, scheduledStart: at(58) }),
      session(2, { orderIndex: 2, kind: 3, scheduledStart: at(58) }),
      session(3, { orderIndex: 3, status: 2, scheduledStart: at(58) }),
      session(4, { orderIndex: 4 }),
    ]);
    expect(shown).toEqual([]);
  });

  it('treats a legacy break flag as a break', async () => {
    await ready([{ ...session(1, { isBreak: true, scheduledStart: at(58) }), kind: undefined } as unknown as Session]);
    expect(shown).toEqual([]);
  });

  it('announces a legacy race with no kind', async () => {
    await ready([{ ...session(1, { scheduledStart: at(58) }), kind: undefined } as unknown as Session]);
    expect(shown).toHaveLength(1);
  });

  it('says the schedule is running behind, in ten minute steps from fifteen', async () => {
    const slipped = (minutes: number) => session(1, { status: 1, scheduledStart: at(-60), startedAt: at(-60 + minutes), heats: [heat(1)] });
    await ready([slipped(20)]);
    expect(shown).toEqual([{ title: 'Spring Games running behind', options: { body: `Session 1 now expected at ${clock(-40)} (15+ min behind). Ashdown A.`, tag: 'shift:1:15:1' } }]);
  });

  it.each([[14, 0], [15, 15], [24, 15], [25, 25], [37, 35]])('slipping %i minutes announces bucket %i', async (minutes, bucket) => {
    const { unmount } = await ready([session(1, { status: 1, scheduledStart: at(-60), startedAt: at(-60 + minutes) })]);
    expect(shown.map((n) => n.options?.tag)).toEqual(bucket ? [`shift:1:${bucket}:1`] : []);
    unmount();
  });

  it('says the schedule is running ahead when a session started early', async () => {
    await ready([session(1, { status: 1, scheduledStart: at(-30), startedAt: at(-50) })]);
    expect(shown[0].title).toBe('Spring Games running ahead');
    expect(shown[0].options!.body).toContain('(15+ min ahead)');
  });

  it('announces each thing once, however many times it checks', async () => {
    await ready([session(1, { scheduledStart: at(58) })]);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(shown).toHaveLength(1);
  });

  it('checks again every 30 seconds and catches a window it has just entered', async () => {
    await ready([session(1, { scheduledStart: at(61) })]);
    expect(shown).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(shown).toHaveLength(1);
  });

  it('does not check when notifications are not permitted', async () => {
    FakeNotification.permission = 'denied';
    await ready([session(1, { scheduledStart: at(58) })]);
    expect(shown).toEqual([]);
  });

  it('skips a team whose competition has not loaded', async () => {
    enable();
    withSessions(session(1, { scheduledStart: at(58) }));
    await mount([team(5, { competitionId: 99 })]);
    expect(shown).toEqual([]);
  });

  it('still shows a notification when the record of what it has shown cannot be kept', async () => {
    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(this: Storage, key: string, value: string) {
      if (key.startsWith('mg.notify.fired:')) throw new Error('quota');
      realSet.call(this, key, value);
    });
    await ready([session(1, { scheduledStart: at(58) })]);
    expect(shown).toHaveLength(1);
  });

  it('shows a notification even when the record cannot be read', async () => {
    const realGet = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function getItem(this: Storage, key: string) {
      if (key.startsWith('mg.notify.fired:')) throw new Error('blocked');
      return realGet.call(this, key);
    });
    await ready([session(1, { scheduledStart: at(58) })]);
    expect(shown).toHaveLength(1);
  });

  it('carries on if the browser refuses to show a notification', async () => {
    FakeNotification.failToShow = true;
    await ready([session(1, { scheduledStart: at(58) })]);
    expect(shown).toEqual([]);
  });

  it('stops checking once switched off', async () => {
    const view = await ready([session(1, { scheduledStart: at(61) })]);
    await act(async () => { await view.result.current.setEnabled(false); });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(shown).toEqual([]);
  });
});
