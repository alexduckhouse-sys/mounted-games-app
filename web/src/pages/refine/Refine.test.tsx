import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { describe, expect, it, vi } from 'vitest';
import { RefineChoiceRow, RefineDisclosure, RefineFoot, RefineHeader, RefineList, RefineMenu, RefineQty, RefineSection, RefineSheet, RefineStatus } from './Refine';

describe('RefineHeader', () => {
  it('shows the context, title and DEMO chip, with a back link or an in-page back button', async () => {
    const onBack = vi.fn();
    const view = render(<MemoryRouter><RefineHeader back="/shop" backLabel="Back to shop" context="Autumn Games" title="Basket" demo /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Back to shop' })).toHaveAttribute('href', '/shop');
    expect(screen.getByRole('heading', { name: /Basket/ })).toHaveTextContent('DEMO');
    expect(screen.getByText('Autumn Games')).toBeInTheDocument();

    view.rerender(<MemoryRouter><RefineHeader onBack={onBack} context="x" title="Basket" /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.queryByText('DEMO')).not.toBeInTheDocument();
  });

  it('puts a page-level action on the right of the title row', () => {
    render(<MemoryRouter><RefineHeader context="x" title="Stream controls" titleAction={<button type="button">End stream</button>} /></MemoryRouter>);
    const action = screen.getByRole('button', { name: 'End stream' });
    expect(action.parentElement).toHaveClass('rf-ttl-row');
    expect(action.parentElement).toContainElement(screen.getByRole('heading', { name: 'Stream controls' }));
  });

  it('marks the current link tab with aria-current', () => {
    render(<MemoryRouter><RefineHeader context="c" title="Season" tabs={[
      { label: 'Standings', to: '/s', active: true }, { label: 'Rounds', to: '/s?tab=rounds', active: false },
    ]} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Standings' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Rounds' })).not.toHaveAttribute('aria-current');
  });

  it('moves between in-page tabs with the arrow keys, Home and End', async () => {
    function Tabs() {
      const [active, setActive] = useState('All');
      return <MemoryRouter><RefineHeader context="c" title="Shop" tabsKind="tablist" tabs={['All', 'Food', 'Raffle'].map((label) => ({ label, active: active === label, onSelect: () => setActive(label) }))} /></MemoryRouter>;
    }
    render(<Tabs />);
    await userEvent.click(screen.getByRole('tab', { name: 'All' }));
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Food' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Raffle' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Home}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Raffle' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('list pieces', () => {
  it('renders sections, status words and disclosures', async () => {
    render(<>
      <RefineSection title="Orders" meta="Test payments only" />
      <RefineList label="Orders"><li><RefineStatus tone="ok">Paid</RefineStatus></li></RefineList>
      <RefineDisclosure title="Place points" sub="10 · 8 · 6"><p>Inputs</p></RefineDisclosure>
      <RefineFoot label="Basket">Footer</RefineFoot>
    </>);
    expect(screen.getByRole('heading', { name: /Orders/ })).toHaveTextContent('Test payments only');
    expect(screen.getByText('Paid')).toHaveClass('rf-ok');
    expect(screen.getByRole('region', { name: 'Basket' })).toBeInTheDocument();
    expect(screen.getByText('Place points').closest('details')).not.toHaveAttribute('open');
  });

  it('steps a quantity within its limits', async () => {
    const onChange = vi.fn();
    const view = render(<RefineQty name="Mug" value={1} max={2} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add one Mug' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove one Mug' }));
    expect(onChange.mock.calls).toEqual([[2], [0]]);
    view.rerender(<RefineQty name="Mug" value={2} max={2} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Add one Mug' })).toBeDisabled();
    view.rerender(<RefineQty name="Mug" value={0} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Remove one Mug' })).toBeDisabled();
  });
});

