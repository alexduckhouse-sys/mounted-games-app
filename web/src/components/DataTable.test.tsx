import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable, type DataColumn } from './DataTable';

interface Row { id: number; name: string; points: number }
const rows: Row[] = [{ id: 1, name: 'Ash', points: 12 }, { id: 2, name: 'Birch', points: 9 }];
const columns: DataColumn<Row>[] = [
  { key: 'name', header: 'Team', cell: (r) => r.name, primary: true },
  { key: 'points', header: 'Points', cell: (r) => r.points, numeric: true },
];
const laptop = () => vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));

describe('DataTable', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows card rows on a phone', () => {
    const click = vi.fn();
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} caption="Teams" onRowClick={click} />);
    expect(screen.getByRole('list', { name: 'Teams' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByText('Ash'));
    expect(click).toHaveBeenCalledWith(rows[0]);
  });

  it('shows plain card rows on a phone without a click handler', () => {
    render(<DataTable rows={rows} columns={[columns[1], columns[0]]} rowKey={(r) => r.id} caption="Teams" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows a table on a laptop', () => {
    laptop();
    const click = vi.fn();
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} caption="Teams" onRowClick={click} />);
    expect(screen.getByRole('table', { name: 'Teams' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    fireEvent.click(screen.getByText('Birch'));
    expect(click).toHaveBeenCalledWith(rows[1]);
  });

  it('shows the empty state, or nothing', () => {
    const { rerender, container } = render(<DataTable rows={[]} columns={columns} rowKey={(r) => r.id} caption="Teams" empty={<p>None yet</p>} />);
    expect(screen.getByText('None yet')).toBeInTheDocument();
    rerender(<DataTable rows={[]} columns={columns} rowKey={(r) => r.id} caption="Teams" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('does not make rows clickable without a handler', () => {
    laptop();
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} caption="Teams" />);
    expect(screen.getAllByRole('row')[1].className).not.toContain('cursor-pointer');
  });
});
