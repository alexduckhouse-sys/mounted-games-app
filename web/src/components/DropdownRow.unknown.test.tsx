import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DropdownRow } from './DropdownRow';

describe('DropdownRow with an unmatched value', () => {
  it('shows only the label when no option matches the current value', () => {
    render(
      <DropdownRow label="Show" value="missing" options={[{ value: 'a', label: 'Alpha' }]} onChange={() => {}} />,
    );
    const row = screen.getByRole('combobox', { name: 'Show' });
    expect(row).toHaveTextContent('Show');
    expect(row).not.toHaveTextContent('Alpha');
  });
});
