import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LiveActivityChoice } from './LiveActivityChoice';
const mock = vi.hoisted(() => ({ ios: vi.fn(), enabled: vi.fn(), get: vi.fn(), choose: vi.fn(), choice: vi.fn(), t: (key: string) => key }));
vi.mock('../api', () => ({ api: { get: mock.get } }));
vi.mock('../i18n/LanguageContext', () => ({ useT: () => mock.t }));
vi.mock('./platform', () => ({ isIosApp: mock.ios }));
vi.mock('./liveActivity', () => ({ liveActivitiesEnabled: mock.enabled }));
vi.mock('./NativeLiveActivityCoordinator', () => ({ ACTIVITY_CHANGED: 'mg:activity-choice', activityChoice: mock.choice, chooseTeamActivity: mock.choose }));
const selected = { competitionId: 1, teamId: 2, teamName: 'Example team', activityId: 'example' };
const show = () => render(<LiveActivityChoice competitionId={1} teamId={2} teamName="Example team" />);
beforeEach(() => { mock.ios.mockReturnValue(true); mock.enabled.mockResolvedValue(true); mock.get.mockResolvedValue({ data: { liveActivities: true } }); mock.choose.mockResolvedValue(undefined); mock.choice.mockReturnValue(null); });
it('does not request native or server availability in a browser', () => {
  mock.ios.mockReturnValue(false); show();
  expect(screen.queryByRole('switch')).toBeNull(); expect(mock.enabled).not.toHaveBeenCalled(); expect(mock.get).not.toHaveBeenCalled();
});
it.each([[false, true], [true, false]])('requires both device permission (%s) and server availability (%s)', async (device, server) => {
  mock.enabled.mockResolvedValue(device); mock.get.mockResolvedValue({ data: { liveActivities: server } });
  await act(async () => { show(); }); expect(screen.queryByRole('switch')).toBeNull();
});
it('keeps the choice hidden when availability fails', async () => {
  mock.get.mockRejectedValue(new Error('offline')); await act(async () => { show(); }); expect(screen.queryByRole('switch')).toBeNull();
});
it('reflects a chosen team, then refreshes when another screen changes the choice', async () => {
  mock.choice.mockReturnValue(selected); const view = show();
  expect(await screen.findByRole('switch')).toHaveAttribute('aria-checked', 'true'); expect(screen.getByText('apple.activity.expiry')).toBeTruthy();
  mock.choice.mockReturnValue({ ...selected, teamId: 3 }); act(() => { window.dispatchEvent(new Event('mg:activity-choice')); });
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'); expect(screen.queryByText('apple.activity.expiry')).toBeNull();
  const calls = mock.choice.mock.calls.length; view.unmount(); window.dispatchEvent(new Event('mg:activity-choice')); expect(mock.choice).toHaveBeenCalledTimes(calls);
});
it('waits for the native choice, surfaces a failure and allows retry', async () => {
  let reject!: (error: Error) => void; mock.choose.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })); show();
  fireEvent.click(await screen.findByRole('switch')); expect(screen.getByRole('switch')).toBeDisabled();
  expect(mock.choose).toHaveBeenCalledWith(1, 2, 'Example team');
  await act(async () => { reject(new Error('denied')); }); expect(screen.getByText('apple.activity.error')).toBeTruthy(); expect(screen.getByRole('switch')).toBeEnabled();
  fireEvent.click(screen.getByRole('switch')); await waitFor(() => expect(mock.choose).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('apple.activity.error')).toBeNull();
});
it('ignores an availability response after the control is unmounted', async () => {
  let resolve!: (value: { data: { liveActivities: boolean } }) => void;
  mock.get.mockImplementation(() => new Promise(done => { resolve = done; })); const view = show(); view.unmount();
  await act(async () => { resolve({ data: { liveActivities: true } }); }); expect(screen.queryByRole('switch')).toBeNull();
});