describe('RefineSheet', () => {
  function Host({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Open</button>
        {open && <RefineSheet title="Refund £5.00?" onClose={() => { setOpen(false); onClose(); }}><input aria-label="Reason" /><button type="button">Confirm</button></RefineSheet>}
      </>
    );
  }

  it('focuses the first field, traps Tab, closes on Esc and returns focus to the opener', async () => {
    const onClose = vi.fn();
    // Still motion: the sheet closes at once instead of sliding away first.
    render(<MotionConfig reducedMotion="always"><Host onClose={onClose} /></MotionConfig>);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'Refund £5.00?' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Reason')).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByLabelText('Reason')).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    expect(opener).toHaveFocus();
  });

  it('closes from the scrim and the close button', async () => {
    const onClose = vi.fn();
    render(<MotionConfig reducedMotion="always"><Host onClose={onClose} /></MotionConfig>);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    document.querySelector<HTMLElement>('.rf-scrim')!.click();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('RefineMenu with text', () => {
  it('opens from a pill button instead of the dots', async () => {
    const user = userEvent.setup();
    const choose = vi.fn();
    render(<RefineMenu text="Make admin" label="Make Sam an admin" items={[{ label: 'Make organiser', onSelect: choose }]} />);
    const button = screen.getByRole('button', { name: 'Make Sam an admin' });
    expect(button).toHaveTextContent('Make admin');
    expect(button).toHaveClass('rf-btn');
    await user.click(button);
    await user.click(screen.getByRole('menuitem', { name: 'Make organiser' }));
    expect(choose).toHaveBeenCalledOnce();
  });
});

describe('RefineMenu', () => {
  it('opens a small menu, runs the chosen item and closes, with Remove-style items in red', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const remove = vi.fn();
    render(<RefineMenu label="More for Red" items={[{ label: 'Change colour', onSelect: change }, { label: 'Remove', onSelect: remove, danger: true }]} />);
    const button = screen.getByRole('button', { name: 'More for Red' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveClass('rf-menu-danger');
    expect(screen.getByRole('menuitem', { name: 'Change colour' })).not.toHaveClass('rf-menu-danger');
    await user.click(screen.getByRole('menuitem', { name: 'Change colour' }));
    expect(change).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(button);
    await user.click(button);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(button);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('floating panels (menus and choice rows)', () => {
  const items = [{ label: 'One', onSelect: vi.fn() }, { label: 'Two', onSelect: vi.fn() }, { label: 'Three', onSelect: vi.fn() }];

  it('moves focus in, points the button at the panel, and moves with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<RefineMenu label="More" items={items} />);
    const button = screen.getByRole('button', { name: 'More' });
    expect(button).not.toHaveAttribute('aria-controls');
    await user.click(button);
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus();
    expect(button).toHaveAttribute('aria-controls', screen.getByRole('menu').parentElement!.id);
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Two' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Three' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Three' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus();
  });

  it('gives focus back to the button on Escape and after choosing something, and closes when focus leaves it', async () => {
    const user = userEvent.setup();
    render(<><RefineMenu label="More" items={items} /><button type="button">Elsewhere</button></>);
    const button = screen.getByRole('button', { name: 'More' });
    await user.click(button);
    await user.keyboard('{Escape}');
    expect(button).toHaveFocus();
    await user.click(button);
    await user.click(screen.getByRole('menuitem', { name: 'Two' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    await user.click(button);
    await user.keyboard('{Tab}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    act(() => { screen.getByRole('button', { name: 'Elsewhere' }).focus(); });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes when the page scrolls, but not when the panel itself scrolls', async () => {
    const user = userEvent.setup();
    render(<RefineMenu label="More" items={items} />);
    await user.click(screen.getByRole('button', { name: 'More' }));
    act(() => { screen.getByRole('menu').parentElement!.dispatchEvent(new Event('scroll')); });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    act(() => { document.dispatchEvent(new Event('scroll')); });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('stays open when the page scrolls to bring a field in the panel into view', async () => {
    const user = userEvent.setup();
    render(<RefineChoiceRow label="Colour" value="red" allowOther options={[{ value: 'red', label: 'Red' }]} onChange={() => undefined} />);
    await user.click(screen.getByRole('button', { name: /Colour/ }));
    await user.click(screen.getByRole('option', { name: 'Other…' }));
    expect(screen.getByRole('textbox')).toHaveFocus();
    act(() => { document.dispatchEvent(new Event('scroll')); });
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});
