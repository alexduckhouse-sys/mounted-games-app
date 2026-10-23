import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, confirmDialog, useConfirm } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('says what will happen and puts focus on Cancel', () => {
    render(<ConfirmDialog title="Delete this race?" message="It goes for good." confirmLabel="Delete race" onAnswer={vi.fn()} />);
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this race?' });
    expect(dialog).toHaveAccessibleDescription('It goes for good.');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Delete race' })).toBeInTheDocument();
  });

  it('is red when destructive and neutral otherwise', () => {
    const { rerender } = render(<ConfirmDialog title="Delete?" message="m" destructive onAnswer={vi.fn()} />);
    expect(screen.getByRole('alertdialog')).toHaveClass('mg-confirm-danger');
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveClass('mg-btn-danger');
    rerender(<ConfirmDialog title="Reload?" message="m" cancelLabel="Not now" onAnswer={vi.fn()} />);
    expect(screen.getByRole('alertdialog')).not.toHaveClass('mg-confirm-danger');
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveClass('mg-btn-primary');
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
  });

  it('answers yes, no, Escape and a tap on the backdrop', async () => {
    const onAnswer = vi.fn();
    const { container } = render(<ConfirmDialog title="t" message="m" onAnswer={onAnswer} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onAnswer).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
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
    render(<ConfirmDialog title="t" message="m" onAnswer={vi.fn()} />);
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
    expect(document.querySelector('.mg-confirm-backdrop')).toBeNull();

    const no = confirmDialog({ title: 'Remove?', message: 'Gone for good.' });
    await screen.findByRole('alertdialog');
    await userEvent.keyboard('{Escape}');
    await expect(no).resolves.toBe(false);
  });

  it('is what useConfirm gives back', () => {
    expect(useConfirm()).toBe(confirmDialog);
  });
});
