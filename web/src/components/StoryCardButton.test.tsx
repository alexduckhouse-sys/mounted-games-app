import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { standing } from '../test/factories';
import { StoryCardButton } from './StoryCardButton';
import * as card from '../lib/storyResultCard';

vi.mock('../lib/storyResultCard', async (orig) => {
  const actual = await orig<typeof import('../lib/storyResultCard')>();
  return { ...actual, shareOrDownloadStoryResultCard: vi.fn() };
});

const input = {
  competitionName: 'Spring',
  sectionName: 'Open',
  standings: [standing(1, 5, { teamName: 'North A' })],
  featuredTeamId: 1,
  isProvisional: true,
};

describe('StoryCardButton', () => {
  beforeEach(() => {
    vi.mocked(card.shareOrDownloadStoryResultCard).mockReset();
  });

  it('builds the card data and passes it to the share helper', async () => {
    vi.mocked(card.shareOrDownloadStoryResultCard).mockResolvedValue('shared');
    render(<StoryCardButton input={input} />);
    await userEvent.click(screen.getByRole('button', { name: 'Share story card' }));
    await waitFor(() => expect(card.shareOrDownloadStoryResultCard).toHaveBeenCalled());
    const data = vi.mocked(card.shareOrDownloadStoryResultCard).mock.calls[0][0];
    expect(data.isProvisional).toBe(true);
    expect(data.featuredTeam?.teamName).toBe('North A');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a busy state while rendering', async () => {
    let finish: (v: 'downloaded') => void = () => {};
    vi.mocked(card.shareOrDownloadStoryResultCard).mockReturnValue(new Promise((r) => { finish = r; }));
    render(<StoryCardButton input={input} label="Share result" className="x" />);
    await userEvent.click(screen.getByRole('button', { name: 'Share result' }));
    const busy = await screen.findByRole('button', { name: 'Making card…' });
    expect(busy).toBeDisabled();
    finish('downloaded');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Share result' })).toBeEnabled());
  });

  it('says so when the device cannot make the card', async () => {
    vi.mocked(card.shareOrDownloadStoryResultCard).mockResolvedValue('unsupported');
    render(<StoryCardButton input={input} />);
    await userEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('alert')).toHaveTextContent('can’t make the card');
  });

  it('shows an error when sharing fails', async () => {
    vi.mocked(card.shareOrDownloadStoryResultCard).mockRejectedValue(new Error('boom'));
    render(<StoryCardButton input={input} />);
    await userEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again');
  });

  it('does not treat a cancelled share as an error', async () => {
    vi.mocked(card.shareOrDownloadStoryResultCard).mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    render(<StoryCardButton input={input} />);
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores a result that arrives after unmount', async () => {
    let finish: (v: 'unsupported') => void = () => {};
    vi.mocked(card.shareOrDownloadStoryResultCard).mockReturnValue(new Promise((r) => { finish = r; }));
    const { unmount } = render(<StoryCardButton input={input} />);
    await userEvent.click(screen.getByRole('button'));
    unmount();
    finish('unsupported');
    await Promise.resolve();
  });

  it('ignores a failure that arrives after unmount', async () => {
    let fail: (e: unknown) => void = () => {};
    vi.mocked(card.shareOrDownloadStoryResultCard).mockReturnValue(new Promise((_, r) => { fail = r; }));
    const { unmount } = render(<StoryCardButton input={input} />);
    await userEvent.click(screen.getByRole('button'));
    unmount();
    fail(new Error('late'));
    await Promise.resolve();
  });

  it('treats a thrown non-object as an error', async () => {
    vi.mocked(card.shareOrDownloadStoryResultCard).mockRejectedValue('nope');
    render(<StoryCardButton input={input} />);
    await userEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
