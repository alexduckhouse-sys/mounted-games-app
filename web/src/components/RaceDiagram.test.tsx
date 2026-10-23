import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DIAGRAM_TOOLS } from '../types';
import { RaceDiagram } from './RaceDiagram';

describe('RaceDiagram', () => {
  it('draws the start line, the top line and an empty lane for no diagram', () => {
    render(<RaceDiagram />);
    expect(screen.getByRole('img', { name: 'Arena setup diagram' })).toBeInTheDocument();
    expect(screen.getByTestId('start-line')).toBeInTheDocument();
    expect(screen.getByText('START')).toBeInTheDocument();
    expect(screen.getByText('TOP')).toBeInTheDocument();
    expect(screen.queryByText('midline')).not.toBeInTheDocument();
  });

  it('draws an old free-x diagram and labels its elements', () => {
    const json = JSON.stringify([{ t: 'pole', x: 17, label: '1' }, { t: 'item', x: 88, label: 'Cartons' }, { t: 'midline' }]);
    render(<RaceDiagram diagramJson={json} height={110} />);
    expect(screen.getByText('Cartons')).toBeInTheDocument();
    expect(screen.getByText('midline')).toBeInTheDocument();
    expect(screen.getByRole('img').style.height).toBe('110px');
  });

  it('shows what is on a container as a summary and stacked shapes', () => {
    const json = JSON.stringify([{ t: 'item', kind: 'bin', anchor: 'gap2', on: [{ t: 'item', kind: 'mug' }, { t: 'item', kind: 'mug' }] }]);
    render(<RaceDiagram diagramJson={json} />);
    expect(screen.getByTestId('contents-summary')).toHaveTextContent('2 mugs');
  });

  it('caps the stack and counts the rest', () => {
    const on = Array.from({ length: 5 }, () => ({ t: 'item', kind: 'ball' }));
    render(<RaceDiagram diagramJson={JSON.stringify([{ t: 'in', anchor: 'pole3', on }])} />);
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByTestId('contents-summary')).toHaveTextContent('5 balls');
  });

  it('spreads several elements in one slot, draws every tool and ignores junk', () => {
    const els = [
      ...DIAGRAM_TOOLS.map((t) => ({ t: t.t, kind: t.kind, anchor: 'gap1' })),
      { t: 'table', anchor: 'gap1', label: 'Legacy' },
      { t: 'item', kind: 'unknown', anchor: 'top' },
      { t: 'cone', anchor: 'beyond', label: 'Far' },
    ];
    render(<RaceDiagram diagramJson={JSON.stringify(els)} />);
    expect(screen.getByText('Legacy')).toBeInTheDocument();
    expect(screen.getByText('Far')).toBeInTheDocument();
  });

  it('copes with invalid JSON', () => {
    render(<RaceDiagram diagramJson="not json" />);
    expect(screen.getByTestId('start-line')).toBeInTheDocument();
  });
});
