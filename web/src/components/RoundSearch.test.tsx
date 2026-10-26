import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RoundSearch } from './RoundSearch';

function Harness({ band = false }: { band?: boolean }) {
  const [text, setText] = useState('');
  return <><RoundSearch label="Find a team" placeholder="Team or club" value={text} onChange={setText} band={band} maxLength={20} /><output>{text}</output></>;
}

describe('RoundSearch', () => {
  it('has a hidden label, a placeholder and reports what is typed', () => {
    render(<Harness />);
    const box = screen.getByRole('searchbox', { name: 'Find a team' });
    expect(box).toHaveAttribute('placeholder', 'Team or club');
    expect(box).toHaveAttribute('maxlength', '20');
    fireEvent.change(box, { target: { value: 'Ash' } });
    expect(screen.getByRole('status')).toHaveTextContent('Ash');
  });

  it('uses the white band style only when asked', () => {
    const { container, rerender } = render(<Harness />);
    expect(container.querySelector('.sp-search')).not.toHaveClass('sp-search-band');
    rerender(<Harness band />);
    expect(container.querySelector('.sp-search')).toHaveClass('sp-search-band');
  });
});
