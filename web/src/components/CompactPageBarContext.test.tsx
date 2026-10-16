import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CompactPageBarProvider, useCompactPageBar, useCompactPageBarState, type CompactPageBarConfig } from './CompactPageBarContext';

const first: CompactPageBarConfig = { backTo: '/one', title: 'Spring Games', subtitle: 'Seniors heats · Main Arena', badge: 'live' };
const second: CompactPageBarConfig = { backTo: '/two', title: 'Autumn Games', subtitle: 'Juniors heats · Arena Two', badge: 'next' };

function Publish({ config }: { config: CompactPageBarConfig }) {
  useCompactPageBar(config);
  return null;
}

function Read() {
  const { config } = useCompactPageBarState();
  return <output data-testid="compact-config">{config ? JSON.stringify(config) : 'none'}</output>;
}

it('publishes a compact bar while its page is mounted and clears it on route cleanup', () => {
  const view = (show: boolean) => <CompactPageBarProvider><Read />{show && <Publish config={first} />}</CompactPageBarProvider>;
  const { rerender } = render(view(true));
  expect(screen.getByTestId('compact-config')).toHaveTextContent('Spring Games');
  rerender(view(false));
  expect(screen.getByTestId('compact-config')).toHaveTextContent('none');
});

it('does not let an older page cleanup clear the current page bar', () => {
  const view = (showFirst: boolean) => <CompactPageBarProvider><Read />{showFirst && <Publish config={first} />}<Publish config={second} /></CompactPageBarProvider>;
  const { rerender } = render(view(true));
  expect(screen.getByTestId('compact-config')).toHaveTextContent('Autumn Games');
  rerender(view(false));
  expect(screen.getByTestId('compact-config')).toHaveTextContent('Autumn Games');
});

it('fails clearly when a compact page tries to publish outside the app provider', () => {
  expect(() => render(<Publish config={first} />)).toThrow('useCompactPageBarState must be used within CompactPageBarProvider');
});
