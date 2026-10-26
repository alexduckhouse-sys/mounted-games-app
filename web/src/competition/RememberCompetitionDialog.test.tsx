import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MotionConfig } from 'framer-motion';
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
// Motion is stilled, as in lite mode, except where a test covers the slide away.
const mount = (motion = false) => render(<MotionConfig reducedMotion={motion ? 'never' : 'always'}><CurrentCompetitionProvider><Controls /><RememberCompetitionDialog /></CurrentCompetitionProvider></MotionConfig>);

describe('RememberCompetitionDialog', () => {
  it('slides away before the answer is kept when motion is on', async () => {
    mount(true);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('region')).toHaveClass('is-closing');
    expect(screen.getByRole('button', { name: 'No thanks' })).toBeDisabled();
    expect(screen.getByTestId('choice')).toHaveTextContent('ask');
    await waitFor(() => expect(screen.getByTestId('choice')).toHaveTextContent('remember'));
  });

  it('asks in a banner that leaves the page usable', () => {
    mount();
    const banner = screen.getByRole('region', { name: 'Save quick access on this device?' });
    expect(banner).toHaveTextContent('This competition opens straight away next time. We keep a cookie for six months');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pick' })).toBeEnabled();
  });

  it('names the competition in the explanation', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Pick' }));
    expect(screen.getByRole('region')).toHaveTextContent('Spring Games opens straight away next time.');
  });

  it('remembers the competition on this device when told to', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByTestId('choice')).toHaveTextContent('remember');
  });

  it('keeps it for this visit only on "No thanks"', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'No thanks' }));
    expect(screen.getByTestId('choice')).toHaveTextContent('visit');
  });

  it('ignores a second answer while it is leaving, and stops its timer when it goes away', async () => {
    const { unmount } = mount(true);
    await userEvent.click(screen.getByRole('button', { name: 'No thanks' }));
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    await waitFor(() => expect(screen.getByTestId('choice')).toHaveTextContent('visit'));
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    act(() => unmount());
    expect(clear).toHaveBeenCalled();
  });
});
