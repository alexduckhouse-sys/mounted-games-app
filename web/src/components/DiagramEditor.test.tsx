import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DiagramEditor } from './DiagramEditor';
import { pctToPx } from './diagramGeometry';

function Harness({ initial = '[]', spy }: { initial?: string; spy?: (json: string) => void }) {
  const [value, setValue] = useState(initial);
  return <DiagramEditor value={value} onChange={(j) => { setValue(j); spy?.(j); }} />;
}

function last(spy: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return JSON.parse(spy.mock.calls[spy.mock.calls.length - 1][0] as string) as Array<Record<string, unknown>>;
}

const slotButton = (name: string) => screen.getByRole('button', { name });

describe('DiagramEditor', () => {
  it('starts with a prompt and the start line on the lane', () => {
    render(<Harness />);
    expect(screen.getByTestId('start-line')).toBeInTheDocument();
    expect(screen.getByText(/Tap a pole or a gap/)).toBeInTheDocument();
    expect(screen.getByTestId('pole-count')).toHaveTextContent('5');
  });

  it('places a cone between two poles, then shows it as selected', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    await user.click(slotButton('Between pole 2 and pole 3'));
    expect(screen.getByTestId('slot-panel')).toHaveTextContent('Between pole 2 and pole 3');
    await user.click(screen.getByRole('button', { name: /Flag cone/ }));
    expect(last(spy)).toEqual([{ t: 'lane', poles: 5 }, { t: 'cone', kind: 'flag', anchor: 'gap2', x: 41.8 }]);
    expect(screen.getByTestId('selected-panel')).toHaveTextContent('Flag cone');
  });

  it('only lets poles go on pole positions', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    await user.click(slotButton('Between pole 1 and pole 2'));
    expect(screen.getByRole('button', { name: /^Pole$/ })).toBeDisabled();
    await user.click(slotButton('On pole 3'));
    await user.click(screen.getByRole('button', { name: /^Pole$/ }));
    expect(last(spy)[1]).toMatchObject({ t: 'pole', anchor: 'pole3', x: 50 });
  });

  it('moves a selected element slot to slot with the arrow buttons', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness spy={spy} initial={JSON.stringify([{ t: 'cone', kind: 'flag', anchor: 'pole1' }])} />);
    await user.click(screen.getByTestId('element-0'));
    expect(screen.getByTestId('selected-panel')).toHaveTextContent('On pole 1');
    await user.click(screen.getByRole('button', { name: 'Move towards the top' }));
    expect(last(spy)[1]).toMatchObject({ anchor: 'gap1' });
    await user.click(screen.getByRole('button', { name: 'Move towards the start' }));
    await user.click(screen.getByRole('button', { name: 'Move towards the start' }));
    await user.click(screen.getByRole('button', { name: 'Move towards the start' }));
    expect(last(spy)[1]).toMatchObject({ anchor: 'start' });
    expect(screen.getByRole('button', { name: 'Move towards the start' })).toBeDisabled();
  });

  it('drags an item to the nearest place', () => {
    const spy = vi.fn();
    render(<Harness spy={spy} initial={JSON.stringify([{ t: 'cone', kind: 'flag', anchor: 'pole1' }])} />);
    const svg = screen.getByRole('img', { name: 'Race diagram editor' });
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 240, right: 800, bottom: 240, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(screen.getByTestId('element-0'), { pointerId: 1, clientX: pctToPx(17) });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: pctToPx(50) });
    expect(last(spy)[1]).toMatchObject({ anchor: 'pole3' });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: pctToPx(50) });
    expect(spy).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(svg, { pointerId: 1 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: pctToPx(100) });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('selects the nearest slot when the lane background is tapped', () => {
    render(<Harness />);
    const svg = screen.getByRole('img', { name: 'Race diagram editor' });
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 240, right: 800, bottom: 240, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(svg, { clientX: pctToPx(67) });
    expect(screen.getByTestId('slot-panel')).toHaveTextContent('On pole 4');
    expect(screen.getByTestId('active-slot')).toBeInTheDocument();
  });

  it('duplicates, renames and deletes', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness spy={spy} initial={JSON.stringify([{ t: 'item', kind: 'sword', anchor: 'gap3' }])} />);
    await user.click(screen.getByTestId('element-0'));
    await user.type(screen.getByPlaceholderText(/EGUK flag/), 'Z');
    expect(last(spy)[1]).toMatchObject({ label: 'Z' });
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(last(spy)).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(last(spy)).toHaveLength(2);
    expect(screen.queryByTestId('selected-panel')).not.toBeInTheDocument();
  });

  it('shows no contents section for something that cannot hold items', async () => {
    const user = userEvent.setup();
    render(<Harness initial={JSON.stringify([{ t: 'item', kind: 'sword', anchor: 'gap3' }])} />);
    await user.click(screen.getByTestId('element-0'));
    expect(screen.queryByTestId('contents-panel')).not.toBeInTheDocument();
  });

  it('adds and removes what is on a bin', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness spy={spy} initial={JSON.stringify([{ t: 'item', kind: 'bin', anchor: 'gap2' }])} />);
    await user.click(screen.getByTestId('element-0'));
    const panel = screen.getByTestId('contents-panel');
    expect(panel).toHaveTextContent('Nothing yet');
    await user.click(within(panel).getByRole('button', { name: /^Mug$/ }));
    await user.click(within(panel).getByRole('button', { name: 'Add a mug' }));
    expect(screen.getByTestId('contents-summary')).toHaveTextContent('2 mugs');
    await user.click(within(panel).getByRole('button', { name: 'Remove a mug' }));
    expect(screen.getByTestId('contents-summary')).toHaveTextContent('1 mug');
    expect((last(spy)[1].on as unknown[]).length).toBe(1);
    expect(within(panel).queryByRole('button', { name: /^Pole$/ })).not.toBeInTheDocument();
  });

  it('changes the pole count and fills in poles', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    await user.click(screen.getByRole('button', { name: 'Fewer poles' }));
    expect(screen.getByTestId('pole-count')).toHaveTextContent('4');
    await user.click(screen.getByRole('button', { name: /Put a pole in every position/ }));
    expect(last(spy).filter((e) => e.t === 'pole')).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'More poles' }));
    expect(screen.getByTestId('pole-count')).toHaveTextContent('5');
    expect(slotButton('On pole 5')).toBeInTheDocument();
  });

  it('limits the pole count at both ends', async () => {
    const user = userEvent.setup();
    render(<Harness initial={JSON.stringify([{ t: 'lane', poles: 2 }])} />);
    expect(screen.getByRole('button', { name: 'Fewer poles' })).toBeDisabled();
    for (let i = 0; i < 6; i++) await user.click(screen.getByRole('button', { name: 'More poles' }));
    expect(screen.getByRole('button', { name: 'More poles' })).toBeDisabled();
  });

  it('toggles the midline and clears everything', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness spy={spy} initial={JSON.stringify([{ t: 'cone', x: 50 }])} />);
    await user.click(screen.getByRole('button', { name: 'Midline' }));
    expect(last(spy).some((e) => e.t === 'midline')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Midline' }));
    expect(last(spy).some((e) => e.t === 'midline')).toBe(false);
    await user.click(screen.getByRole('button', { name: /Clear/ }));
    expect(last(spy)).toEqual([{ t: 'lane', poles: 5 }]);
  });

  it('migrates an old diagram only when edited', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness spy={spy} initial={JSON.stringify([{ t: 'cone', x: 17 }, { t: 'cone', x: 90, label: 'Far' }])} />);
    expect(spy).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('element-0'));
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(last(spy).map((e) => e.anchor)).toEqual([undefined, 'pole1', 'pole1', 'gap5']);
  });

  it('lists what is in a slot and selects from the list, then finishes', async () => {
    const user = userEvent.setup();
    render(<Harness initial={JSON.stringify([{ t: 'cone', kind: 'flag', anchor: 'pole2', label: 'Home' }])} />);
    await user.click(slotButton('On pole 2'));
    await user.click(within(screen.getByTestId('slot-panel')).getByRole('button', { name: /Flag cone · Home/ }));
    expect(screen.getByTestId('selected-panel')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('selected-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('slot-panel')).toBeInTheDocument();
  });

  it('shows a hint when there are elements but nothing is chosen', () => {
    render(<Harness initial={JSON.stringify([{ t: 'cone', x: 50 }])} />);
    expect(screen.getByText(/Tap an item to edit it/)).toBeInTheDocument();
  });
});
