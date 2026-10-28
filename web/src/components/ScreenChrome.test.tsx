import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScreenChromeProvider, useChromeHidden, useHideChrome } from './ScreenChrome';

function Reader() { return <p data-testid="state">{String(useChromeHidden())}</p>; }
function Asker({ active }: { active: boolean }) { useHideChrome(active); return null; }

describe('ScreenChrome', () => {
  it('hides the chrome only while a page asks for it', () => {
    const { rerender } = render(<ScreenChromeProvider><Reader /><Asker active={false} /></ScreenChromeProvider>);
    expect(screen.getByTestId('state')).toHaveTextContent('false');
    rerender(<ScreenChromeProvider><Reader /><Asker active /></ScreenChromeProvider>);
    expect(screen.getByTestId('state')).toHaveTextContent('true');
    rerender(<ScreenChromeProvider><Reader /></ScreenChromeProvider>);
    expect(screen.getByTestId('state')).toHaveTextContent('false');
  });

  it('stays hidden until every page that asked has left', () => {
    const { rerender } = render(<ScreenChromeProvider><Reader /><Asker active /><Asker active /></ScreenChromeProvider>);
    rerender(<ScreenChromeProvider><Reader /><Asker active /></ScreenChromeProvider>);
    expect(screen.getByTestId('state')).toHaveTextContent('true');
  });

  it('does nothing outside the app shell', () => {
    render(<><Reader /><Asker active /></>);
    expect(screen.getByTestId('state')).toHaveTextContent('false');
  });
});
