import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TermsTickBox } from './TermsTickBox';
import { TERMS_PLACEHOLDER, TERMS_TICK } from '../lib/termsTick';

it('shows the tick wording and reports changes', () => {
  const onChange = vi.fn();
  render(<TermsTickBox checked={false} onChange={onChange} />);
  const box = screen.getByRole('checkbox', { name: TERMS_TICK });
  expect(box).not.toBeChecked();
  fireEvent.click(box);
  expect(onChange).toHaveBeenCalledWith(true);
});

it('shows a labelled placeholder when the organiser has not written terms', () => {
  render(<TermsTickBox checked termsText="   " onChange={() => {}} />);
  expect(screen.getByText('Read the event terms (placeholder)')).toBeInTheDocument();
  expect(screen.getByText('Placeholder.')).toBeInTheDocument();
  expect(screen.getByText(TERMS_PLACEHOLDER, { exact: false })).toBeInTheDocument();
  expect(screen.getByRole('checkbox')).toBeChecked();
});

it('shows the organiser terms as plain text', () => {
  render(<TermsTickBox checked={false} termsText={'Hats on.\n<b>No bold</b>'} onChange={() => {}} />);
  expect(screen.getByText('Read the event terms')).toBeInTheDocument();
  expect(screen.getByText(/Hats on\./)).toHaveTextContent('<b>No bold</b>');
  expect(screen.queryByText('Placeholder.')).toBeNull();
});
