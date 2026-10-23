import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PAGE_WIDTH_CLASS, PageWidthProvider, usePageWidth, usePageWidthValue, type PageWidth } from './PageWidth';

function Shown() {
  return <p>{usePageWidthValue()}</p>;
}
function Ask({ width }: { width: PageWidth }) {
  usePageWidth(width);
  return null;
}

describe('page width', () => {
  it('follows the page that asks, then resets when it goes', () => {
    const { rerender } = render(<PageWidthProvider>{() => <><Shown /><Ask width="wide" /></>}</PageWidthProvider>);
    expect(screen.getByText('wide')).toBeInTheDocument();
    rerender(<PageWidthProvider>{() => <Shown />}</PageWidthProvider>);
    expect(screen.getByText('default')).toBeInTheDocument();
  });

  it('can be asked for another width', () => {
    render(<PageWidthProvider>{() => <><Shown /><Ask width="full" /></>}</PageWidthProvider>);
    expect(screen.getByText('full')).toBeInTheDocument();
  });

  it('is a no-op outside the shell', () => {
    render(<><Ask width="wide" /><Shown /></>);
    expect(screen.getByText('default')).toBeInTheDocument();
  });

  it('maps every width to a class', () => {
    expect(Object.keys(PAGE_WIDTH_CLASS)).toEqual(['narrow', 'default', 'wide', 'full']);
  });
});
