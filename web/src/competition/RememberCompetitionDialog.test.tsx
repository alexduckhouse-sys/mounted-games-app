import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CurrentCompetitionProvider, useCurrentCompetition } from './CurrentCompetitionContext';
import { RememberCompetitionDialog } from './RememberCompetitionDialog';

function Controls() {
  const { rememberChoice, setCurrent } = useCurrentCompetition();
  return (
    <>
      <output data-testid="choice">{rememberChoice}</output>
      <button onClick={() => setCurrent({ id: 4, name: 'Spring Games' })}>Pick</button>
    </>
  );
}
const mount = () => render(<CurrentCompetitionProvider><Controls /><RememberCompetitionDialog /></CurrentCompetitionProvider>);

describe('RememberCompetitionDialog', () => {
  it('opens as a modal asking whether to keep the competition', () => {
    mount();
    const dialog = screen.getByRole('dialog', { name: 'Remember this competition?' });
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveAccessibleDescription(/We'll save a cookie on this device for six months, so it opens straight away next time\./);
  });

  it('names the competition in the explanation', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Pick' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(/so Spring Games opens straight away/);
  });

  it('remembers the competition on this device when told to', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Remember' }));
    expect(screen.getByTestId('choice')).toHaveTextContent('remember');
  });

  it('keeps it for this visit only on "No thanks"', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'No thanks' }));
    expect(screen.getByTestId('choice')).toHaveTextContent('visit');
  });

  it('treats dismissing with Escape as "this visit only"', () => {
    mount();
    fireEvent(screen.getByRole('dialog'), new Event('cancel'));
    expect(screen.getByTestId('choice')).toHaveTextContent('visit');
  });

  it('closes the dialog when it goes away', () => {
    const { unmount } = mount();
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close');
    act(() => unmount());
    expect(close).toHaveBeenCalled();
  });
});
