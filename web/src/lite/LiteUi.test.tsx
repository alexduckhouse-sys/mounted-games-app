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
  it('is a dropdown row showing the saved choice, with what lite mode is for', () => {
    const Wrapper = liteWrapper();
    render(<Wrapper><LiteModeSetting /></Wrapper>);
    const row = screen.getByRole('combobox', { name: /Lite mode/ });
    expect(row).toHaveTextContent('Auto');
    expect(row).toHaveTextContent('Saves battery and data on busy showgrounds');
    fireEvent.click(row);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Auto', 'On', 'Off']);
    expect(screen.getByRole('option', { name: 'Auto' })).toHaveAttribute('aria-selected', 'true');
  });

  it('explains Auto on a slow connection', () => {
    installConnection({ effectiveType: '2g' });
    const Wrapper = liteWrapper();
    render(<Wrapper><LiteModeSetting /></Wrapper>);
    expect(screen.getByRole('combobox', { name: /Lite mode/ })).toHaveTextContent('On because your connection is slow');
  });

  it('changes and saves the choice', () => {
    const Wrapper = liteWrapper();
    render(<Wrapper><LiteModeSetting /></Wrapper>);
    fireEvent.click(screen.getByRole('combobox', { name: /Lite mode/ }));
    fireEvent.click(screen.getByRole('option', { name: 'On' }));
    expect(screen.getByRole('combobox', { name: /Lite mode/ })).toHaveTextContent('On');
    expect(localStorage.getItem('mg.liteMode')).toBe('on');
    fireEvent.click(screen.getByRole('combobox', { name: /Lite mode/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Off' }));
    expect(localStorage.getItem('mg.liteMode')).toBe('off');
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
