import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scorerApi, readScorerAngle, readScorerToken, readSavedScorerSession, writeScorerAngle, writeScorerToken } from '../offline/scorerLink';
import { QrPermissionScannerModal } from './QrPermissionScannerModal';
const session = { label: 'Test camera', competitionId: 4, competitionName: 'Test event', arenaName: 'Main', scope: 1, sessions: [] };
const close = vi.fn(), navigate = vi.fn(), verified = vi.fn();
const token = 'mgs_test_permission';
const mount = (open = true) => render(<QrPermissionScannerModal open={open} onClose={close} onNavigate={navigate} onScorerVerified={verified} />);
function submit(value: string) {
  fireEvent.change(screen.getByLabelText('Permission link or key'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify permission key' }));
}
function camera(getUserMedia: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
}
function detector(detect: ReturnType<typeof vi.fn>) { vi.stubGlobal('BarcodeDetector', class { detect = detect; }); }
const upload = () => fireEvent.change(screen.getByLabelText('Upload QR code image'), { target: { files: [new File(['x'], 'test.png')] } });
beforeEach(() => {
  close.mockReset(); navigate.mockReset(); verified.mockReset();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  vi.spyOn(scorerApi, 'get').mockResolvedValue({ data: session });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('permission QR verification', () => {
  it('opens above the app as a sheet and dismisses on Escape', async () => {
    const view = mount();
    const dialog = screen.getByRole('dialog', { name: 'Scan the QR code' });
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveClass('kit-sheet');
    expect(dialog).toHaveAccessibleDescription('Point the camera at the scoring or camera QR code from your organiser.');
    expect(screen.getByText('Upload a photo')).toBeInTheDocument();
    // With no camera the notice carries the Paste the link action instead.
    expect(screen.getByRole('status')).toHaveTextContent('This browser can’t use the camera');
    expect(screen.getAllByRole('button', { name: 'Paste the link' })).toHaveLength(1);
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    view.unmount();
    expect(document.body).not.toContainElement(dialog);
  });
  it('does not request the camera while closed', () => {
    const getUserMedia = vi.fn(); camera(getUserMedia); mount(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(getUserMedia).not.toHaveBeenCalled();
  });
  it.each([token, `#t=${token}`, `/score#t=${token}`, `https://example.test/score/?t=${token}`])('verifies %s before storing or opening it', async (value) => {
    mount(); submit(value);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/score#t=${token}`));
    expect(scorerApi.get).toHaveBeenCalledWith('/scorer/session', { headers: { 'X-Scorer-Token': token } });
    expect(readScorerToken()).toBe(token); expect(readSavedScorerSession()).toMatchObject(session);
    expect(verified).toHaveBeenCalledWith(token, expect.objectContaining(session)); expect(close).toHaveBeenCalled();
  });
  it.each([`https://example.test/score#t=${token}&angle=Finish%20line`, `#t=${token}&angle=Finish%20line`])('keeps the camera position a camera link carries (%s)', async (value) => {
    writeScorerAngle('Old spot');
    mount(); submit(value);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/score#t=${token}&angle=Finish%20line`));
    expect(readScorerAngle()).toBe('Finish line');
  });
  it('forgets an old camera position when the new link has none', async () => {
    writeScorerAngle('Old spot');
    mount(); submit(`/score#t=${token}`);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/score#t=${token}`));
    expect(readScorerAngle()).toBeNull();
  });
  it.each(['#t=', 'unknown', '/score', '/score?t=bad', '/competitions/4/broadcast?pair=abcdefghijklmnop', 'javascript:alert(1)', 'ftp://example.test/score#t=mgs_bad', 'https://user:pass@example.test/score#t=mgs_bad', 'http://[invalid', '/elsewhere#t=mgs_bad', `mgs_${'a'.repeat(61)}`])('rejects unsupported or malformed permission %s', async (value) => {
    mount(); submit(value);
    expect(await screen.findByRole('alert')).toHaveTextContent('That QR code isn’t a scoring or camera code');
    expect(scorerApi.get).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
  });
  it.each([null, '<html>bad gateway</html>', { competitionId: 4 }])('refuses an invalid server response', async (data) => {
    vi.mocked(scorerApi.get).mockResolvedValue({ data }); mount(); submit(token);
    expect(await screen.findByRole('alert')).toHaveTextContent('That QR code isn’t a scoring or camera code, or it has stopped working. Ask the organiser for a new one.'); expect(readScorerToken()).toBeNull();
  });
  it('keeps the signed-in account and previous permission after a rejected token', async () => {
    localStorage.setItem('mg.auth', 'existing-account'); writeScorerToken('mgs_existing');
    vi.mocked(scorerApi.get).mockRejectedValue({ response: { status: 401 } }); mount(); submit(token);
    expect(await screen.findByRole('alert')).toHaveTextContent('That QR code isn’t a scoring or camera code, or it has stopped working. Ask the organiser for a new one.');
    expect(localStorage.getItem('mg.auth')).toBe('existing-account'); expect(readScorerToken()).toBe('mgs_existing');
  });
  it('ignores verification completed after closing', async () => {
    let resolve!: (value: { data: typeof session }) => void;
    vi.mocked(scorerApi.get).mockReturnValue(new Promise((r) => { resolve = r; }));
    const view = mount(); submit(token); expect(screen.getByRole('button', { name: 'Verifying key…' })).toBeDisabled();
    view.unmount(); await act(async () => resolve({ data: session }));
    expect(navigate).not.toHaveBeenCalled(); expect(readScorerToken()).toBeNull();
  });
  it('does not send duplicate requests while verification is pending', async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(scorerApi.get).mockReturnValue(new Promise((_resolve, no) => { reject = no; }));
    const view = mount(); submit(token);
    fireEvent.submit(screen.getByLabelText('Permission link or key').closest('form')!);
    expect(scorerApi.get).toHaveBeenCalledTimes(1);
    view.unmount(); await act(async () => reject(new Error('late failure')));
    expect(navigate).not.toHaveBeenCalled();
  });
  it('rejects an empty form submission without making a request', () => {
    mount(); fireEvent.submit(screen.getByLabelText('Permission link or key').closest('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent('That QR code isn’t a scoring or camera code');
    expect(scorerApi.get).not.toHaveBeenCalled();
  });
  it('uses browser navigation when the host does not provide a router callback', async () => {
    const assign = vi.fn(); const browserWindow = window;
    vi.stubGlobal('window', new Proxy(browserWindow, { get(target, key) {
      return key === 'location' ? { origin: 'https://example.test', assign } : Reflect.get(target, key);
    } }));
    render(<QrPermissionScannerModal open onClose={close} />); submit(token);
    await waitFor(() => expect(assign).toHaveBeenCalledWith(`/score#t=${token}`));
    expect(close).toHaveBeenCalled();
  });
  it('closes only on the close button or backdrop', async () => {
    const view = mount(); fireEvent.click(screen.getByRole('heading')); expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close QR scanner' }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    view.unmount();
    mount();
    fireEvent.click(screen.getByRole('dialog'));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(2));
  });
});
describe('camera and photo scanning', () => {
  it('shows camera errors and leaves manual entry available', async () => {
    camera(vi.fn().mockRejectedValue(new Error('denied'))); mount();
    expect(await screen.findByText(/The camera is blocked/)).toBeInTheDocument(); expect(screen.getByLabelText('Permission link or key')).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Paste the link' }));
    expect(screen.getByLabelText('Permission link or key')).toHaveFocus();
  });
  it('lets the Paste the link pill jump to the field while the camera is running', async () => {
    camera(vi.fn().mockResolvedValue({ getTracks: () => [] }));
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Paste the link' }));
    expect(screen.getByLabelText('Permission link or key')).toHaveFocus();
  });
  it('stops a camera that arrives after closing', async () => {
    const stop = vi.fn(); let resolve!: (stream: unknown) => void;
    camera(vi.fn().mockReturnValue(new Promise((r) => { resolve = r; })));
    const view = mount(); view.unmount(); await act(async () => resolve({ getTracks: () => [{ stop }] })); expect(stop).toHaveBeenCalled();
  });
  it('scans camera frames and stops every track on closing', async () => {
    vi.useFakeTimers(); const stop = vi.fn(); camera(vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }));
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(); detector(vi.fn().mockResolvedValue([{ rawValue: `/score#t=${token}` }]));
    const view = mount(); Object.defineProperty(screen.getByLabelText('QR code camera scanner'), 'readyState', { value: 2 });
    await act(async () => { await vi.advanceTimersByTimeAsync(301); });
    expect(navigate).toHaveBeenCalledWith(`/score#t=${token}`); view.unmount(); expect(stop).toHaveBeenCalled();
  });
  it('keeps manual entry usable without live detection even when video playback is rejected', async () => {
    const stop = vi.fn(); camera(vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }));
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('play blocked'));
    const view = mount(); await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    expect(screen.getByLabelText('Permission link or key')).toBeEnabled(); view.unmount(); expect(stop).toHaveBeenCalled();
  });
  it('ignores early frames and transient detector errors, then resumes scanning', async () => {
    vi.useFakeTimers(); camera(vi.fn().mockResolvedValue({ getTracks: () => [] }));
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const detect = vi.fn().mockRejectedValueOnce(new Error('frame')).mockResolvedValueOnce([]).mockResolvedValue([{ rawValue: token }]); detector(detect);
    mount(); const video = screen.getByLabelText('QR code camera scanner');
    await act(async () => { await vi.advanceTimersByTimeAsync(301); }); expect(detect).not.toHaveBeenCalled();
    Object.defineProperty(video, 'readyState', { value: 2 });
    await act(async () => { await vi.advanceTimersByTimeAsync(901); });
    expect(navigate).toHaveBeenCalledWith(`/score#t=${token}`);
  });
  it('does not verify a camera frame decoded after closing', async () => {
    vi.useFakeTimers(); camera(vi.fn().mockResolvedValue({ getTracks: () => [] }));
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    let resolve!: (codes: { rawValue: string }[]) => void;
    const detect = vi.fn().mockReturnValue(new Promise((done) => { resolve = done; })); detector(detect);
    const view = mount(); Object.defineProperty(screen.getByLabelText('QR code camera scanner'), 'readyState', { value: 2 });
    await act(async () => { await vi.advanceTimersByTimeAsync(301); }); view.unmount();
    await act(async () => resolve([{ rawValue: token }])); expect(scorerApi.get).not.toHaveBeenCalled();
  });
  it('explains when photo decoding is unsupported', () => {
    mount(); upload(); expect(screen.getByRole('alert')).toHaveTextContent('can’t read QR photos');
  });
  it.each([{ codes: [] }, { codes: [{ rawValue: '   ' }] }, { codes: [{ rawValue: `/score#t=${token}` }] }])('decodes a photo and releases its bitmap', async ({ codes }) => {
    const release = vi.fn(); vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ close: release }));
    detector(vi.fn().mockResolvedValue(codes)); mount(); upload(); await waitFor(() => expect(release).toHaveBeenCalled());
    if (codes[0]?.rawValue.trim()) expect(navigate).toHaveBeenCalled(); else expect(screen.getByRole('alert')).toHaveTextContent('no QR code in that photo');
  });
  it('ignores a cancelled file chooser and handles a detector that cannot start', () => {
    vi.stubGlobal('BarcodeDetector', class { constructor() { throw new Error('unsupported'); } });
    mount(); fireEvent.change(screen.getByLabelText('Upload QR code image'), { target: { files: [] } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    upload(); expect(screen.getByRole('alert')).toHaveTextContent('can’t read QR photos');
  });
  it('releases a photo decoded after the dialog closes without saving permission', async () => {
    let resolve!: (codes: { rawValue: string }[]) => void;
    const release = vi.fn(); vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ close: release }));
    const detect = vi.fn().mockReturnValue(new Promise((done) => { resolve = done; })); detector(detect);
    const view = mount(); upload(); await waitFor(() => expect(detect).toHaveBeenCalled()); view.unmount();
    await act(async () => resolve([{ rawValue: token }]));
    expect(release).toHaveBeenCalled(); expect(scorerApi.get).not.toHaveBeenCalled();
  });
  it('reports unreadable photos', async () => {
    detector(vi.fn()); vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('bad image'))); mount(); upload();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t read that photo');
  });
});
