import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import * as csv from '../../lib/csv';
import { EmailOptInExportSection } from './EmailOptInExportSection';

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

beforeEach(() => {
  vi.spyOn(csv, 'downloadCsv').mockImplementation(() => {});
});

describe('EmailOptInExportSection', () => {
  it('downloads the list as a CSV file', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: 'Email\r\nparent@example.org' });
    render(<EmailOptInExportSection />);

    await userEvent.click(screen.getByRole('button', { name: /Download opt-in list/ }));

    await waitFor(() => expect(csv.downloadCsv).toHaveBeenCalledWith(expect.stringMatching(/^email-opt-ins-\d{4}-\d{2}-\d{2}\.csv$/), 'Email\r\nparent@example.org'));
    expect(api.get).toHaveBeenCalledWith('/admin/email-opt-ins.csv', { responseType: 'text' });
  });

  it('says so when the download fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    render(<EmailOptInExportSection />);

    await userEvent.click(screen.getByRole('button', { name: /Download opt-in list/ }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not download/);
    expect(csv.downloadCsv).not.toHaveBeenCalled();
  });

  it('shows the active Resend status badge and sends a test email', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { enabled: true, configured: true, fromMasked: 'e***@e***.org' },
    });
    vi.mocked(api.post).mockResolvedValue({
      data: { status: 'Sent', recipientMasked: 'a***@e***.com' },
    });
    render(<EmailOptInExportSection />);

    expect(await screen.findByText('Active (Resend)')).toBeInTheDocument();
    expect(screen.getByText(/e\*\*\*@e\*\*\*\.org/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Send test email/ }));

    expect(api.post).toHaveBeenCalledWith('/admin/email-test');
    expect(await screen.findByText('Test email sent to a***@e***.com.')).toBeInTheDocument();
  });

  it('shows the off status badge and explains when sending is off or fails', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { enabled: false, configured: false, fromMasked: null },
    });
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { status: 'NotSent', recipientMasked: 'a***@e***.com' },
    });
    render(<EmailOptInExportSection />);

    expect(await screen.findByText(/Off \(logging only — set Email__Enabled, Email__ApiKey and Email__From\)/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Send test email/ }));
    expect(await screen.findByText('Email sending is currently off in settings.')).toBeInTheDocument();

    vi.mocked(api.post).mockResolvedValueOnce({
      data: { status: 'Failed', recipientMasked: 'a***@e***.com' },
    });
    await userEvent.click(screen.getByRole('button', { name: /Send test email/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Check your Resend settings/);

    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getByRole('button', { name: /Send test email/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not send the test email/);
  });
});
