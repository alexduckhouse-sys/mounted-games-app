import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CardDropdownRow } from './CardDropdownRow';

const options = [{ value: 'all', label: 'All years' }, { value: '2026', label: '2026' }, { value: '2025', label: '2025' }];

function Harness({ onChange = vi.fn() }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('all');
  return <CardDropdownRow label="Year" value={value} options={options} hint="Pick one" swatch={(v) => (v === '2026' ? '#17385F' : undefined)}
    onChange={(next) => { setValue(next); onChange(next); }} />;
}

describe('CardDropdownRow', () => {
  it('shows the label and the current choice, and opens a floating list under the row', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const row = screen.getByRole('combobox', { name: 'Year All years' });
    expect(row).toHaveTextContent('Pick one');
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(row);
    const list = screen.getByRole('listbox', { name: 'Year All years' });
    expect(list).toHaveClass('mg-dropdown-menu', 'sp-menu');
    fireEvent.click(screen.getByRole('option', { name: '2025' }));
    expect(onChange).toHaveBeenCalledWith('2025');
    expect(screen.getByRole('combobox', { name: 'Year 2025' })).toBeInTheDocument();
  });

  it('draws a colour square for choices that have one', () => {
    render(<Harness />);
    expect(document.querySelector('.sp-swatch')).toBeNull();
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: '2026' }));
    expect(document.querySelector('.sp-swatch')?.getAttribute('style')).toMatch(/23, 56, 95|#17385f/i);
  });

  it('shows the raw value when it is not in the list, and does not open when disabled', () => {
    render(<CardDropdownRow label="Age" value="U14" options={[]} onChange={vi.fn()} disabled />);
    const row = screen.getByRole('combobox');
    expect(row).toHaveTextContent('U14');
    expect(row).toBeDisabled();
  });
});
