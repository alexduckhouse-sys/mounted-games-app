import { act, fireEvent, render, screen } from '@testing-library/react';
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
  expect(screen.queryByText('Private scorer links')).toBeNull();
});

it('copies section-specific links and keeps the newest copy confirmation until its own timer expires', async () => {
  vi.useFakeTimers();
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  render(<MemoryRouter><QrAccessModal open onClose={vi.fn()} competitionId={1} competitionName="Example competition" sectionId={5} /></MemoryRouter>);
  fireEvent.click(screen.getAllByRole('button', { name: 'Copy link' })[0]); await act(async () => {});
  expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/competitions/1/commentary?section=5`);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  fireEvent.click(screen.getAllByRole('button', { name: 'Copy link' })[0]); await act(async () => {});
  expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/competitions/1/tv?section=5`);
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Copy link' })).toHaveLength(4);
});

it('does not claim the link was copied when clipboard access is rejected', async () => {
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Clipboard denied')) } });
  show(); fireEvent.click(screen.getAllByRole('button', { name: 'Copy link' })[0]); await act(async () => {});
  expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
});
