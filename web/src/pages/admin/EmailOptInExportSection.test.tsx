import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import * as csv from '../../lib/csv';
import { EmailOptInExportSection } from './EmailOptInExportSection';

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { get: vi.fn() },
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
});
