import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { MotionConfig } from 'framer-motion';
import { chat } from '../test/factories';
import { ANNOUNCEMENT_POP_MS, AnnouncementPop } from './AnnouncementPop';

afterEach(() => { vi.useRealTimers(); });

const show = (message: ReturnType<typeof chat> | null, onDismiss = vi.fn(), motion = false) => render(
  <MotionConfig reducedMotion={motion ? 'never' : 'always'}><MemoryRouter><AnnouncementPop message={message} to="/competitions/4/chat" onDismiss={onDismiss} /></MemoryRouter></MotionConfig>,
);

it('shows the announcement, links to the Live tab and can be put away', async () => {
  const onDismiss = vi.fn();
  show(chat(9, { type: 2, body: 'Lunch until 1pm' }), onDismiss);
  expect(screen.getByRole('status')).toHaveTextContent('Lunch until 1pm');
  expect(screen.getByRole('link')).toHaveAttribute('href', '/competitions/4/chat');
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss announcement' }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('link'));
  expect(onDismiss).toHaveBeenCalledTimes(2);
});

it('tucks itself away after a few seconds, and shows nothing without a message', () => {
  vi.useFakeTimers();
  const onDismiss = vi.fn();
  show(chat(9, { type: 2, body: 'Arena 2 is closed' }), onDismiss, true);
  act(() => { vi.advanceTimersByTime(ANNOUNCEMENT_POP_MS); });
  expect(onDismiss).toHaveBeenCalledTimes(1);
  const { container } = show(null);
  expect(container.querySelector('.mg-announce-pop')).toBeNull();
});
