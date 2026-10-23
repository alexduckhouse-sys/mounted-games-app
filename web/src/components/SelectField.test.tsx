import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectField, optionsFromChildren } from './SelectField';
import { chooseOption, optionLabels, selectedValue } from '../test/select';

function Harness({ onChange = vi.fn(), initial = 'b', ...rest }: { onChange?: (value: string) => void; initial?: string } & Partial<Parameters<typeof SelectField>[0]>) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <label htmlFor="f">Pick one</label>
      <SelectField id="f" value={value} onChange={(event) => { setValue(event.target.value); onChange(event.target.value); }} {...rest}>
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
        <optgroup label="Greek">
          <option value="g">Gamma</option>
          <option value="d" disabled>Delta</option>
        </optgroup>
        <option value="n">{'Nu '}{2}</option>
      </SelectField>
      <p>outside</p>
    </div>
  );
}

const box = () => screen.getByRole('combobox', { name: 'Pick one' });

describe('SelectField', () => {
  it('reads options and groups from option children and shows the chosen label', () => {
    render(<Harness />);
    expect(box()).toHaveTextContent('Beta');
    expect(selectedValue(box())).toBe('b');
    expect(optionLabels(box())).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta', 'Nu 2']);
    fireEvent.click(box());
    expect(screen.getByText('Greek')).toBeVisible();
    expect(screen.getByRole('option', { name: 'Delta' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('builds options from fragments and ignores anything else', () => {
    const list = optionsFromChildren(<><option>Plain</option>{false}{'text'}<option value={3}>Three</option></>);
    expect(list).toEqual([{ value: 'Plain', label: 'Plain', disabled: undefined, group: undefined }, { value: '3', label: 'Three', disabled: undefined, group: undefined }]);
  });

  it('tells the handler the new value as event.target.value and ignores disabled options', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    chooseOption(box(), 'Gamma');
    expect(onChange).toHaveBeenCalledWith('g');
    fireEvent.click(box());
    fireEvent.click(screen.getByRole('option', { name: 'Delta' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('listbox')).toBeVisible();
  });

  it('works from the keyboard, skipping disabled options', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('n');
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    fireEvent.keyDown(box(), { key: 'Home' });
    fireEvent.keyDown(box(), { key: 'End' });
    fireEvent.keyDown(box(), { key: 'Home' });
    fireEvent.keyDown(box(), { key: ' ' });
    expect(onChange).toHaveBeenLastCalledWith('a');
  });

  it('jumps to an option by its first letters, and cycles on a repeated letter', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial="a" />);
    fireEvent.keyDown(box(), { key: 'g' });
    expect(screen.getByRole('listbox')).toBeVisible();
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('g');
    fireEvent.keyDown(box(), { key: 'z' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on Escape, Tab and a tap outside', () => {
    render(<Harness />);
    fireEvent.click(box());
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(box());
    fireEvent.keyDown(box(), { key: 'Tab' });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(box());
    fireEvent.pointerDown(screen.getByText('outside'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does not open when disabled', () => {
    render(<Harness disabled />);
    expect(box()).toBeDisabled();
    fireEvent.click(box());
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('marks itself invalid', () => {
    render(<Harness invalid />);
    expect(box()).toHaveAttribute('aria-invalid', 'true');
    render(<SelectField aria-label="Other" aria-invalid options={[]} />);
    expect(screen.getByRole('combobox', { name: 'Other' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the placeholder when nothing matches, and remembers the pick when uncontrolled', () => {
    const onChange = vi.fn();
    render(<SelectField aria-label="Camera" placeholder="Choose camera" defaultValue="" onChange={(e) => onChange(e.target.value)}
      options={[{ value: 'x', label: 'Front' }, { value: 'y', label: 'Back' }]} />);
    const camera = screen.getByRole('combobox', { name: 'Camera' });
    expect(camera).toHaveTextContent('Choose camera');
    chooseOption(camera, 'Back');
    expect(camera).toHaveTextContent('Back');
    expect(onChange).toHaveBeenCalledWith('y');
  });

  it('can be named by aria-labelledby, takes a name for forms and asks for a value when required', () => {
    const { container } = render(
      <div>
        <span id="lab">Club</span>
        <SelectField aria-labelledby="lab" name="club" required value="" options={[{ value: '', label: 'Choose' }, { value: '1', label: 'Oak' }]} />
      </div>,
    );
    expect(screen.getByRole('combobox', { name: 'Club' })).toBeVisible();
    expect(container.querySelector('input[type="hidden"][name="club"]')).not.toBeNull();
    expect(container.querySelector('input[required]')).toHaveValue('');
    fireEvent.click(screen.getByRole('combobox', { name: 'Club' }));
    expect(within(screen.getByRole('listbox', { name: 'Club' })).getAllByRole('option')).toHaveLength(2);
  });

  it('flips above the field when there is more room there', () => {
    const rect = { top: 700, bottom: 744, left: 0, right: 200, width: 200, height: 44, x: 0, y: 700, toJSON: () => ({}) };
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
    const inner = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(768);
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 300 });
    render(<Harness />);
    fireEvent.click(box());
    expect(screen.getByRole('listbox')).toHaveClass('mg-dropdown-up');
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
    spy.mockRestore();
    inner.mockRestore();
  });
});
