import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition, session, standing } from '../../test/factories';
import type { CompetitionSection } from '../../types';
import { EventShareRows } from './DetailsTab';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));
const card = vi.hoisted(() => ({ make: vi.fn(), canShare: vi.fn(), share: vi.fn(), download: vi.fn() }));
vi.mock('../../lib/storyResultCard', async (original) => ({
  ...(await original<typeof import('../../lib/storyResultCard')>()),
  makeStoryResultCardPng: card.make,
  canShareStoryResultCard: card.canShare,
  shareStoryResultCardPng: card.share,
  downloadStoryResultCardPng: card.download,
}));

const get = vi.mocked(api.get);
const section = (id: number, displayName: string) => ({ id, displayName, finalistCount: null } as unknown as CompetitionSection);
const u12 = section(1, 'Under 12');
const u15 = section(2, 'Under 15');
const inQueries = new Date(Date.now() + 10 * 60_000).toISOString();
const finished = (id: number, sectionId: number) => session(id, { competitionSectionId: sectionId, status: 2, provisionalUntil: inQueries });
const event = (sessions = [finished(10, 1)], sections = [u12, u15]) =>
  competition({ id: 7, name: 'Spring Open', location: 'Stoneleigh', sections, sessions });
/** Opens the Share event sheet and picks the results picture. */
async function openPicture() {
  await userEvent.click(screen.getByRole('button', { name: 'Share event' }));
  await userEvent.click(await screen.findByRole('button', { name: /Share a results picture/ }));
}

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:card') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  card.make.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  card.canShare.mockReturnValue(true);
  card.share.mockResolvedValue(undefined);
  get.mockResolvedValue({ data: [standing(1, 12, { teamName: 'Avon A' }), standing(2, 8, { teamName: 'Avon B' })] });
});

describe('Results picture in the Share event sheet', () => {
  it('leaves the row as a plain link share until an age group has a race session under way or finished', () => {
    render(<EventShareRows competition={event([session(10, { competitionSectionId: 1, status: 0 }), session(11, { competitionSectionId: 1, status: 2, isBreak: true })])} />);
    expect(screen.getByRole('button', { name: 'Share event link' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share event' })).not.toBeInTheDocument();
  });

  it('offers the link and the picture as the two choices, and sends the link from the tap itself', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    render(<EventShareRows competition={event()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Share event' }));
    expect(await screen.findByRole('dialog', { name: 'Share event' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Share a results picture.*For Instagram or WhatsApp status/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send the link' }));
    expect(share).toHaveBeenCalledWith({ title: 'Spring Open', url: `${window.location.origin}/competitions/7` });
    expect(card.make).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });

  it('goes straight to the picture when only one age group has results, then shares it from its own tap', async () => {
    render(<EventShareRows competition={event()} />);
    await openPicture();
    expect(await screen.findByRole('img', { name: 'Results picture for Under 12' })).toHaveAttribute('src', 'blob:card');
    expect(get).toHaveBeenCalledWith('/competitions/7/standings', { params: { sectionId: 1 } });
    expect(card.make.mock.calls[0][0]).toMatchObject({ competitionName: 'Spring Open', sectionName: 'Under 12', isProvisional: true });
    expect(screen.getByText('These results aren’t official yet, so the picture says Provisional.')).toBeInTheDocument();
    expect(card.share).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(card.share).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Save picture' }));
    expect(card.download).toHaveBeenCalledTimes(1);
  });

  it('says racing is unfinished when a later session is still to run, and says nothing once results are official', async () => {
    const { unmount } = render(<EventShareRows competition={event([finished(10, 1), session(11, { competitionSectionId: 1, status: 0 })])} />);
    await openPicture();
    expect(await screen.findByText('Racing isn’t finished in Under 12 yet, so the picture says Provisional.')).toBeInTheDocument();
    unmount();

    render(<EventShareRows competition={event([session(10, { competitionSectionId: 1, status: 2, officialConfirmedAt: new Date().toISOString() })])} />);
    await openPicture();
    await screen.findByRole('img');
    expect(card.make.mock.calls[1][0]).toMatchObject({ isProvisional: false });
    expect(screen.queryByText(/says Provisional/)).not.toBeInTheDocument();
  });

  it('asks which age group when several have results', async () => {
    render(<EventShareRows competition={event([finished(10, 1), finished(11, 2)])} />);
    await openPicture();
    await userEvent.click(await screen.findByRole('radio', { name: 'Under 15' }));
    expect(await screen.findByRole('img', { name: 'Results picture for Under 15' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/competitions/7/standings', { params: { sectionId: 2 } });
  });

  it('offers only Save picture where the phone cannot share files', async () => {
    card.canShare.mockReturnValue(false);
    render(<EventShareRows competition={event()} />);
    await openPicture();
    await screen.findByRole('img');
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save picture' })).toHaveClass('kit-pill-fill');
  });

  it('says so when nobody has points yet, the browser cannot draw, or the request fails', async () => {
    get.mockResolvedValueOnce({ data: [standing(1, 0), standing(2, 0)] });
    render(<EventShareRows competition={event()} />);
    await openPicture();
    expect(await screen.findByText('No results in Under 12 yet.')).toBeInTheDocument();

    card.make.mockResolvedValueOnce(null);
    await openPicture();
    expect(await screen.findByText('This browser can’t make the picture. Try another one.')).toBeInTheDocument();

    get.mockRejectedValueOnce(new Error('offline'));
    await openPicture();
    expect(await screen.findByText('Couldn’t make the picture. Check your signal and try again.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('treats a cancelled share as nothing, but shows a failed one', async () => {
    render(<EventShareRows competition={event()} />);
    await openPicture();
    await screen.findByRole('img');
    card.share.mockRejectedValueOnce(Object.assign(new Error('cancel'), { name: 'AbortError' }));
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    card.share.mockRejectedValueOnce(new Error('denied'));
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t make the picture.'));
  });
});
