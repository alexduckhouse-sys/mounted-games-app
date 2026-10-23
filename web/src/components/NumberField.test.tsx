import { useState } from 'react';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NumberField } from './NumberField';

function Harness(props: Partial<Parameters<typeof NumberField>[0]> & { onValue?: (v: string) => void }) {
  const { onValue, ...rest } = props;
  const [value, setValue] = useState('5');
  return <NumberField aria-label="Amount" value={value} onChange={(e) => { setValue(e.target.value); onValue?.(e.target.value); }} {...rest} />;
}

const box = () => screen.getByLabelText('Amount') as HTMLInputElement;
const keyPrevented = (key: string, init: Record<string, unknown> = {}) => {
  const event = createEvent.keyDown(box(), { key, ...init });
  fireEvent(box(), event);
  return event.defaultPrevented;
};
const pastePrevented = (text: string) => {
  const event = createEvent.paste(box(), { clipboardData: { getData: () => text } });
  fireEvent(box(), event);
  return event.defaultPrevented;
};

describe('NumberField', () => {
  it('is a number input with a numeric keypad, or a decimal one when decimals are allowed', () => {
    const { rerender } = render(<Harness min={1} max={9} step={1} />);
    expect(box()).toHaveAttribute('type', 'number');
    expect(box()).toHaveAttribute('inputmode', 'numeric');
    expect(box()).toHaveAttribute('min', '1');
    rerender(<Harness decimal />);
    expect(box()).toHaveAttribute('inputmode', 'decimal');
  });

  it('rejects e, E, +, - and other characters on key entry but keeps digits and shortcuts', () => {
    render(<Harness />);
    for (const key of ['e', 'E', '+', '-', '.', ',', 'x']) expect(keyPrevented(key)).toBe(true);
    for (const key of ['0', '7', 'Backspace', 'ArrowLeft', 'Tab', 'Enter']) expect(keyPrevented(key)).toBe(false);
    expect(keyPrevented('v', { ctrlKey: true })).toBe(false);
    expect(keyPrevented('v', { metaKey: true })).toBe(false);
  });

  it('allows a decimal point only when decimal, and a minus only when negatives are allowed', () => {
    const { rerender } = render(<Harness decimal />);
    expect(keyPrevented('.')).toBe(false);
    expect(keyPrevented('-')).toBe(true);
    rerender(<Harness allowNegative />);
    expect(keyPrevented('-')).toBe(false);
    expect(keyPrevented('.')).toBe(true);
    rerender(<Harness min={-5} />);
    expect(keyPrevented('-')).toBe(false);
  });

  it('lets the caller see key presses first and veto them', () => {
    const onKeyDown = vi.fn((event) => { if (event.key === '5') event.preventDefault(); });
    render(<Harness onKeyDown={onKeyDown} />);
    expect(keyPrevented('5')).toBe(true);
    expect(onKeyDown).toHaveBeenCalled();
  });

  it('rejects pasted text that is not a plain number', () => {
    render(<Harness />);
    expect(pastePrevented('1e5')).toBe(true);
    expect(pastePrevented('-3')).toBe(true);
    expect(pastePrevented('1.5')).toBe(true);
    expect(pastePrevented('abc')).toBe(true);
    expect(pastePrevented(' 42 ')).toBe(false);
  });

  it('accepts decimal and negative paste where allowed, and passes paste to the caller', () => {
    const onPaste = vi.fn();
    render(<Harness decimal allowNegative onPaste={onPaste} />);
    expect(pastePrevented('-2.5')).toBe(false);
    expect(onPaste).toHaveBeenCalled();
  });

  it('accepts a negative whole number where negatives are allowed but not decimals', () => {
    render(<Harness allowNegative />);
    expect(pastePrevented('-3')).toBe(false);
    expect(pastePrevented('-3.5')).toBe(true);
    fireEvent.change(box(), { target: { value: '-3' } });
    expect(box().value).toBe('-3');
  });

  it('passes a typed number on, and drops a value that is not digits', () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.change(box(), { target: { value: '12' } });
    expect(onValue).toHaveBeenLastCalledWith('12');
    expect(box().value).toBe('12');
    fireEvent.change(box(), { target: { value: '1e5' } });
    expect(onValue).toHaveBeenCalledTimes(1);
    expect(box().value).toBe('12');
    fireEvent.change(box(), { target: { value: '' } });
    expect(onValue).toHaveBeenLastCalledWith('');
  });

  it('can be disabled, and works without an onChange', () => {
    render(<NumberField aria-label="Amount" defaultValue="3" disabled />);
    expect(box()).toBeDisabled();
    fireEvent.change(box(), { target: { value: '4' } });
  });
});
