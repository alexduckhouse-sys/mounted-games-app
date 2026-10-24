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

  it('dismisses for this visit when swiped down with touch', () => {
    mount();
    const dialog = screen.getByRole('dialog');
    fireEvent.touchStart(dialog, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(dialog, { touches: [{ clientY: 160 }] });
    expect(dialog).toHaveStyle({ transform: 'translateY(60px)' });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientY: 160 }] });
    expect(screen.getByTestId('choice')).toHaveTextContent('visit');
  });

  it('keeps the dialog open on a short swipe and dismisses on a full pointer swipe down', () => {
    mount();
    const dialog = screen.getByRole('dialog');
    fireEvent.pointerMove(dialog, { clientY: 200 });
    fireEvent.pointerUp(dialog, { clientY: 200 });
    expect(screen.getByTestId('choice')).toHaveTextContent('ask');

    fireEvent.pointerDown(dialog, { clientY: 100 });
    fireEvent.pointerMove(dialog, { clientY: 120 });
    expect(dialog).toHaveStyle({ transform: 'translateY(20px)' });
    fireEvent.touchEnd(dialog, { changedTouches: [] });
    expect(dialog.style.transform).toBe('');
    expect(screen.getByTestId('choice')).toHaveTextContent('ask');

    fireEvent.pointerDown(dialog, { clientY: 100 });
    fireEvent.pointerMove(dialog, { clientY: 155 });
    fireEvent.pointerUp(dialog, { clientY: 155 });
    expect(screen.getByTestId('choice')).toHaveTextContent('visit');
  });
});
