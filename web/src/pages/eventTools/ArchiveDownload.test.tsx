import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchiveDownload } from './ArchiveDownload';

const archive = vi.hoisted(() => ({ fetch: vi.fn(), zip: vi.fn() }));
vi.mock('../../lib/eventArchive', async (original) => ({
  ...(await original<typeof import('../../lib/eventArchive')>()),
  fetchEventArchive: archive.fetch,
  createZipArchive: archive.zip,
}));

let click: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  archive.zip.mockReturnValue(new Uint8Array([80, 75]));
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:zip'), revokeObjectURL: vi.fn() });
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('ArchiveDownload', () => {
  it('zips the server’s files on the phone and downloads them under the server’s name', async () => {
    archive.fetch.mockResolvedValue({ competitionId: 4, competitionName: 'Spring Open', fileName: 'Spring_Open_archive.zip', generatedAt: '', files: { 'standings.csv': 'a,b' } });
    render(<ArchiveDownload competitionId={4} />);
    await userEvent.click(screen.getByRole('button', { name: /Download event archive/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(archive.fetch).toHaveBeenCalledWith(4);
    expect(archive.zip).toHaveBeenCalledWith({ 'standings.csv': 'a,b' });
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('Spring_Open_archive.zip');
  });

  it('names the file itself when the server gives no name', async () => {
    archive.fetch.mockResolvedValue({ competitionId: 4, competitionName: 'Spring Open', fileName: '', generatedAt: '', files: { 'a.csv': '1' } });
    render(<ArchiveDownload competitionId={4} />);
    await userEvent.click(screen.getByRole('button', { name: /Download event archive/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('Spring_Open_archive.zip');
  });

  it('says so when there is nothing to archive, or the request fails', async () => {
    archive.fetch.mockResolvedValueOnce({ competitionId: 4, competitionName: 'A', fileName: 'a.zip', generatedAt: '', files: {} });
    render(<ArchiveDownload competitionId={4} />);
    await userEvent.click(screen.getByRole('button', { name: /Download event archive/ }));
    expect(await screen.findByText('There’s nothing to archive yet.')).toBeInTheDocument();
    archive.fetch.mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getByRole('button', { name: /Download event archive/ }));
    expect(await screen.findByText('Couldn’t make the archive. Check your signal and try again.')).toBeInTheDocument();
    expect(click).not.toHaveBeenCalled();
  });

  it('shows that it is working while the archive is made', async () => {
    archive.fetch.mockReturnValue(new Promise(() => {}));
    render(<ArchiveDownload competitionId={4} />);
    await userEvent.click(screen.getByRole('button', { name: /Download event archive/ }));
    expect(screen.getByRole('button', { name: /Making the archive…/ })).toBeDisabled();
  });
});
