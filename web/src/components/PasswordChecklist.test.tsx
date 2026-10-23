import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PasswordChecklist } from './PasswordChecklist';

describe('PasswordChecklist', () => {
  it('shows a row per rule and says nothing aloud until there is a password', () => {
    render(<PasswordChecklist password="" id="rules" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(document.getElementById('rules')).toBeTruthy();
  });

  it('marks met rows with a tick and spoken text, not just colour', () => {
    render(<PasswordChecklist password="abcdefg1" id="rules" />);
    const met = screen.getAllByRole('listitem').filter((li) => li.dataset.met === 'true');
    expect(met.map((li) => li.textContent)).toEqual(['At least 8 characters (met)', 'A number (met)', 'A lowercase letter (met)']);
    expect(screen.getByText('A special character (like ! ? # @ £)').parentElement?.textContent).toContain('(not met yet)');
    expect(screen.getByRole('status')).toHaveTextContent('3 of 4 password requirements met.');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('says when everything is met', () => {
    render(<PasswordChecklist password="abcdefg1!" id="rules" />);
    expect(screen.getByRole('status')).toHaveTextContent('All password requirements met.');
  });
});
