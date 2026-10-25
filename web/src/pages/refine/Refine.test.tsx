import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { RefineDisclosure, RefineFoot, RefineHeader, RefineList, RefineMenu, RefineQty, RefineSection, RefineSheet, RefineStatus } from './Refine';

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
    render(<Host onClose={onClose} />);
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
    render(<Host onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    document.querySelector<HTMLElement>('.rf-scrim')!.click();
    expect(onClose).toHaveBeenCalledTimes(2);
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
