import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RiderPrivacyFields } from './RiderPrivacyFields';

describe('RiderPrivacyFields', () => {
  it('starts unticked and reports each change on its own', () => {
    const onChange = vi.fn();
    render(<RiderPrivacyFields value={{ useInitialOnly: false, noFilming: false }} onChange={onChange} />);
    const initial = screen.getByLabelText(/Show surname as an initial only/) as HTMLInputElement;
    const filming = screen.getByLabelText(/No close-up filming or photos/) as HTMLInputElement;
    expect(initial.checked).toBe(false);
    expect(filming.checked).toBe(false);

    fireEvent.click(initial);
    expect(onChange).toHaveBeenLastCalledWith({ useInitialOnly: true });
    fireEvent.click(filming);
    expect(onChange).toHaveBeenLastCalledWith({ noFilming: true });
  });

  it('reflects the values it is given', () => {
    render(<RiderPrivacyFields value={{ useInitialOnly: true, noFilming: true }} onChange={vi.fn()} />);
    expect((screen.getByLabelText(/Show surname as an initial only/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/No close-up filming or photos/) as HTMLInputElement).checked).toBe(true);
  });
});
