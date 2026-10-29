import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import { NativeLiveActivityCoordinator, activityChoice, chooseTeamActivity, refreshNativeActivity } from './NativeLiveActivityCoordinator';
const mock = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), end: vi.fn(), start: vi.fn(), update: vi.fn(), favourites: vi.fn(), ios: vi.fn(), restart: vi.fn() }));
vi.mock('../api', () => ({ api: { get: mock.get } }));
vi.mock('../lib/favourites', () => ({ FAVOURITES_CHANGED: 'mg:favourites', readFavourites: mock.favourites }));
vi.mock('./platform', () => ({ isIosApp: mock.ios }));
vi.mock('./liveActivity', () => ({ listTeamActivities: mock.list, endTeamActivity: mock.end, startTeamActivity: mock.start, updateTeamActivity: mock.update, needsRestart: mock.restart }));
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); mock.ios.mockReturnValue(true); mock.restart.mockReturnValue(false); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); mock.list.mockResolvedValue([]); mock.start.mockResolvedValue('activity-1'); mock.get.mockResolvedValue({ data: { progress: { status: 1 } } }); mock.favourites.mockReturnValue([{ competitionId: 1, teamId: 2 }]); });
it('starts only an explicitly chosen team and persists its native id', async () => { await chooseTeamActivity(1, 2, 'Example team'); expect(activityChoice()?.activityId).toBe('activity-1'); expect(mock.get).toHaveBeenCalledWith('/competitions/1/teams/2/progress'); });
it('respects dismissal and never restarts a missing activity', async () => { await chooseTeamActivity(1, 2, 'Example team'); mock.start.mockClear(); await refreshNativeActivity(); expect(activityChoice()).toBeNull(); expect(mock.start).not.toHaveBeenCalled(); });
it('unfollowing ends the chosen card outside FollowingTab', async () => { await chooseTeamActivity(1, 2, 'Example team'); mock.list.mockResolvedValue([{ activityId: 'activity-1' }]); mock.favourites.mockReturnValue([]); await refreshNativeActivity(); expect(mock.end).toHaveBeenCalledWith('activity-1'); expect(activityChoice()).toBeNull(); });
it('switching the chosen team ends the earlier card', async () => { await chooseTeamActivity(1, 2, 'Example team'); mock.list.mockResolvedValue([{ activityId: 'activity-1' }]); await chooseTeamActivity(1, 3, 'Other example'); expect(mock.end).toHaveBeenCalledWith('activity-1'); expect(activityChoice()?.teamId).toBe(3); });

afterEach(() => { vi.useRealTimers(); });
const key = 'mg.activity-choice.v1';
const choice = { competitionId: 1, teamId: 2, teamName: 'Example team', activityId: 'activity-1' };
function running() { localStorage.setItem(key, JSON.stringify(choice)); mock.list.mockResolvedValue([{ activityId: 'activity-1' }]); }
it.each(['not json', 'null', '3', '{}', '{"competitionId":"1","teamId":2,"teamName":"Example","activityId":"a"}'])('ignores corrupt or incomplete saved choices: %s', value => {
  localStorage.setItem(key, value); expect(activityChoice()).toBeNull();
});
it('tolerates unavailable storage while reading the choice', () => { vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); }); expect(activityChoice()).toBeNull(); });
it('switches the same team off and ends every old native card', async () => {
  running(); mock.list.mockResolvedValue([{ activityId: 'activity-1' }, { activityId: 'orphan' }]); await chooseTeamActivity(1, 2, 'Example team');
  expect(mock.end.mock.calls).toEqual([['activity-1'], ['orphan']]); expect(mock.start).not.toHaveBeenCalled(); expect(activityChoice()).toBeNull();
});
it('leaves no choice if the native layer declines a finished team', async () => { mock.start.mockResolvedValue(null); await chooseTeamActivity(1, 2, 'Example'); expect(activityChoice()).toBeNull(); });
it('ends a newly created card if persisting its opt-in fails', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage full'); });
  await expect(chooseTeamActivity(1, 2, 'Example')).rejects.toThrow('storage full'); expect(mock.end).toHaveBeenCalledWith('activity-1');
});
it('recovers the serial queue after a failed native request', async () => {
  mock.list.mockRejectedValueOnce(new Error('native unavailable')); await expect(chooseTeamActivity(1, 2, 'Example')).rejects.toThrow();
  await chooseTeamActivity(1, 2, 'Example'); expect(activityChoice()?.activityId).toBe('activity-1');
});
it('updates an active favourite without replacing its card', async () => { running(); await refreshNativeActivity(); expect(mock.update).toHaveBeenCalledWith('activity-1', { progress: { status: 1 } }); expect(mock.start).not.toHaveBeenCalled(); });
it.each(['activity-2', null])('restarts an ageing card only while the app is active: %s', async replacement => {
  running(); mock.restart.mockReturnValue(true); mock.start.mockResolvedValue(replacement); await refreshNativeActivity();
  expect(mock.end).toHaveBeenCalledWith('activity-1'); expect(mock.start).toHaveBeenCalledWith({ progress: { status: 1 } }, 'Example team');
  expect(activityChoice()?.activityId ?? null).toBe(replacement);
});
it('does not refresh without an opt-in, outside iOS, or in the background', async () => {
  await refreshNativeActivity(); expect(mock.list).not.toHaveBeenCalled(); running(); mock.ios.mockReturnValue(false); await refreshNativeActivity(); expect(mock.list).not.toHaveBeenCalled();
  mock.ios.mockReturnValue(true); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden'); await refreshNativeActivity(); expect(mock.list).not.toHaveBeenCalled();
});
it('refreshes on foreground events and a timer, recovers failures, and removes every listener on unmount', async () => {
  vi.useFakeTimers(); running(); const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const view = render(createElement(NativeLiveActivityCoordinator)); await act(async () => {}); expect(mock.update).toHaveBeenCalledTimes(1);
  for (const name of ['mg:favourites', 'mg:live-progress', 'online', 'focus']) await act(async () => { window.dispatchEvent(new Event(name)); });
  expect(mock.update).toHaveBeenCalledTimes(5);
  visibility.mockReturnValue('hidden'); await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(30_000); }); expect(mock.update).toHaveBeenCalledTimes(5);
  visibility.mockReturnValue('visible'); mock.get.mockRejectedValueOnce(new Error('offline')); await act(async () => { document.dispatchEvent(new Event('visibilitychange')); }); expect(mock.update).toHaveBeenCalledTimes(5);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); }); expect(mock.update).toHaveBeenCalledTimes(6);
  view.unmount(); expect(vi.getTimerCount()).toBe(0);
  await act(async () => { for (const name of ['mg:favourites', 'mg:live-progress', 'online', 'focus']) window.dispatchEvent(new Event(name)); document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(60_000); });
  expect(mock.update).toHaveBeenCalledTimes(6);
});
it('does not install timers or listeners in a browser', async () => {
  vi.useFakeTimers(); mock.ios.mockReturnValue(false); const view = render(createElement(NativeLiveActivityCoordinator)); await act(async () => { window.dispatchEvent(new Event('online')); });
  expect(mock.list).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); view.unmount();
});
