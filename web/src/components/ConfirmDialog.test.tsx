import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, confirmDialog, useConfirm } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('says what will happen and puts focus on Cancel for a delete', () => {
    render(<ConfirmDialog title="Delete this race?" message="It goes for good." confirmLabel="Delete race" destructive onAnswer={vi.fn()} />);
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this race?' });
    expect(dialog).toHaveAccessibleDescription('It goes for good.');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Delete race' })).toBeInTheDocument();
  });

  it('is a delete-type sheet when destructive: Cancel first, then a filled red button', () => {
    render(<ConfirmDialog title="Delete?" message="m" destructive confirmLabel="Delete it" onAnswer={vi.fn()} />);
    expect(screen.getByRole('alertdialog')).toHaveClass('mg-confirm-danger');
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Cancel', 'Delete it']);
    expect(buttons[0]).toHaveClass('kit-pill');
    expect(buttons[0]).not.toHaveClass('kit-pill-fill');
    expect(buttons[1]).toHaveClass('kit-pill-del');
    expect(buttons[0].parentElement).toHaveClass('kit-acts-del');
    expect(screen.getByRole('alertdialog').querySelector('.mg-confirm-head')).toBeNull();
  });

  it('is a go-ahead sheet otherwise: the filled navy action first, then "Not now"', () => {
    render(<ConfirmDialog title="Reload?" message="m" confirmLabel="Reload now" onAnswer={vi.fn()} />);
    expect(screen.getByRole('alertdialog')).not.toHaveClass('mg-confirm-danger');
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Reload now', 'Not now']);
    expect(buttons[0]).toHaveClass('kit-pill-fill');
    expect(buttons[0]).toHaveFocus();
  });

  it('lets the caller name the safe choice', () => {
    render(<ConfirmDialog title="Cancel this invite?" message="m" destructive cancelLabel="Keep invite" confirmLabel="Cancel invite" onAnswer={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Keep invite' })).toBeInTheDocument();
  });

  it('answers yes, no, Escape and a tap on the backdrop', async () => {
    const onAnswer = vi.fn();
    const { container } = render(<ConfirmDialog title="t" message="m" onAnswer={onAnswer} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onAnswer).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onAnswer).toHaveBeenLastCalledWith(false);
    onAnswer.mockClear();
    await userEvent.keyboard('{Escape}');
    expect(onAnswer).toHaveBeenLastCalledWith(false);
    onAnswer.mockClear();
    await userEvent.click(screen.getByRole('alertdialog'));
    expect(onAnswer).not.toHaveBeenCalled();
    await userEvent.pointer({ target: container.querySelector('.mg-confirm-backdrop')!, keys: '[MouseLeft]' });
    expect(onAnswer).toHaveBeenLastCalledWith(false);
  });

  it('keeps Tab inside the dialog', async () => {
    render(<ConfirmDialog title="t" message="m" destructive onAnswer={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();
  });

  it('holds the confirm button until the required words are typed', async () => {
    render(<ConfirmDialog title="t" message="m" confirmLabel="Delete" requireText="Spring Games" onAnswer={vi.fn()} />);
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), 'Spring');
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), ' Games');
    expect(confirm).toBeEnabled();
  });
});

describe('confirmDialog', () => {
  it('opens over the page, resolves with the answer and cleans up after itself', async () => {
    const yes = confirmDialog({ title: 'Remove?', message: 'Gone for good.', confirmLabel: 'Remove', destructive: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await expect(yes).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.querySelector('.mg-confirm-backdrop:not(.mg-confirm-leaving)')).toBeNull();
    await waitFor(() => expect(document.querySelector('.mg-confirm-backdrop')).toBeNull());

    const no = confirmDialog({ title: 'Remove?', message: 'Gone for good.' });
    await screen.findByRole('alertdialog');
    await userEvent.keyboard('{Escape}');
    await expect(no).resolves.toBe(false);
  });

  it('opens in its own modal <dialog>, so it stacks above a Sheet that is already open', async () => {
    const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
    const original = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = showModal;
    try {
      const sheet = document.createElement('dialog');
      document.body.appendChild(sheet);
      sheet.setAttribute('open', '');
      const answer = confirmDialog({ title: 'Call the vet?', message: 'Sends an alert.', confirmLabel: 'Call vet' });
      const yes = await screen.findByRole('button', { name: 'Call vet' });
      const host = yes.closest('dialog.mg-confirm-host');
      expect(host).not.toBeNull();
      expect(host).not.toBe(sheet);
      expect(showModal).toHaveBeenCalledTimes(1);
      expect(host!.hasAttribute('open')).toBe(true);
      await userEvent.click(yes);
      await expect(answer).resolves.toBe(true);
      sheet.remove();
    } finally {
      HTMLDialogElement.prototype.showModal = original;
    }
  });

  it('leaves on a hidden, inert copy that goes once its animation ends', async () => {
    const answer = confirmDialog({ title: 'Remove?', message: 'Gone for good.', confirmLabel: 'Remove' });
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await expect(answer).resolves.toBe(true);
    const ghost = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.mg-confirm-leaving');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(ghost).toHaveAttribute('aria-hidden', 'true');
    expect(ghost.inert).toBe(true);
    expect(ghost.querySelector('[role]')).toBeNull();
    fireEvent.animationEnd(ghost.querySelector('.mg-confirm')!);
    expect(ghost.isConnected).toBe(false);
  });

  it('answers only once, even if a second answer comes in while it leaves', async () => {
    const answer = confirmDialog({ title: 'Remove?', message: 'Gone for good.', confirmLabel: 'Remove' });
    const remove = await screen.findByRole('button', { name: 'Remove' });
    fireEvent.click(remove);
    fireEvent.click(remove);
    await expect(answer).resolves.toBe(true);
    await waitFor(() => expect(document.querySelectorAll('.mg-confirm-leaving').length).toBeLessThanOrEqual(1));
  });

  it.each([
    ['lite mode', () => { document.documentElement.dataset.lite = 'true'; }],
    ['reduced motion', () => { vi.stubGlobal('matchMedia', () => ({ matches: true })); }],
  ])('closes at once with %s', async (_name, setUp) => {
    setUp();
    const answer = confirmDialog({ title: 'Remove?', message: 'Gone for good.', confirmLabel: 'Remove' });
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await expect(answer).resolves.toBe(true);
    await waitFor(() => expect(document.querySelector('.mg-confirm-backdrop')).toBeNull());
    expect(document.querySelector('.mg-confirm-leaving')).toBeNull();
    delete document.documentElement.dataset.lite;
    vi.unstubAllGlobals();
  });

  it('is what useConfirm gives back', () => {
    expect(useConfirm()).toBe(confirmDialog);
  });
});
