import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageGrid } from './PageGrid';

describe('PageGrid', () => {
  it('puts the rail on the right, sticky, and after the main column', () => {
    render(<PageGrid aside={<p>rail</p>} asideLabel="Rail"><p>main</p></PageGrid>);
    const aside = screen.getByRole('complementary', { name: 'Rail' });
    expect(aside).toHaveTextContent('rail');
    expect(aside.className).toContain('lg:sticky');
    expect(aside.className).toContain('lg:col-start-2');
    expect(aside.className).not.toContain('order-first');
    expect(aside.parentElement?.className).toContain('minmax(320px,1fr)');
  });

  it('can be a left rail that comes first on phones and does not stick', () => {
    render(<PageGrid variant="left" railFirst sticky={false} className="extra" aside={<p>filters</p>} asideLabel="Filters"><p>table</p></PageGrid>);
    const aside = screen.getByRole('complementary', { name: 'Filters' });
    expect(aside.className).toContain('order-first');
    expect(aside.className).toContain('lg:col-start-1');
    expect(aside.className).not.toContain('lg:sticky');
    expect(aside.parentElement?.className).toContain('lg:grid-cols-[240px_minmax(0,1fr)]');
    expect(aside.parentElement?.className).toContain('extra');
  });
});
