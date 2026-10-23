import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { JoinQr, TeamCalendarFeed } from './TeamSharing';

import { autoConfirm } from '../test/confirm';
vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

const TEAM = { id: 5, displayName: 'Cheshire A' };
const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const del = vi.mocked(api.delete);

beforeEach(() => {
  get.mockResolvedValue({ data: { enabled: false, createdAt: null } });
  autoConfirm(true);
});

describe('JoinQr', () => {
  it('draws a code for the join link, and nothing when the team has no key', () => {
    const { container, rerender } = render(<JoinQr team={{ displayName: 'Cheshire A', supporterJoinKey: 'ABCD2345' }} />);
    expect(screen.getByRole('img', { name: 'QR code to join Cheshire A' })).toBeInTheDocument();
    expect(screen.getByText(/You still approve them|you still approve them/i)).toBeInTheDocument();
    rerender(<JoinQr team={{ displayName: 'Cheshire A', supporterJoinKey: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('TeamCalendarFeed', () => {
  it('offers to create a link when none exists, then shows it once with a calendar button', async () => {
    post.mockResolvedValue({ data: { token: 'tok', path: '/api/calendar/teams/5/tok.ics', createdAt: '2026-10-22T10:00:00Z' } });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<TeamCalendarFeed team={TEAM} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Create calendar link' }));

    expect(post).toHaveBeenCalledWith('/teams/5/calendar-feed');
    expect(confirm).not.toHaveBeenCalled();
    const box = await screen.findByRole('textbox', { name: 'Calendar link' });
    expect(box).toHaveValue(`${window.location.origin}/api/calendar/teams/5/tok.ics`);
    expect(screen.getByRole('link', { name: /Add to calendar/ }).getAttribute('href')).toMatch(/^webcal:\/\/.*\/api\/calendar\/teams\/5\/tok\.ics$/);
    expect(screen.getByText(/won’t be shown again/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Copy link/ }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/api/calendar/teams/5/tok.ics`);
    expect(await screen.findByRole('button', { name: /Copied/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make a new link' })).toBeInTheDocument();
  });

  it('says a link is on without showing it, and warns before replacing or turning it off', async () => {
    get.mockResolvedValue({ data: { enabled: true, createdAt: '2026-10-20T09:00:00Z' } });
    post.mockResolvedValue({ data: { token: 't2', path: '/api/calendar/teams/5/t2.ics', createdAt: '2026-10-22T10:00:00Z' } });
    del.mockResolvedValue({ data: null });
    render(<TeamCalendarFeed team={TEAM} />);

    expect(await screen.findByText(/A calendar link is on, made 20 October 2026/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    autoConfirm([false]);
    await userEvent.click(screen.getByRole('button', { name: 'Make a new link' }));
    expect(post).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Make a new link' }));
    expect(await screen.findByRole('textbox', { name: 'Calendar link' })).toHaveValue(`${window.location.origin}/api/calendar/teams/5/t2.ics`);

    autoConfirm([false]);
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(del).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(del).toHaveBeenCalledWith('/teams/5/calendar-feed');
    expect(await screen.findByRole('button', { name: 'Create calendar link' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows a plain message when the status, the new link or turning off fails', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    const { unmount } = render(<TeamCalendarFeed team={TEAM} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t check the calendar link.');
    expect(screen.queryByRole('button', { name: 'Create calendar link' })).not.toBeInTheDocument();
    unmount();

    get.mockResolvedValue({ data: { enabled: true, createdAt: null } });
    post.mockRejectedValueOnce({ response: { data: { message: 'Not allowed.' } } });
    del.mockRejectedValueOnce(new Error('offline'));
    render(<TeamCalendarFeed team={TEAM} />);
    expect(await screen.findByText(/A calendar link is on\. We can’t show it again/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Make a new link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed.');
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t turn the link off.'));
  });

  it('shows a fallback message when the API returns no message and a plain-text one when it returns text', async () => {
    get.mockResolvedValue({ data: { enabled: false, createdAt: null } });
    post.mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce({ response: { data: 'Too many requests' } });
    render(<TeamCalendarFeed team={TEAM} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Create calendar link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t make the link.');
    await userEvent.click(screen.getByRole('button', { name: 'Create calendar link' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many requests'));
  });
});
