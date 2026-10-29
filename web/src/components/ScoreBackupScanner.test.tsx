import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScoreBackupScanner } from './ScoreBackupScanner';
import { backupFrames } from '../offline/outboxRecovery';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('offers a file fallback without a supported detector and requests no camera permission', () => {
  vi.stubGlobal('BarcodeDetector', undefined);
  const getUserMedia = vi.fn(); vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  render(<ScoreBackupScanner onBackup={vi.fn()} />);
  fireEvent.click(screen.getByText('Scan backup QR codes'));
  expect(screen.getByText(/cannot scan QR/)).toBeInTheDocument(); expect(getUserMedia).not.toHaveBeenCalled();
});
it('reports a blocked camera', async () => {
  vi.stubGlobal('BarcodeDetector', class { detect = vi.fn(); });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error()) } });
  render(<ScoreBackupScanner onBackup={vi.fn()} />);
  fireEvent.click(screen.getByText('Scan backup QR codes'));
  expect(await screen.findByText(/Camera access was blocked/)).toBeInTheDocument();
});
it('collects frames and stops the camera after a complete scan', async () => {
  const raw = JSON.stringify({ scores: ['example'] });
  const detect = vi.fn().mockResolvedValue([{ rawValue: backupFrames(raw)[0] }]);
  vi.stubGlobal('BarcodeDetector', class { detect = detect; });
  const stop = vi.fn();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
  const onBackup = vi.fn();
  render(<ScoreBackupScanner onBackup={onBackup} />);
  fireEvent.click(screen.getByText('Scan backup QR codes'));
  await waitFor(() => expect(onBackup).toHaveBeenCalledWith(raw));
  expect(stop).toHaveBeenCalled();
  expect(screen.getByText('1 of 1 codes scanned')).toBeInTheDocument();
  act(() => fireEvent.click(screen.getByText('Clear scan')));
  expect(screen.queryByText('1 of 1 codes scanned')).toBeNull();
});
