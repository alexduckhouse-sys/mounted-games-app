import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RaceListPicker, RaceSelect } from './RacePicker';

vi.mock('../lib/raceTemplates', () => ({
  loadRaceTemplates: () => Promise.resolve([{ name: 'Special Relay' }]),
}));

describe('RacePicker', () => {
  it('filters races by search, selects an official race, and supports custom races in both controlled and autoReset modes', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onChange = vi.fn();

    const { unmount } = render(
      <RaceSelect
        label="Pick race"
        value="Initial Custom"
        onSelect={onSelect}
        onChange={onChange}
        templates={['Custom Template']}
      />,
    );

    const customInput = screen.getByPlaceholderText('Type custom race name…');
    expect(customInput).toHaveValue('Initial Custom');
    await user.clear(customInput);
    await user.type(customInput, '{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
    await user.type(customInput, 'Mounted Dash{Enter}');
    expect(onSelect).toHaveBeenCalledWith('Mounted Dash');
    expect(onChange).toHaveBeenCalledWith('Mounted Dash');

    await user.selectOptions(screen.getByLabelText('Pick race'), 'Sword');
    expect(onSelect).toHaveBeenCalledWith('Sword');

    unmount();

    const onAdd = vi.fn();
    render(<RaceSelect label="Add race" value="Sword" autoReset onSelect={onAdd} />);
    const search = screen.getByPlaceholderText('Search races…');
    await user.type(search, 'bend');
    await user.click(screen.getByRole('button', { name: /Add race/i }));
    expect(onAdd).toHaveBeenCalledWith('Bending');

    await user.selectOptions(screen.getByLabelText('Add race'), '__custom__');
    const customBox = screen.getByPlaceholderText('Type custom race name…');
    await user.type(customBox, 'Obstacle Run');
    await user.click(screen.getByRole('button', { name: /Add race/i }));
    expect(onAdd).toHaveBeenCalledWith('Obstacle Run');
  });

  it('reorders, removes, adds, and applies standard Zone/Area lists in RaceListPicker', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    const { rerender } = render(
      <RaceListPicker
        races={[]}
        onChange={onChange}
        format={0}
        ageGroup="Open"
      />,
    );

    expect(screen.getByText(/No races selected yet/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Use Pony Club Zone list' }));
    expect(onChange).toHaveBeenCalled();

    rerender(
      <RaceListPicker
        races={['Bending', 'Flag', 'Mug']}
        onChange={onChange}
        format={0}
        ageGroup="Open"
      />,
    );

    const list = screen.getByRole('list', { name: 'Races in running order' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: 'Move Flag up' }));
    expect(onChange).toHaveBeenLastCalledWith(['Flag', 'Bending', 'Mug']);

    await user.click(screen.getByRole('button', { name: 'Move Flag down' }));
    expect(onChange).toHaveBeenLastCalledWith(['Bending', 'Mug', 'Flag']);

    await user.click(screen.getByRole('button', { name: 'Remove Flag' }));
    expect(onChange).toHaveBeenLastCalledWith(['Bending', 'Mug']);

    await user.selectOptions(screen.getByLabelText('Add race'), 'Sword');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenLastCalledWith(['Bending', 'Flag', 'Mug', 'Sword']);
  });
});
