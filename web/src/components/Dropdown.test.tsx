import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dropdown } from './Dropdown';

const options = [{ value: 'a', label: 'Alpha', hint: '3 teams' }, { value: 'b', label: 'Beta', live: true }, { value: 'c', label: 'Gamma' }];

function Harness({ onChange = vi.fn() }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('a');
  return (
    <div>
      <Dropdown label="Pick" value={value} options={options} onChange={(next) => { setValue(next); onChange(next); }}>{value}</Dropdown>
      <p>outside</p>
    </div>
  );
}

const box = () => screen.getByRole('combobox', { name: 'Pick' });

describe('Dropdown', () => {
  it('opens under the button, marks the current option and picks one with a tap', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(box());
    expect(box()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('option', { name: /Alpha/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('3 teams')).toBeVisible();
    expect(screen.getByText('ON NOW')).toBeVisible();
    fireEvent.click(screen.getByRole('option', { name: 'Gamma' }));
    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does not report picking the option that is already chosen, and the button toggles it shut', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(box());
    fireEvent.click(screen.getByRole('option', { name: /Alpha/ }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(box());
    fireEvent.click(box());
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('works from the keyboard', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeVisible();
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(box()).toHaveAttribute('aria-activedescendant', expect.stringMatching(/-1$/));
    fireEvent.keyDown(box(), { key: 'End' });
    expect(box()).toHaveAttribute('aria-activedescendant', expect.stringMatching(/-2$/));
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(box()).toHaveAttribute('aria-activedescendant', expect.stringMatching(/-2$/));
    fireEvent.keyDown(box(), { key: 'Home' });
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    expect(box()).toHaveAttribute('aria-activedescendant', expect.stringMatching(/-0$/));
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    fireEvent.keyDown(box(), { key: ' ' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on Escape, Tab or a tap outside, and follows the pointer', () => {
    render(<Harness />);
    for (const close of [() => fireEvent.keyDown(box(), { key: 'Escape' }), () => fireEvent.keyDown(box(), { key: 'Tab' }), () => fireEvent.pointerDown(screen.getByText('outside'))]) {
      fireEvent.click(box());
      expect(screen.getByRole('listbox')).toBeVisible();
      close();
      expect(screen.queryByRole('listbox')).toBeNull();
    }
    fireEvent.click(box());
    fireEvent.pointerEnter(screen.getByRole('option', { name: 'Gamma' }));
    expect(screen.getByRole('option', { name: 'Gamma' })).toHaveAttribute('data-active');
    fireEvent.pointerDown(box());
    expect(screen.getByRole('listbox')).toBeVisible();
    fireEvent.keyDown(box(), { key: 'Escape' });
    fireEvent.keyDown(box(), { key: 'Escape' });
    fireEvent.keyDown(box(), { key: 'Enter' });
    fireEvent.keyDown(box(), { key: 'Home' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
