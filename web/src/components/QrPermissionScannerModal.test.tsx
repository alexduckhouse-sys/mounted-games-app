import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { QrPermissionScannerModal } from './QrPermissionScannerModal';

vi.mock('../api', () => ({
  api: { get: vi.fn() },
}));

describe('QrPermissionScannerModal', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when closed and portals a full-screen top-layer <dialog> to document.body when open', () => {
    const onClose = vi.fn();
    const { container, rerender } = render(
      <div className="w-[20rem]" data-testid="sidebar-wrapper">
        <QrPermissionScannerModal open={false} onClose={onClose} />
      </div>,
    );
    expect(screen.queryByRole('dialog', { name: 'Scan permission QR code' })).toBeNull();

    rerender(
      <div className="w-[20rem]" data-testid="sidebar-wrapper">
        <QrPermissionScannerModal open={true} onClose={onClose} />
      </div>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Scan permission QR code' });
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog).toHaveAttribute('open');
    expect(dialog.parentElement).toBe(document.body);
    expect(container.querySelector('dialog')).toBeNull();
    expect(dialog).toHaveClass('fixed', 'inset-0', 'h-dvh', 'w-screen', 'max-w-none', 'max-h-none');

    // Clicking backdrop or cancel event closes the modal
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);

    const cancelEvent = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancelEvent);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('verifies a pasted scorer key, hash or /score URL and navigates to /score, or navigates directly for broadcast pairing', async () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    const onScorerVerified = vi.fn();
    vi.mocked(api.get).mockResolvedValue({
      data: {
        competitionId: 9,
        competitionName: 'Summer Nationals',
        label: 'Arena 1',
        arenaName: 'Arena 1',
        sessions: [],
      },
    });

    render(
      <QrPermissionScannerModal
        open={true}
        onClose={onClose}
        onNavigate={onNavigate}
        onScorerVerified={onScorerVerified}
      />,
    );

    const input = screen.getByLabelText('Permission link or key');
    for (const bad of ['invalid://link', '#t=short', '/score', '/competitions/12/broadcast?pair=short', 'https://example.com/other']) {
      fireEvent.change(input, { target: { value: bad } });
      await userEvent.click(screen.getByRole('button', { name: 'Verify permission key' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Invalid permission QR code');
    }

    fireEvent.change(input, { target: { value: 'mgs_valid_token_123' } });
    await userEvent.click(screen.getByRole('button', { name: 'Verify permission key' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/scorer/session', {
        headers: { 'X-Scorer-Token': 'mgs_valid_token_123' },
      });
    });
    expect(onScorerVerified).toHaveBeenCalledWith(
      'mgs_valid_token_123',
      expect.objectContaining({ competitionId: 9, competitionName: 'Summer Nationals' }),
    );
    expect(onClose).toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith('/score#t=mgs_valid_token_123');

    fireEvent.change(input, { target: { value: '#t=mgs_hash_token_123' } });
    await userEvent.click(screen.getByRole('button', { name: 'Verify permission key' }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/score#t=mgs_hash_token_123'));

    fireEvent.change(input, { target: { value: '/score/?t=mgs_query_token_123' } });
    await userEvent.click(screen.getByRole('button', { name: 'Verify permission key' }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/score#t=mgs_query_token_123'));

    // Broadcast pairing URL
    fireEvent.change(input, { target: { value: '/competitions/14/broadcast?pair=pair_secret_1234567890' } });
    await userEvent.click(screen.getByRole('button', { name: 'Verify permission key' }));
    expect(onNavigate).toHaveBeenCalledWith('/competitions/14/broadcast?pair=pair_secret_1234567890');
  });

  it('shows an error when the scorer token is rejected or returns an invalid session payload', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { invalid: true } });
    render(<QrPermissionScannerModal open={true} onClose={vi.fn()} onNavigate={vi.fn()} />);

    const input = screen.getByLabelText('Permission link or key');
    await userEvent.type(input, 'mgs_bad_payload_123');
    await userEvent.click(screen.getByRole('button', { name: 'Verify permission key' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid or expired permission key');

    vi.mocked(api.get).mockRejectedValueOnce(new Error('401'));
    await userEvent.click(screen.getByRole('button', { name: 'Verify permission key' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid or expired permission key');
  });

  it('scans from camera stream and decodes uploaded QR images when BarcodeDetector is available', async () => {
    const stopTrack = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: stopTrack }],
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
      writable: true,
    });
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      get: () => 4,
      configurable: true,
    });

    const detect = vi.fn().mockResolvedValue([{ rawValue: '/competitions/7/broadcast?pair=pair_camera_1234567890' }]);
    class FakeBarcodeDetector {
      detect = detect;
    }
    vi.stubGlobal('BarcodeDetector', FakeBarcodeDetector);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({}));

    const onClose = vi.fn();
    const onNavigate = vi.fn();
    const { unmount } = render(
      <QrPermissionScannerModal open={true} onClose={onClose} onNavigate={onNavigate} />,
    );

    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith('/competitions/7/broadcast?pair=pair_camera_1234567890');
    });

    const fileInput = screen.getByLabelText('Upload QR code image');
    const file = new File(['qr'], 'qr.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith('/competitions/7/broadcast?pair=pair_camera_1234567890');
    });

    // Empty QR detection result on image upload
    detect.mockResolvedValueOnce([]);
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('No QR code was found in that image');

    // Detection throw on image upload
    detect.mockRejectedValueOnce(new Error('decode error'));
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read that QR image');

    unmount();
    expect(stopTrack).toHaveBeenCalled();
  });

  it('handles camera permission denial and unsupported image decoding gracefully', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
      writable: true,
    });

    render(<QrPermissionScannerModal open={true} onClose={vi.fn()} onNavigate={vi.fn()} />);
    expect(await screen.findByText(/Camera permission was declined/)).toBeInTheDocument();

    const fileInput = screen.getByLabelText('Upload QR code image');
    const file = new File(['qr'], 'qr.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('QR image decoding is not supported');
  });
});
