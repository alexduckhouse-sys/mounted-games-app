import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EntryEmailFields, type EntryEmail } from './EntryEmailFields';

function Harness({ initial = { email: '', optIn: false }, spy }: { initial?: EntryEmail; spy?: (v: EntryEmail) => void }) {
  const [value, setValue] = useState(initial);
  return <EntryEmailFields value={value} onChange={(v) => { spy?.(v); setValue(v); }} />;
}

const box = () => screen.getByLabelText(/Email me when new competitions open/) as HTMLInputElement;
const field = () => screen.getByLabelText(/Your email/) as HTMLInputElement;

describe('EntryEmailFields', () => {
  it('starts with the alerts box unticked and switched off until there is an address', () => {
    render(<Harness />);
    expect(box().checked).toBe(false);
    expect(box().disabled).toBe(true);
    expect(screen.getByText(/never to a rider/)).toBeTruthy();
  });

  it('lets the box be ticked once an address is typed, and never ticks it for you', () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    fireEvent.change(field(), { target: { value: 'parent@example.org' } });
    expect(spy).toHaveBeenLastCalledWith({ email: 'parent@example.org', optIn: false });
    expect(box().disabled).toBe(false);
    fireEvent.click(box());
    expect(spy).toHaveBeenLastCalledWith({ email: 'parent@example.org', optIn: true });
  });

  it('clears the tick when the address is removed', () => {
    const spy = vi.fn();
    render(<Harness initial={{ email: 'parent@example.org', optIn: true }} spy={spy} />);
    fireEvent.change(field(), { target: { value: '' } });
    expect(spy).toHaveBeenLastCalledWith({ email: '', optIn: false });
    expect(box().checked).toBe(false);
  });

  it('flags an address that does not look right and keeps the box off', () => {
    render(<Harness initial={{ email: 'parent@', optIn: false }} />);
    expect(screen.getByRole('alert').textContent).toMatch(/doesn’t look right/);
    expect(box().disabled).toBe(true);
  });
});
