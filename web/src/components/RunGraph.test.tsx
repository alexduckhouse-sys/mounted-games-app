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
  it('fits a long run of bars into the width with slimmer bars, never a sideways scroll', () => {
    const many = Array.from({ length: 30 }, (_, index) => run(index, index, `${index}`, ['Heat']));
    const { container } = render(<RunGraph runs={many} average={4} ariaLabel="Each run" averageNote="Average" />);
    expect(container.querySelector('.overflow-x-auto')).toBeNull();
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('100%');
    expect(Number(svg.getAttribute('viewBox')!.split(' ')[2])).toBeLessThanOrEqual(360);
    expect(container.querySelectorAll('rect')).toHaveLength(30);
    // Bars too narrow to carry a place or a label drop them; the list for screen readers still has every run.
    expect([...container.querySelectorAll('svg text')].map((node) => node.textContent)).not.toContain('Heat');
    expect(container.querySelectorAll('ul.sr-only li')).toHaveLength(30);
  });
  it('keeps the place and label when the bars still have room', () => {
    const nine = Array.from({ length: 9 }, (_, index) => run(index, index, `${index}th`, ['Heat']));
    const { container } = render(<RunGraph runs={nine} average={null} ariaLabel="Nine" averageNote="Average" />);
    expect(container.querySelector('.overflow-x-auto')).toBeNull();
    expect([...container.querySelectorAll('svg text')].map((node) => node.textContent)).toContain('Heat');
  });
  it('draws the usual graph by default: average line, axis numbers, places over the bars and a 212-high drawing', () => {
    const { container } = render(<RunGraph runs={runs} average={3.3} ariaLabel="Each run" averageNote="Average 3.3 pts a run" />);
    expect(screen.getByTestId('run-average')).toBeInTheDocument();
    const drawn = [...container.querySelectorAll('svg text')].map((node) => node.textContent);
    expect(drawn).toContain('0');
    expect(drawn).toContain('3rd');
    const box = container.querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number);
    expect(box[0]).toBe(0);
    expect(box[3]).toBe(22 + 150 + 40);
    const note = screen.getByText('Average 3.3 pts a run');
    expect(note.className).toContain('text-[rgb(var(--mg-late-time))]');
    expect(note.querySelector('svg')).not.toBeNull();
  });
  it('compact draws a shorter graph: a 120 plot and a 28 foot', () => {
    const { container } = render(<RunGraph runs={runs} average={3.3} ariaLabel="Each run" averageNote="Average" compact />);
    const box = container.querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number);
    expect(box[3]).toBe(22 + 120 + 28);
    // The tallest bar (6 on a 0 to 6 scale) fills the whole plot.
    const heights = [...container.querySelectorAll('rect')].map((node) => Number(node.getAttribute('height')));
    expect(Math.max(...heights)).toBeCloseTo(120);
  });
  it('hideAverageLine removes the dashed line and writes the average in muted text with no swatch', () => {
    render(<RunGraph runs={runs} average={3.3} ariaLabel="Each run" averageNote="Average 3.3 pts a run" hideAverageLine />);
    expect(screen.queryByTestId('run-average')).not.toBeInTheDocument();
    const note = screen.getByText('Average 3.3 pts a run');
    expect(note.tagName).toBe('FIGCAPTION');
    expect(note.className).toContain('text-[rgb(var(--mg-muted))]');
    expect(note.querySelector('svg')).toBeNull();
  });
  it('hideAxisLabels leaves the scale numbers off but keeps the gridlines, and trims the empty left margin', () => {
    const { container } = render(<RunGraph runs={runs} average={null} ariaLabel="Each run" averageNote="Average" hideAxisLabels />);
    const drawn = [...container.querySelectorAll('svg text')].map((node) => node.textContent);
    expect(drawn).not.toContain('0');
    expect(drawn).toContain('3rd');
    expect(container.querySelectorAll('svg line').length).toBeGreaterThan(0);
    const box = container.querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number);
    expect(box[0]).toBe(30 - 8);
  });
  it("showValues prints each bar's points in place of its place, using valueText when given", () => {
    const withText: GraphRun[] = [{ ...run(1, 4, '3rd', ['Heat 1']), valueText: '4 pts' }, run(2, 6, '1st', ['A Final'])];
    const { container } = render(<RunGraph runs={withText} average={null} ariaLabel="Each run" averageNote="Average" showValues />);
    const drawn = [...container.querySelectorAll('svg text')].map((node) => node.textContent);
    expect(drawn).toContain('4 pts');
    expect(drawn).toContain('6');
    expect(drawn).not.toContain('3rd');
    expect(drawn).not.toContain('1st');
  });
  it('fill spreads a few runs across the whole width with bars between 3 and 56 wide', () => {
    const { container } = render(<RunGraph runs={runs.slice(0, 2)} average={null} ariaLabel="Two" averageNote="Average" fill />);
    const box = container.querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number);
    expect(box[2]).toBe(360);
    const widths = [...container.querySelectorAll('rect')].map((node) => Number(node.getAttribute('width')));
    expect(widths.every((width) => width <= 56 && width >= 3)).toBe(true);
  });
  it('fill with no runs draws the plain empty graph', () => {
    const { container } = render(<RunGraph runs={[]} average={null} ariaLabel="None" averageNote="Average" fill />);
    expect(container.querySelectorAll('rect')).toHaveLength(0);
  });
  it('keeps even a bar of nothing visible, and cuts long labels', () => {
    const { container } = render(<RunGraph runs={[run(1, 0, 'E', ['Quarter Final Two'])]} average={null} ariaLabel="One" averageNote="Average" />);
    expect(Number(container.querySelector('rect')!.getAttribute('height'))).toBeGreaterThanOrEqual(2);
    expect([...container.querySelectorAll('svg text')].map((node) => node.textContent)).toContain('Quarter…');
  });
});
