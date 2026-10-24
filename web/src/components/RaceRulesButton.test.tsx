import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { RaceTemplate } from '../types';
import { resetRaceTemplates } from '../lib/raceTemplates';
import { RaceRulesButton } from './RaceRulesButton';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn() },
}));

const bending: RaceTemplate = {
  id: 1, name: 'Bending', isBuiltIn: true, summary: 'Weave through the poles.', rules: 'Go up the lane.\nCome back.',
  diagramJson: JSON.stringify([{ t: 'pole', x: 20 }, { t: 'pole', x: 40 }, { t: 'item', kind: 'mug' }]),
};
const bare: RaceTemplate = { id: 2, name: 'Sack', isBuiltIn: false };

beforeEach(() => {
  resetRaceTemplates();
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockResolvedValue({ data: [bending, bare] });
});

describe('RaceRulesButton', () => {
  it('opens a labelled dialog with the rules and equipment, matching the name loosely', async () => {
    render(<RaceRulesButton raceName=" bending " />);
    const button = screen.getByRole('button', { name: 'Rules for bending' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'bending' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect((await screen.findAllByText('Weave through the poles.')).length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Rules' })).toHaveTextContent('Go up the lane.');
    expect(screen.getByRole('region', { name: 'Equipment' })).toHaveTextContent('2 × Pole');
    expect(screen.getByRole('region', { name: 'Equipment' })).toHaveTextContent('Mug');
    expect(screen.getByRole('region', { name: 'How to win & common eliminations' })).toHaveTextContent('Go up the lane.');
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('supports a custom label for race header triggers', () => {
    render(<RaceRulesButton raceName="Bending" label="Bending" />);
    expect(screen.getByRole('button', { name: 'Rules for Bending' })).toHaveTextContent('Bending');
  });

  it('closes on Escape and returns focus to the button', async () => {
    render(<RaceRulesButton raceName="Bending" />);
    const button = screen.getByRole('button', { name: 'Rules for Bending' });
    await userEvent.click(button);
    await screen.findAllByText('Weave through the poles.');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(button).toHaveFocus());
  });

  it('closes from the backdrop and the close button, but not from a click inside the sheet', async () => {
    render(<RaceRulesButton raceName="Bending" />);
    await userEvent.click(screen.getByRole('button', { name: 'Rules for Bending' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.pointerDown(dialog);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.pointerDown(dialog.parentElement!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Rules for Bending' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Close rules' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps Tab inside the dialog', async () => {
    render(<RaceRulesButton raceName="Bending" />);
    await userEvent.click(screen.getByRole('button', { name: 'Rules for Bending' }));
    const close = await screen.findByRole('button', { name: 'Close rules' });
    expect(close).toHaveFocus();
    await userEvent.tab();
    expect(close).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(close).toHaveFocus();
  });

  it('says so when a race has no rules yet', async () => {
    render(<><RaceRulesButton raceName="Sack" /><RaceRulesButton raceName="Mystery" /></>);
    await userEvent.click(screen.getByRole('button', { name: 'Rules for Sack' }));
    expect(await screen.findByText('No rules have been added for this race yet.')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Rules for Mystery' }));
    expect(await screen.findByText('No rules have been added for this race yet.')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('lets the visitor retry when the rules do not load', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    render(<RaceRulesButton raceName="Bending" />);
    await userEvent.click(screen.getByRole('button', { name: 'Rules for Bending' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the rules');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findAllByText('Weave through the poles.')).length).toBeGreaterThan(0);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('does not trigger a click on a parent link or row', async () => {
    const parent = vi.fn();
    render(<div onClick={parent}><RaceRulesButton raceName="Bending" /></div>);
    await userEvent.click(screen.getByRole('button', { name: 'Rules for Bending' }));
    expect(parent).not.toHaveBeenCalled();
  });
});


it('quotes the actual game rules without inventing generic dismount or elimination rules', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [{ id: 3, name: 'Stepping Stones', isBuiltIn: true,
    summary: 'Cross the stones on foot.',
    rules: 'Riders dismount before the stones on the Centre Line. Knocking stones means returning to the start of the stones. The winning team finishes with all six stones standing.',
  }] });
  render(<RaceRulesButton raceName="Stepping Stones" />);
  await userEvent.click(screen.getByRole('button', { name: 'Rules for Stepping Stones' }));
  const highlights = await screen.findByRole('region', { name: 'How to win & common eliminations' });
  expect(within(highlights).getAllByRole('listitem')).toHaveLength(3);
  expect(highlights).toHaveTextContent('The winning team finishes with all six stones standing.');
  expect(highlights).toHaveTextContent('Knocking stones means returning to the start of the stones.');
  expect(highlights).not.toHaveTextContent('behind the start/finish');
  expect(highlights).not.toHaveTextContent('Common eliminations:');
});
