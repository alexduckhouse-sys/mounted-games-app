import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FieldDrop, MoreMenu, PartHead } from './LaptopParts';
import { PartHead as ReExported } from '../pages/admin/LaptopParts';

describe('PartHead', () => {
  it('shows the title and an alert-styled count', () => {
    render(<PartHead id="x" title="Entries" meta="3 to check" alert />);
    expect(screen.getByRole('heading', { name: 'Entries' })).toHaveAttribute('id', 'x');
    expect(screen.getByText('3 to check').className).toContain('font-bold');
  });

  it('has quiet meta by default and none when omitted', () => {
    const { rerender } = render(<PartHead id="x" title="Entries" meta="12" />);
    expect(screen.getByText('12').className).toContain('font-medium');
    rerender(<PartHead id="x" title="Entries" />);
    expect(screen.queryByText('12')).toBeNull();
  });

  it('is still importable from the old admin path', () => {
    expect(ReExported).toBe(PartHead);
  });
});

describe('MoreMenu', () => {
  it('opens, runs an action and closes', () => {
    const onSelect = vi.fn();
    render(<MoreMenu label="More" items={[{ label: 'Rename', onSelect }, { label: 'Delete', onSelect: vi.fn(), danger: true }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Delete' }).className).toContain('mg-elim');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onSelect).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape and on a tap outside', () => {
    render(<div><span>outside</span><MoreMenu label="More" items={[{ label: 'Rename', onSelect: vi.fn() }]} /></div>);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.pointerDown(screen.getByText('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.pointerDown(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});

describe('FieldDrop', () => {
  it('shows the chosen label, or the raw value, or a prompt', () => {
    const options = [{ value: 'a', label: 'Alpha' }];
    const { rerender } = render(<FieldDrop label="Pick" value="a" options={options} onChange={vi.fn()} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    rerender(<FieldDrop label="Pick" value="zz" options={options} onChange={vi.fn()} />);
    expect(screen.getByText('zz')).toBeInTheDocument();
    rerender(<FieldDrop label="Pick" value="" options={options} onChange={vi.fn()} />);
    expect(screen.getByText('Choose')).toBeInTheDocument();
  });
});
