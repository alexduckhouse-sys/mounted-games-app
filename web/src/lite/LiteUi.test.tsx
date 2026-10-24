import { fireEvent, render, screen } from '@testing-library/react';
import { useContext } from 'react';
import { MotionConfigContext } from 'framer-motion';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiteChip } from './LiteChip';
import { LiteModeSetting } from './LiteModeSetting';
import { LiteMotionConfig } from './LiteMotionConfig';
import { installConnection, liteWrapper, removeConnection } from '../test/lite';

afterEach(removeConnection);

describe('LiteModeSetting', () => {
  it('shows Auto / On / Off with the saved choice pressed, and Off as the status', () => {
    const Wrapper = liteWrapper();
    render(<Wrapper><LiteModeSetting /></Wrapper>);
    expect(screen.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('Off');
  });

  it('explains Auto on a slow connection', () => {
    installConnection({ effectiveType: '2g' });
    const Wrapper = liteWrapper();
    render(<Wrapper><LiteModeSetting /></Wrapper>);
    expect(screen.getByRole('status')).toHaveTextContent('On because your connection is slow');
  });

  it('changes and saves the choice', () => {
    const Wrapper = liteWrapper();
    render(<Wrapper><LiteModeSetting /></Wrapper>);
    fireEvent.click(screen.getByRole('button', { name: 'On' }));
    expect(screen.getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('On because you chose it');
    expect(localStorage.getItem('mg.liteMode')).toBe('on');
    fireEvent.click(screen.getByRole('button', { name: 'Off' }));
    expect(screen.getByRole('status')).toHaveTextContent('Off');
  });
});

describe('LiteChip', () => {
  it('is hidden while lite mode is off', () => {
    const Wrapper = liteWrapper('off');
    render(<Wrapper><LiteChip onOpen={vi.fn()} /></Wrapper>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows an icon-only button while lite mode is on and opens the setting when tapped', () => {
    const onOpen = vi.fn();
    const Wrapper = liteWrapper('on');
    render(<Wrapper><LiteChip onOpen={onOpen} /></Wrapper>);
    const chip = screen.getByRole('button', { name: 'Lite mode is on. Open the setting' });
    expect(chip).toHaveAttribute('title', 'Lite mode is on');
    expect(chip).toHaveTextContent('');
    expect(chip.querySelector('svg')).not.toBeNull();
    fireEvent.click(chip);
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe('LiteMotionConfig', () => {
  function Probe() {
    const { reducedMotion } = useContext(MotionConfigContext);
    return <span data-testid="probe">{reducedMotion}</span>;
  }

  it('turns Framer Motion off in lite mode', () => {
    const Wrapper = liteWrapper('on');
    render(<Wrapper><LiteMotionConfig><Probe /></LiteMotionConfig></Wrapper>);
    expect(screen.getByTestId('probe')).toHaveTextContent('always');
  });

  it('leaves motion alone otherwise', () => {
    const Wrapper = liteWrapper('off');
    render(<Wrapper><LiteMotionConfig><Probe /></LiteMotionConfig></Wrapper>);
    expect(screen.getByTestId('probe')).toHaveTextContent('user');
  });
});
