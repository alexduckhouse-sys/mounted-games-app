import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AgeGroupFilterButton, AgeGroupFilterSheet } from './AgeGroupFilter';

describe('AgeGroupFilter', () => {
  it('shows a count on the button only when an age group is set', () => {
    const { rerender } = render(<AgeGroupFilterButton label="Age group" active={false} onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Age group' })).toBeTruthy();
    rerender(<AgeGroupFilterButton label="Age group" active onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Age group, 1 set' })).toBeTruthy();
  });

  it('lists the age groups, picks one and shows the team count', () => {
    const onChange = vi.fn();
    render(<AgeGroupFilterSheet title="Age group" value="all" shown={1} onChange={onChange} onClose={() => {}}
      options={[{ id: 'all', label: 'All age groups', teams: 3 }, { id: 7, label: 'Under 12', teams: 1 }]} />);
    fireEvent.click(screen.getByRole('button', { name: /Under 12/ }));
    expect(onChange).toHaveBeenCalledWith(7);
    expect(screen.getByText('Show 1 team')).toBeTruthy();
    expect(screen.getByText('3 teams')).toBeTruthy();
  });
});
