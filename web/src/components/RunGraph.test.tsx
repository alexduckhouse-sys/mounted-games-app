import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunGraph, type GraphRun } from './RunGraph';

const run = (id: number, value: number, top: string, label: string[], description = `Run ${id}`): GraphRun => ({ id, value, top, label, description });

describe('RunGraph', () => {
  const runs = [run(1, 4, '3rd', ['Heat 1']), run(2, 6, '1st', ['A Final']), run(3, 0, 'E', ['Heat 2', 'Aug'])];
  it('draws a bar a run with the place over it and the label under it, so it reads without colour', () => {
    const { container } = render(<RunGraph runs={runs} average={3.3} ariaLabel="Each run" averageNote="Average 3.3 pts a run" />);
    expect(container.querySelectorAll('rect')).toHaveLength(3);
    const drawn = [...container.querySelectorAll('svg text')].map((node) => node.textContent);
    for (const text of ['3rd', '1st', 'E', 'Heat 1', 'A Final', 'Heat 2', 'Aug']) expect(drawn).toContain(text);
    expect(screen.getByRole('img', { name: 'Each run' })).toBeInTheDocument();
  });
  it('shows the average as a dashed line and says so in words', () => {
    render(<RunGraph runs={runs} average={3.3} ariaLabel="Each run" averageNote="Average 3.3 pts a run" />);
    expect(screen.getByTestId('run-average')).toHaveAttribute('stroke-dasharray', '6 4');
    expect(screen.getByText('Average 3.3 pts a run')).toBeInTheDocument();
  });
  it('lists every run in words for screen readers, and drops the line and note without an average', () => {
    const { container } = render(<RunGraph runs={runs} average={null} ariaLabel="Each run" averageNote="Average" />);
    expect(screen.queryByTestId('run-average')).not.toBeInTheDocument();
    expect(screen.queryByText('Average')).not.toBeInTheDocument();
    const list = container.querySelector('ul.sr-only')!;
    expect([...list.querySelectorAll('li')].map((item) => item.textContent)).toEqual(['Run 1', 'Run 2', 'Run 3']);
  });
  it('lets a long run of bars scroll sideways instead of squeezing them', () => {
    const many = Array.from({ length: 9 }, (_, index) => run(index, index, `${index}`, ['x']));
    const { container } = render(<RunGraph runs={many} average={4} ariaLabel="Each run" averageNote="Average" />);
    expect(container.querySelector('.overflow-x-auto')).not.toBeNull();
    expect(container.querySelector('svg')!.getAttribute('width')).not.toBe('100%');
    const few = render(<RunGraph runs={runs} average={null} ariaLabel="Few" averageNote="Average" />);
    expect(few.container.querySelector('.overflow-x-auto')).toBeNull();
    expect(few.container.querySelector('svg')!.getAttribute('width')).toBe('100%');
  });
  it('keeps even a bar of nothing visible, and cuts long labels', () => {
    const { container } = render(<RunGraph runs={[run(1, 0, 'E', ['Quarter Final Two'])]} average={null} ariaLabel="One" averageNote="Average" />);
    expect(Number(container.querySelector('rect')!.getAttribute('height'))).toBeGreaterThanOrEqual(2);
    expect([...container.querySelectorAll('svg text')].map((node) => node.textContent)).toContain('Quarter…');
  });
});
