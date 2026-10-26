import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DropdownRow } from './DropdownRow';

const options = [{ value: 'totals', label: 'Totals' }, { value: 'sessions', label: 'By session' }];

function Harness({ onChange }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('totals');
  return <DropdownRow label="Show" value={value} options={options} onChange={(next) => { setValue(next); onChange?.(next); }} />;
}

describe('DropdownRow', () => {
  it('shows the label and the current choice, with the list closed', () => {
    render(<Harness />);
    const row = screen.getByRole('combobox', { name: 'Show' });
    expect(row).toHaveTextContent('Show');
    expect(row).toHaveTextContent('Totals');
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens a floating list under the row, marks the current choice and picks another', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('combobox', { name: 'Show' }));
    const list = screen.getByRole('listbox', { name: 'Show' });
    expect(within(list).getByRole('option', { name: 'Totals' })).toHaveAttribute('aria-selected', 'true');
    await user.click(within(list).getByRole('option', { name: 'By session' }));
    expect(onChange).toHaveBeenCalledWith('sessions');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Show' })).toHaveTextContent('By session');
  });

  it('works from the keyboard and keeps focus on the row; Escape and an outside tap close it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const row = screen.getByRole('combobox', { name: 'Show' });
    row.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(row).toHaveTextContent('By session');
    expect(row).toHaveFocus();
    await user.click(row);
    expect(screen.getByRole('listbox')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.click(row);
    await user.click(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
