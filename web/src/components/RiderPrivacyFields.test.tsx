import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RiderPrivacyFields } from './RiderPrivacyFields';

describe('RiderPrivacyFields', () => {
  it('renders a single I agree consent tick box and reports changes', () => {
    const onChange = vi.fn();
    render(<RiderPrivacyFields value={{ useInitialOnly: true }} onChange={onChange} />);
    const consent = screen.getByLabelText('I agree') as HTMLInputElement;
    expect(consent.checked).toBe(false);
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);

    fireEvent.click(consent);
    expect(onChange).toHaveBeenLastCalledWith({ agreed: true });
  });

  it('reflects the agreed value it is given', () => {
    render(<RiderPrivacyFields value={{ useInitialOnly: false, agreed: true }} onChange={vi.fn()} />);
    expect((screen.getByLabelText('I agree') as HTMLInputElement).checked).toBe(true);
  });
});


it('shows and changes the surname privacy choice independently of consent', () => {
  const onChange = vi.fn();
  render(<RiderPrivacyFields value={{ useInitialOnly: true }} onChange={onChange} />);
  const privacy = screen.getByRole('switch', { name: 'Show surname as initial only on public start lists and results' });
  expect(privacy).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(privacy);
  expect(onChange).toHaveBeenLastCalledWith({ useInitialOnly: false });
});
