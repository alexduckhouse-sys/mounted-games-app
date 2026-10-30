import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionConfig } from 'framer-motion';
import { describe, expect, it, vi } from 'vitest';
import { RaceToolsSheet, type ToolTeam } from './RaceToolsSheet';

const team = (teamId: number, name: string): ToolTeam => ({ teamId, name, points: 3, card: null, hc: false } as unknown as ToolTeam);

function mount(onClose = vi.fn()) {
  render(
    <MotionConfig reducedMotion="always">
      <RaceToolsSheet
        teams={[team(1, 'Red Team'), team(2, 'Blue Team')]}
        canHc
        canCards
        canChangePoints
        onHc={vi.fn()}
        onYellow={vi.fn()}
        onRed={vi.fn()}
        onClearCard={vi.fn()}
        onStepPoints={vi.fn()}
        links={[]}
        onClose={onClose}
      />
    </MotionConfig>,
  );
  return onClose;
}

describe('RaceToolsSheet team menus', () => {
  it('closes a team menu with a tap anywhere outside it, but not on its own button or inside the menu', async () => {
    mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More for Red Team' }));
    expect(screen.getByRole('menu', { name: 'Red Team' })).toBeInTheDocument();

    // Inside the menu (not on an item): stays open.
    fireEvent.pointerDown(screen.getByRole('menu', { name: 'Red Team' }));
    expect(screen.getByRole('menu', { name: 'Red Team' })).toBeInTheDocument();

    // Elsewhere in the sheet: closes.
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'Using a keypad' }));
    expect(screen.queryByRole('menu')).toBeNull();

    // Its own ⋯ button still toggles it.
    await user.click(screen.getByRole('button', { name: 'More for Red Team' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'More for Red Team' }));
    expect(screen.queryByRole('menu')).toBeNull();

    // Outside the sheet altogether (the dim behind it).
    await user.click(screen.getByRole('button', { name: 'More for Blue Team' }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('lets another team\'s button swap the menu', async () => {
    mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More for Red Team' }));
    await user.click(screen.getByRole('button', { name: 'More for Blue Team' }));
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(screen.getByRole('menu', { name: 'Blue Team' })).toBeInTheDocument();
  });

  it('closes just the menu on Escape, and the sheet on the next Escape', async () => {
    const onClose = mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More for Red Team' }));
    const sheet = screen.getByRole('dialog', { name: 'Race tools' });
    expect(within(sheet).getByRole('menu')).toBeInTheDocument();

    // Whatever the browser does with the dialog's own cancel for that Escape, the sheet stays.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(fireEvent(sheet, new Event('cancel', { cancelable: true }))).toBe(false);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // With no menu open, Escape reaches the sheet as usual.
    await new Promise((resolve) => setTimeout(resolve, 200));
    fireEvent(sheet, new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes a menu when a choice is made', async () => {
    mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More for Red Team' }));
    await user.click(screen.getByRole('menuitem', { name: 'Make HC' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
