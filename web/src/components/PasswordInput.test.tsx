import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PasswordInput } from './PasswordInput';

function Box() {
  const [value, setValue] = useState('');
  return <><label htmlFor="pw">Password</label><PasswordInput id="pw" value={value} onChange={(e) => setValue(e.target.value)} /></>;
}

describe('PasswordInput', () => {
  it('shows and hides the password with an eye that has a 44px tap class', async () => {
    render(<Box />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    const eye = screen.getByRole('button', { name: 'Show password' });
    expect(eye).toHaveClass('mg-eye');
    await userEvent.click(eye);
    expect(input).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('says caps lock is on, under the box, while it is, and drops the note on leaving', () => {
    render(<Box />);
    const input = screen.getByLabelText('Password');
    expect(screen.queryByText('Caps lock is on')).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'A', modifierCapsLock: true });
    const note = screen.getByText('Caps lock is on');
    expect(note).toHaveAttribute('role', 'status');
    expect(input).toHaveAttribute('aria-describedby', note.id);
    expect(input.closest('.mg-field')!.nextElementSibling).toBe(note);
    fireEvent.keyUp(input, { key: 'a', modifierCapsLock: false });
    expect(screen.queryByText('Caps lock is on')).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'A', modifierCapsLock: true });
    fireEvent.blur(input);
    expect(screen.queryByText('Caps lock is on')).not.toBeInTheDocument();
  });
});
