import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DelaySheet } from './DelaySheet';

function setup(extra: Partial<React.ComponentProps<typeof DelaySheet>> = {}) {
  const props = {
    arena: 'Main Arena', lateMinutes: 0, paused: false, busy: false, pace: null,
    onShift: vi.fn().mockResolvedValue(true), onContinue: vi.fn(), onClose: vi.fn(), ...extra,
  };
  render(<DelaySheet {...props} />);
  return props;
}
const field = () => screen.getByRole('spinbutton', { name: 'Move times by' });

describe('DelaySheet', () => {
  it('names the arena and says how late it is running, or that it is on time', () => {
    const { unmount } = render(<DelaySheet arena="Main Arena" lateMinutes={94} paused={false} busy={false} pace={null} onShift={vi.fn()} onContinue={vi.fn()} onClose={vi.fn()} />);
    const sheet = screen.getByRole('dialog', { name: 'Main Arena timing' });
    expect(sheet).toHaveTextContent('Running 1h 34m late');
    unmount();
    setup({ arena: '' });
    expect(screen.getByRole('dialog', { name: 'Timing' })).toHaveTextContent('Running on time');
  });

  it('moves the times by the minutes typed as soon as Shift is tapped, then slides away', async () => {
    const user = userEvent.setup();
    const props = setup();
    expect(screen.getByRole('button', { name: 'Shift' })).toBeDisabled();
    await user.type(field(), '-10');
    await user.click(screen.getByRole('button', { name: 'Shift' }));
    expect(props.onShift).toHaveBeenCalledWith(-10);
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
  });

  it('asks again for a whole number of minutes that is not 0', async () => {
    const user = userEvent.setup();
    const props = setup();
    for (const typed of ['1.5', '0', '721']) {
      await user.clear(field());
      await user.type(field(), typed);
      await user.click(screen.getByRole('button', { name: 'Shift' }));
      expect(screen.getByRole('alert')).toHaveTextContent('whole number of minutes');
    }
    expect(props.onShift).not.toHaveBeenCalled();
  });

  it('stays open and says so when the move did not go through', async () => {
    const user = userEvent.setup();
    const props = setup({ onShift: vi.fn().mockResolvedValue(false) });
    await user.type(field(), '15');
    await user.click(screen.getByRole('button', { name: 'Shift' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t move the times');
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('has no Pause, but offers Continue for a timetable paused before', async () => {
    const user = userEvent.setup();
    expect(screen.queryByRole('switch')).toBeNull();
    const props = setup({ paused: true });
    expect(screen.queryByRole('switch', { name: /Pause/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Continue the timetable' }));
    expect(props.onContinue).toHaveBeenCalledTimes(1);
  });

  it('shows the pace note only when there is one, and locks Shift while busy', async () => {
    const user = userEvent.setup();
    setup({ pace: 4.04, busy: true });
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText('Races are taking about 4.0 minutes each.')).toBeInTheDocument();
    await user.type(field(), '5');
    expect(within(sheet).getByRole('button', { name: 'Shift' })).toBeDisabled();
  });

  it('has no pace note and no Continue without them', () => {
    setup();
    expect(screen.queryByText(/Races are taking/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue the timetable' })).toBeNull();
  });

  it('links to Timetable & draw to change the order or add a break', () => {
    render(<MemoryRouter><DelaySheet arena="" lateMinutes={0} paused={false} busy={false} pace={null} rearrangeTo="/competitions/7/timetable-and-draw" onShift={vi.fn()} onContinue={vi.fn()} onClose={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Change the order or add a break' })).toHaveAttribute('href', '/competitions/7/timetable-and-draw');
  });
});
