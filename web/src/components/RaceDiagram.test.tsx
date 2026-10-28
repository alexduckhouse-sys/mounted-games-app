import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { LANE, pctToPx } from './diagramGeometry';
import {
  inferCanonicalSlot,
  normalisePlacement,
  PAD_R,
  POLE_LABELS,
  POLE_X,
  SLOT_COORDS,
  snapToSlot,
  toLaneModel,
  inferPoleCount,
} from './diagramSlots';
import { DIAGRAM_TOOLS } from '../types';
import { RaceDiagram } from './RaceDiagram';
import {
  buildRaceRulebooks,
  clearRaceDetailCache,
  fetchRaceTemplateByName,
  GOVERNING_BODIES,
  normaliseBodyName,
  RaceRulebookSection,
  RaceRulesSheet,
} from './RaceRulesSheet';

describe('RaceDiagram', () => {
  it('draws the start line, the top line, and all 5 evenly spaced pole landmarks P1-P5 with P5 beyond the changeover line', () => {
    render(<RaceDiagram />);
    expect(screen.getByRole('img', { name: 'Arena setup diagram' })).toBeInTheDocument();
    expect(screen.getByTestId('start-line')).toBeInTheDocument();
    expect(screen.getByText('START')).toBeInTheDocument();
    expect(screen.getByText('TOP')).toBeInTheDocument();
    expect(POLE_X).toEqual([22, 44, 66, 88, 110]);
    expect(POLE_LABELS).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
    expect(PAD_R).toBeGreaterThanOrEqual(130);

    for (const label of POLE_LABELS) {
      expect(screen.getByTestId(`pole-landmark-${label}`)).toBeInTheDocument();
    }
    const p4Line = screen.getByTestId('pole-landmark-P4').querySelector('line');
    const p5Line = screen.getByTestId('pole-landmark-P5').querySelector('line');
    expect(Number(p4Line?.getAttribute('x1'))).toBeCloseTo(pctToPx(88), 1);
    expect(Number(p5Line?.getAttribute('x1'))).toBeCloseTo(pctToPx(110), 1);
    expect(Number(p4Line?.getAttribute('x1'))).toBeLessThan(LANE.topLineX);
    expect(Number(p5Line?.getAttribute('x1'))).toBeGreaterThan(LANE.topLineX);
    expect(screen.queryByText('midline')).not.toBeInTheDocument();
  });

  it('places the 5th pole and top/beyond equipment beyond the changeover line and centres standing poles on the lane', () => {
    const json = JSON.stringify([
      { t: 'lane', poles: 5 },
      { t: 'pole', anchor: 'pole1', x: 22 },
      { t: 'pole', anchor: 'pole5', x: 110 },
      { t: 'cone', kind: 'flag', anchor: 'pole3', x: 50 },
      { t: 'item', kind: 'bin', anchor: 'top', x: 108 },
      { t: 'in', anchor: 'beyond', x: 116 },
      { t: 'midline' },
    ]);
    render(<RaceDiagram diagramJson={json} />);
    expect(screen.getByTestId('pole-landmark-P5')).toBeInTheDocument();
    const poleGroup = screen.getByTestId('element-0');
    const poleRect = poleGroup.querySelector('rect');
    expect(poleRect?.getAttribute('y')).toBe('98');
  });

  it('drops the kit in from the start line to the top when asked, and sets the arena up again for another race', () => {
    const json = JSON.stringify([
      { t: 'item', kind: 'bin', anchor: 'top', x: 108 },
      { t: 'pole', anchor: 'pole1', x: 22 },
      { t: 'cone', kind: 'flag', anchor: 'pole3', x: 50 },
    ]);
    const { rerender } = render(<RaceDiagram diagramJson={json} drop />);
    const delay = (index: number) => parseFloat(screen.getByTestId(`element-${index}`).style.animationDelay);
    expect(screen.getByTestId('element-1')).toHaveClass('mg-kit-drop');
    expect(delay(1)).toBeLessThan(delay(2));
    expect(delay(2)).toBeLessThan(delay(0));
    const first = screen.getByTestId('element-1');
    rerender(<RaceDiagram diagramJson={json} drop />);
    expect(screen.getByTestId('element-1')).toBe(first);
    rerender(<RaceDiagram diagramJson={JSON.stringify([{ t: 'pole', anchor: 'pole2', x: 44 }])} drop />);
    expect(screen.getByTestId('element-0')).toHaveClass('mg-kit-drop');
    rerender(<RaceDiagram diagramJson={json} />);
    expect(screen.getByTestId('element-1')).not.toHaveClass('mg-kit-drop');
    expect(screen.getByTestId('element-1').style.animationDelay).toBe('');
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

describe('even-spaced arena slot helpers', () => {
  it('defines even-spaced SLOT_COORDS with P5, top and beyond past the changeover line', () => {
    expect(SLOT_COORDS.pole1.x).toBe(22);
    expect(SLOT_COORDS.pole2.x).toBe(44);
    expect(SLOT_COORDS.pole3.x).toBe(66);
    expect(SLOT_COORDS.pole4.x).toBe(88);
    expect(SLOT_COORDS.pole5.x).toBe(110);
    expect(SLOT_COORDS.top.x).toBe(108);
    expect(SLOT_COORDS.beyond.x).toBe(116);
  });

  it('maps legacy and new coordinates to canonical slots and normalises placements', () => {
    expect(inferCanonicalSlot({ t: 'pole', x: 18 })).toBe('pole1');
    expect(inferCanonicalSlot({ t: 'pole', x: 36 })).toBe('pole2');
    expect(inferCanonicalSlot({ t: 'pole', x: 55 })).toBe('pole3');
    expect(inferCanonicalSlot({ t: 'pole', x: 73 })).toBe('pole4');
    expect(inferCanonicalSlot({ t: 'pole', x: 110 })).toBe('pole5');
    expect(inferCanonicalSlot({ anchor: 'finish' })).toBe('top');
    expect(inferCanonicalSlot({ anchor: 'mid_1_2' })).toBe('gap1');
    expect(inferCanonicalSlot({ anchor: 'mid_2_3' })).toBe('gap2');
    expect(inferCanonicalSlot({ t: 'pole', anchor: 'mid_2_3' })).toBe('pole3');
    expect(inferCanonicalSlot({ anchor: 'mid_3_4' })).toBe('gap3');
    expect(inferCanonicalSlot({ anchor: 'mid_4_top' })).toBe('gap4');
    expect(inferCanonicalSlot({ t: 'pole', anchor: 'changeover' })).toBe('pole5');
    expect(inferCanonicalSlot({ anchor: 'pole2_left' })).toBe('pole2');
    expect(inferCanonicalSlot({ x: 0 })).toBe('start');
    expect(inferCanonicalSlot({ x: 11 })).toBe('gap0');
    expect(inferCanonicalSlot({ x: 22 })).toBe('pole1');
    expect(inferCanonicalSlot({ x: 33 })).toBe('gap1');
    expect(inferCanonicalSlot({ x: 44 })).toBe('pole2');
    expect(inferCanonicalSlot({ x: 55 })).toBe('gap2');
    expect(inferCanonicalSlot({ x: 66 })).toBe('pole3');
    expect(inferCanonicalSlot({ x: 77 })).toBe('gap3');
    expect(inferCanonicalSlot({ x: 88 })).toBe('pole4');
    expect(inferCanonicalSlot({ x: 91 })).toBe('pole5');
    expect(inferCanonicalSlot({ x: 96 })).toBe('beyond');
    expect(inferCanonicalSlot({ x: 108 })).toBe('top');
    expect(inferCanonicalSlot({ x: 110 })).toBe('pole5');
    expect(inferCanonicalSlot({ x: 116 })).toBe('beyond');
    expect(inferCanonicalSlot({ x: 94 })).toBe('gap4');
    expect(inferCanonicalSlot({ x: 30 })).toBe('gap1');

    expect(snapToSlot(21, true)).toEqual({ slot: 'pole1', x: 22 });
    expect(snapToSlot(109, false)).toEqual({ slot: 'top', x: 108 });

    expect(normalisePlacement({ t: 'midline' })).toEqual({ t: 'midline' });
    expect(normalisePlacement({ t: 'pole', x: 91 })).toEqual({ t: 'pole', anchor: 'pole5', x: 110 });
    expect(normalisePlacement({ t: 'item', kind: 'bin', anchor: 'top' })).toEqual({
      t: 'item', kind: 'bin', anchor: 'top', x: 108,
    });

    expect(inferPoleCount([
      { t: 'pole', x: 22 }, { t: 'pole', x: 44 }, { t: 'pole', x: 66 }, { t: 'pole', x: 88 },
    ])).toBe(4);
    expect(inferPoleCount([
      { t: 'pole', x: 22 }, { t: 'pole', x: 44 }, { t: 'pole', x: 66 }, { t: 'pole', x: 88 }, { t: 'pole', x: 110 },
    ])).toBe(5);
    const evenModel = toLaneModel([
      { t: 'pole', x: 22 }, { t: 'pole', x: 44 }, { t: 'cone', x: 55 }, { t: 'pole', x: 66 }, { t: 'pole', x: 88 }, { t: 'pole', x: 110 },
      { t: 'item', x: 108 }, { t: 'item', x: 116 },
    ]);
    expect(evenModel.items.map((i) => i.slot)).toEqual([
      'pole1', 'pole2', 'gap2', 'pole3', 'pole4', 'pole5', 'top', 'beyond',
    ]);
  });
});

describe('RaceRulesSheet and 4 governing body rulebooks', () => {
  it('normalises governing body names and builds all 4 rulebooks (EGUK, Pony Club, MGA, STRUK)', () => {
    expect(GOVERNING_BODIES).toEqual(['EGUK', 'Pony Club', 'MGA', 'STRUK']);
    expect(normaliseBodyName('eguk')).toBe('EGUK');
    expect(normaliseBodyName('Pony Club')).toBe('Pony Club');
    expect(normaliseBodyName('IMGA')).toBe('MGA');
    expect(normaliseBodyName('STRUK')).toBe('STRUK');
    expect(normaliseBodyName('other')).toBe('EGUK');

    const rbs = buildRaceRulebooks({
      id: 1,
      name: 'Five Flag',
      isBuiltIn: true,
      summary: 'Place flags into the far cone.',
      rules: 'One flag cone 3 m behind the Changeover Line. Winner crosses first.',
      diagramJson: JSON.stringify([{ t: 'cone', kind: 'flag', anchor: 'beyond', x: 116 }]),
      rulebooks: [
        {
          body: 'IMGA' as never,
          title: 'MGA — Five Flag',
          edition: 'IMGA 2026',
          equipment: '5 flags, 2 cones',
          setup: 'Cone beyond changeover.',
          howToRide: 'Ride and place.',
          penalties: 'Replace knocked cone.',
          rulesText: 'MGA Five Flag rules.',
        },
      ],
    });
    expect(rbs.map((r) => r.body)).toEqual(['EGUK', 'Pony Club', 'MGA', 'STRUK']);
    expect(rbs.find((r) => r.body === 'MGA')?.edition).toBe('IMGA 2026');
    expect(rbs.find((r) => r.body === 'EGUK')?.edition).toContain('not verified');
    expect(rbs.find((r) => r.body === 'EGUK')?.setup).not.toContain('6 m');
  });

  it('switches between EGUK, Pony Club, MGA and STRUK tabs in RaceRulebookSection', () => {
    render(
      <RaceRulebookSection
        template={{
          id: 1,
          name: 'Bending',
          isBuiltIn: true,
          summary: 'Weave five poles.',
          rules: 'Five poles spaced evenly.',
          diagramJson: JSON.stringify([{ t: 'pole', anchor: 'pole1', x: 22 }]),
        }}
        showDiagram
      />,
    );
    expect(screen.getByRole('tab', { name: 'EGUK' })).toHaveAttribute('aria-selected', 'true');
    for (const body of ['Pony Club', 'MGA', 'STRUK'] as const) {
      fireEvent.click(screen.getByRole('tab', { name: body }));
      expect(screen.getByRole('tab', { name: body })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel', { name: `${body} rules` })).toBeInTheDocument();
    }
  });

  it('fetches race template by name lazily and renders RaceRulesSheet when open', async () => {
    clearRaceDetailCache();
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce({
      data: {
        id: 5,
        name: 'Bottle',
        isBuiltIn: true,
        summary: 'Swap bottle between tables.',
        rules: 'Two tables, one beyond changeover.',
        diagramJson: '[]',
      },
    } as never);

    const { rerender } = render(
      <MemoryRouter>
        <RaceRulesSheet raceName="Bottle" open={false} onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(spy).not.toHaveBeenCalled();

    const onClose = vi.fn();
    rerender(
      <MemoryRouter>
        <RaceRulesSheet raceName="Bottle" open onClose={onClose} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Swap bottle between tables.')).toBeInTheDocument();
    // One 44px+ settings row replaces the row of small tabs.
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Rulebook' })).toHaveAttribute('data-value', 'EGUK');
    expect(screen.queryByRole('link', { name: /rulebook page/i })).not.toBeInTheDocument();

    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Close rules' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));

    // Test fallback path in fetchRaceTemplateByName
    clearRaceDetailCache();
    expect(await fetchRaceTemplateByName('   ')).toBeNull();
    spy.mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce({
      data: [{ id: 9, name: 'Litter', isBuiltIn: true, summary: 'Litter race', rules: 'Spear litter.' }],
    } as never);
    const fallbackResult = await fetchRaceTemplateByName('Litter');
    expect(fallbackResult?.name).toBe('Litter');
    expect(fallbackResult?.rulebooks).toHaveLength(4);

    clearRaceDetailCache();
    spy.mockRejectedValueOnce(new Error('404'));
    const directFallback = await fetchRaceTemplateByName('Custom', {
      id: 10, name: 'Custom', isBuiltIn: false,
    });
    expect(directFallback?.name).toBe('Custom');

    clearRaceDetailCache();
    spy.mockRejectedValueOnce(new Error('404')).mockRejectedValueOnce(new Error('offline'));
    expect(await fetchRaceTemplateByName('Missing')).toBeNull();
    spy.mockRestore();
  });
});
