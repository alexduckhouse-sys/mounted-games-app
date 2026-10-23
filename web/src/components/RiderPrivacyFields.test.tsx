import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RiderPrivacyFields } from './RiderPrivacyFields';

describe('RiderPrivacyFields', () => {
  it('renders a single I agree consent tick box and reports changes', () => {
    const onChange = vi.fn();
    render(<RiderPrivacyFields value={{ useInitialOnly: false, noFilming: false }} onChange={onChange} />);
    const consent = screen.getByLabelText(/I agree to the competition terms, rider & media consent/) as HTMLInputElement;
    expect(consent.checked).toBe(false);
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);

    fireEvent.click(consent);
    expect(onChange).toHaveBeenLastCalledWith({ agreed: true, useInitialOnly: false, noFilming: false });
  });

  it('reflects the agreed value it is given', () => {
    render(<RiderPrivacyFields value={{ useInitialOnly: false, noFilming: false, agreed: true }} onChange={vi.fn()} />);
    expect((screen.getByLabelText(/I agree to the competition terms, rider & media consent/) as HTMLInputElement).checked).toBe(true);
  });
});
