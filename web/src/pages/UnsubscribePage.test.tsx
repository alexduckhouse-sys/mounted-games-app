import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { UnsubscribePage } from './UnsubscribePage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { post: vi.fn() },
}));

function mount(search: string) {
  return render(<MemoryRouter initialEntries={[`/unsubscribe${search}`]}><UnsubscribePage /></MemoryRouter>);
}

beforeEach(() => {
  vi.mocked(api.post).mockResolvedValue({ data: { ok: true } });
});

describe('UnsubscribePage', () => {
  it('unsubscribes straight from the link, without a sign-in', async () => {
    mount('?token=abc123');
    expect(await screen.findByText(/We won't email you when new competitions open/)).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith('/email/unsubscribe', { token: 'abc123' });
    const back = screen.getByRole('link', { name: 'Back to the app' });
    expect(back).toHaveAttribute('href', '/');
    expect(back).toHaveClass('sp-pill');
    expect(back).not.toHaveClass('sp-pill-fill');
    expect(screen.queryByText('Back to Mounted Games')).not.toBeInTheDocument();
  });

  it('does not call the server when the link has no token', () => {
    mount('');
    expect(screen.getByRole('alert').textContent).toMatch(/incomplete/);
    expect(screen.getByRole('link', { name: 'Back to the app' })).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('offers a retry when the request fails', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    mount('?token=abc123');
    expect((await screen.findByRole('alert')).textContent).toMatch(/Something went wrong/);
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveClass('sp-pill', 'sp-pill-fill');
    expect(screen.getByRole('heading', { name: 'Couldn’t update your choice' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the app' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/That's done/));
    expect(api.post).toHaveBeenCalledTimes(2);
  });
});
