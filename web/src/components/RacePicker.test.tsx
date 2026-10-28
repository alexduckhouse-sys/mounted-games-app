import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { loadRaceTemplates } from '../lib/raceTemplates';
import { RaceListPicker, RaceSelect } from './RacePicker';

vi.mock('../lib/raceTemplates', async (original) => ({
  ...(await original<typeof import('../lib/raceTemplates')>()),
  loadRaceTemplates: vi.fn(() => Promise.resolve([{ name: 'Special Relay' }, { name: 'Special Relay (Pairs)', baseName: 'Special Relay', format: 1 }])),
}));

describe('RacePicker', () => {
  it('opens another custom race or an empty draft when the parent switches races', () => {
    const { rerender } = render(<RaceSelect value="Sword" />);
    rerender(<RaceSelect value="Synthetic custom relay" />);
    expect(screen.getByLabelText('Custom race name')).toHaveValue('Synthetic custom relay');
    rerender(<RaceSelect value="" />);
    expect(screen.queryByLabelText('Custom race name')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select race')).toHaveValue('');
  });

  it('still lets a scorer choose a built-in race when the library request fails', async () => {
    vi.mocked(loadRaceTemplates).mockRejectedValueOnce(new Error('offline'));
    const onSelect = vi.fn();
    render(<RaceSelect onSelect={onSelect} />);
    await userEvent.selectOptions(screen.getByLabelText('Select race'), 'Bending');
    expect(onSelect).toHaveBeenCalledWith('Bending');
  });

  it('offers library races but not the pairs and individual versions a section picks by itself', async () => {
    render(<RaceSelect onSelect={vi.fn()} />);
    expect(await screen.findByRole('option', { name: 'Special Relay' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Special Relay (Pairs)' })).not.toBeInTheDocument();
  });

  it('keeps a controlled draft aligned with search, custom clearing and external race changes', async () => {
    const user = userEvent.setup();
    function Editor() {
      const [value, setValue] = useState('Sword');
      return <><RaceSelect value={value} onChange={setValue} /><output aria-label="Draft race">{value}</output>
        <button onClick={() => setValue('Bending')}>Next race</button></>;
    }
    render(<Editor />);
    const search = screen.getByRole('searchbox', { name: 'Search race library' });
    await user.type(search, 'bend');
    expect(screen.getByLabelText('Draft race')).toHaveTextContent('Bending');
    await user.clear(search);
    await user.selectOptions(screen.getByLabelText('Select race'), '__custom__');
    const custom = screen.getByLabelText('Custom race name');
    await user.type(custom, 'Synthetic relay');
    expect(screen.getByLabelText('Draft race')).toHaveTextContent('Synthetic relay');
    await user.clear(custom);
    expect(screen.getByLabelText('Draft race')).toBeEmptyDOMElement();
    expect(screen.getByLabelText('Custom race name')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next race' }));
    expect(screen.getByLabelText('Select race')).toHaveValue('Bending');
    expect(screen.queryByLabelText('Custom race name')).not.toBeInTheDocument();
  });

  it('does not add an invisible previous selection when a search has no matches', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<RaceSelect value="Sword" autoReset onSelect={onSelect} />);
    await user.type(screen.getByRole('searchbox', { name: 'Search race library' }), 'zzzz no race');
    expect(screen.getByRole('button', { name: 'Add race' })).toBeDisabled();
    expect(onSelect).not.toHaveBeenCalled();
  });

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
    expect(onSelect).toHaveBeenLastCalledWith('');
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

    expect(screen.getByText(/No races yet/)).toBeInTheDocument();

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
