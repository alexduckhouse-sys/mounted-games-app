import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PasswordChecklist } from './PasswordChecklist';

describe('PasswordChecklist', () => {
  it('shows nothing until there is a password', () => {
    render(<PasswordChecklist password="" id="rules" />);
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(document.getElementById('rules')).toHaveTextContent('');
  });

  it('shows one unmet rule at a time in order of importance as the person types', () => {
    const { rerender } = render(<PasswordChecklist password="abc" id="rules" />);
    expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
    expect(screen.queryByText('A number')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Next requirement: At least 8 characters.');

    rerender(<PasswordChecklist password="abcdefgh" id="rules" />);
    expect(screen.getByText('A number')).toBeInTheDocument();
    expect(screen.queryByText('At least 8 characters')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Next requirement: A number.');

    rerender(<PasswordChecklist password="abcdefg1" id="rules" />);
    expect(screen.getByText('A special character (like ! ? # @ £)')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Next requirement: A special character (like ! ? # @ £).');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('says when everything is met', () => {
    render(<PasswordChecklist password="abcdefg1!" id="rules" />);
    expect(screen.getByText('Password meets all requirements.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('All password requirements met.');
  });
});
