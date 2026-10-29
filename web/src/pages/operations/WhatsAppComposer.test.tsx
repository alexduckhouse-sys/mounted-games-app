import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { WhatsAppComposer } from './WhatsAppComposer';
describe('WhatsApp composition', () => {
  it('previews editable text before exposing an external send link', async () => {
    render(<WhatsAppComposer text={'Demo event\nAmount due: £12.34\nPayment reference: MG-1-2'} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Share on WhatsApp' }));
    expect(screen.getByRole('textbox')).toHaveValue('Demo event\nAmount due: £12.34\nPayment reference: MG-1-2');
    await userEvent.type(screen.getByRole('textbox'), '\nThank you');
    const link = screen.getByRole('link', { name: 'Open WhatsApp' });
    expect(new URL(link.getAttribute('href')!).searchParams.get('text')).toContain('MG-1-2\nThank you');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
