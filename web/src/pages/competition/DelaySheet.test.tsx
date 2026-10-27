import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DelaySheet } from './DelaySheet';

function setup(extra: Partial<React.ComponentProps<typeof DelaySheet>> = {}) {
  const props = {
    arena: 'Main Arena', lateMinutes: 0, paused: false, busy: false, pace: null,
    onShift: vi.fn().mockResolvedValue(true), onPause: vi.fn(), onClose: vi.fn(), ...extra,
  };
  render(<DelaySheet {...props} />);
  return props;
}

describe('DelaySheet', () => {
  it('names the arena and says how late it is running, or that it is on time', () => {
    const { unmount } = render(<DelaySheet arena="Main Arena" lateMinutes={94} paused={false} busy={false} pace={null} onShift={vi.fn()} onPause={vi.fn()} onClose={vi.fn()} />);
    const sheet = screen.getByRole('dialog', { name: 'Main Arena timing' });
    expect(sheet).toHaveTextContent('Running 1h 34m late');
    unmount();
    setup({ arena: '' });
    expect(screen.getByRole('dialog', { name: 'Timing' })).toHaveTextContent('Running on time');
  });

  it('moves times in five-minute steps and sends the total on Done, then closes', async () => {
    const user = userEvent.setup();
    const props = setup();
    const later = screen.getByRole('button', { name: '5 minutes later' });
    await user.click(later);
    await user.click(later);
    await user.click(later);
    expect(screen.getByText('+15 min')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '5 minutes earlier' }));
    expect(screen.getByText('+10 min')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(props.onShift).toHaveBeenCalledWith(10);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes without sending anything when nothing was moved', async () => {
    const user = userEvent.setup();
    const quiet = setup();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(quiet.onShift).not.toHaveBeenCalled();
    expect(quiet.onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the sheet open when the move did not go through', async () => {
    const user = userEvent.setup();
    const props = setup({ onShift: vi.fn().mockResolvedValue(false) });
    await user.click(screen.getByRole('button', { name: '5 minutes earlier' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(props.onShift).toHaveBeenCalledWith(-5);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('stops the stepper at an hour earlier and three hours later', async () => {
    const user = userEvent.setup();
    setup();
    const earlier = screen.getByRole('button', { name: '5 minutes earlier' });
    for (let i = 0; i < 12; i++) await user.click(earlier);
    expect(earlier).toBeDisabled();
    expect(screen.getByText('-60 min')).toBeInTheDocument();
    const later = screen.getByRole('button', { name: '5 minutes later' });
    for (let i = 0; i < 48; i++) await user.click(later);
    expect(later).toBeDisabled();
    expect(screen.getByText('+180 min')).toBeInTheDocument();
  });

  it('pauses at once from the switch, and shows it on when already paused', async () => {
    const user = userEvent.setup();
    const props = setup({ paused: true });
    const pause = screen.getByRole('switch', { name: 'Pause the timetable' });
    expect(pause).toBeChecked();
    await user.click(pause);
    expect(props.onPause).toHaveBeenCalledTimes(1);
  });

  it('shows the pace note only when there is one, and locks the controls while busy', () => {
    setup({ pace: 4.04, busy: true });
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText('Races are taking about 4.0 minutes each.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Done' })).toBeDisabled();
    expect(within(sheet).getByRole('button', { name: '5 minutes later' })).toBeDisabled();
    expect(within(sheet).getByRole('switch', { name: 'Pause the timetable' })).toBeDisabled();
  });

  it('has no pace note without a pace', () => {
    setup();
    expect(screen.queryByText(/Races are taking/)).toBeNull();
  });
});
