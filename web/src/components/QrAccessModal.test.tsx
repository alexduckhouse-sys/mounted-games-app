import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { QrAccessModal } from './QrAccessModal';

vi.mock('../pages/competition/ScorerLinksCard', () => ({ ScorerLinksCard: () => <div>Private scorer links</div> }));
const show = (canWrite?: boolean) => render(<MemoryRouter><QrAccessModal open onClose={vi.fn()} competitionId={1} competitionName="Example competition" canWrite={canWrite} /></MemoryRouter>);
afterEach(() => vi.useRealTimers());

it('defaults to public screen links without mounting the scorer link manager', () => {
  show();
  expect(screen.queryByText('Private scorer links')).toBeNull();
  expect(screen.queryByRole('tab', { name: /Volunteer/ })).toBeNull();
  expect(screen.getByRole('link', { name: /Print QR/ })).toHaveAttribute('href', '/event-tools/1/print/posters');
});

it('shows scorer management only when the caller grants organiser access', () => {
  show(true);
  expect(screen.getByText('Private scorer links')).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: /Screens/ }));
  expect(screen.queryByText('Private scorer links')).toBeNull();  fireEvent.click(screen.getByRole('tab', { name: /Volunteer/ }));
  expect(screen.getByText('Private scorer links')).toBeVisible();
});

it('opens as a sheet with the approved title and description', () => {
  show();
  const dialog = screen.getByRole('dialog', { name: 'Share with QR codes' });
  expect(dialog).toHaveAccessibleDescription('Pick what to share: the public results page, the TV display or the commentator desk. Scorer links are in Set up.');
});

it('closes from the Close pill', async () => {
  const onClose = vi.fn();
  render(<MemoryRouter><QrAccessModal open onClose={onClose} competitionId={1} competitionName="Example competition" /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Close QR access modal' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});

it('copies section-specific links and says so with a toast', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  render(<MemoryRouter><QrAccessModal open onClose={vi.fn()} competitionId={1} competitionName="Example competition" sectionId={5} /></MemoryRouter>);
  fireEvent.click(screen.getAllByRole('button', { name: 'Copy link' })[0]); await act(async () => {});
  expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/competitions/1/commentary?section=5`);
  expect(screen.getByRole('status')).toHaveTextContent('Link copied');
  fireEvent.click(screen.getAllByRole('button', { name: 'Copy link' })[1]); await act(async () => {});
  expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/competitions/1/tv?section=5`);
  expect(screen.getAllByRole('button', { name: 'Copy link' })).toHaveLength(4);
});

it('does not claim the link was copied when clipboard access is rejected', async () => {
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Clipboard denied')) } });
  show(); fireEvent.click(screen.getAllByRole('button', { name: 'Copy link' })[0]); await act(async () => {});
  expect(screen.queryByRole('status')).toBeNull();
});
