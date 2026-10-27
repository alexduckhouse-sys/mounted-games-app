import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedScore } from '../offline/scoreOutbox';
import { api } from '../api';
import { scorerApi } from '../offline/scorerLink';
import { flushOutbox } from '../offline/useScoreOutbox';
import { OutboxTransfer } from './OutboxTransfer';

vi.mock('../api', () => ({ api: { post: vi.fn().mockResolvedValue({ data: {} }) } }));
vi.mock('../offline/scorerLink', () => ({ scorerApi: { post: vi.fn() } }));

const KEY = 'mg.outbox.scores';
const queued = (raceId: number, competitionId = 1): QueuedScore => ({
  raceId, competitionId, sessionId: 7, label: `Race ${raceId}`,
  places: [{ teamId: 1, place: 1, eliminated: false }], expected: [], teamNames: { 1: 'Red Rum' },
  queuedAt: '2026-06-01T10:00:00Z', state: 'waiting',
});
const seed = (...items: QueuedScore[]) => localStorage.setItem(KEY, JSON.stringify(items));
const offline = () => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

beforeEach(() => { offline(); });

describe('OutboxTransfer', () => {
  it('offers sending only when this competition has unsent scores', () => {
    render(<OutboxTransfer competitionId={1} />);
    expect(screen.queryByText('Send unsent scores to another phone')).toBeNull();
    expect(screen.getByText('Import scores from another phone')).toBeInTheDocument();
  });

  it('renders nothing with no scores and import hidden', () => {
    const { container } = render(<OutboxTransfer competitionId={1} showImport={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('copies the backup and says so', async () => {
    seed(queued(1), queued(2, 9));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<OutboxTransfer competitionId={1} competitionName="Spring" />);
    await userEvent.click(screen.getByText('Send unsent scores to another phone'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(await screen.findByText(/Backup copied/)).toBeInTheDocument();
  });

  it('says when it could neither share nor copy', async () => {
    seed(queued(1));
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(<OutboxTransfer competitionId={1} />);
    await userEvent.click(screen.getByText('Send unsent scores to another phone'));
    expect(await screen.findByText(/Couldn’t share or copy/)).toBeInTheDocument();
  });

  it('shows a share confirmation', async () => {
    seed(queued(1));
    Object.defineProperty(navigator, 'share', { value: vi.fn().mockResolvedValue(undefined), configurable: true });
    render(<OutboxTransfer competitionId={1} />);
    await userEvent.click(screen.getByText('Send unsent scores to another phone'));
    expect(await screen.findByText('Backup shared')).toBeInTheDocument();
  });

  it('imports a pasted backup and counts the races added', async () => {
    render(<OutboxTransfer competitionId={1} />);
    await userEvent.click(screen.getByText('Import scores from another phone'));
    const add = screen.getByRole('button', { name: 'Add scores' });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Backup'), { target: { value: JSON.stringify([queued(3), queued(4)]) } });
    await userEvent.click(add);
    expect(await screen.findByText('2 races added')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toHaveLength(2);
  });

  it('says one race was added', async () => {
    render(<OutboxTransfer competitionId={1} />);
    await userEvent.click(screen.getByText('Import scores from another phone'));
    fireEvent.change(screen.getByLabelText('Backup'), { target: { value: JSON.stringify([queued(3)]) } });
    await userEvent.click(screen.getByRole('button', { name: 'Add scores' }));
    expect(await screen.findByText('1 race added')).toBeInTheDocument();
  });

  it('imports for the account even when another scorer link is stored', async () => {
    localStorage.setItem('mg.scorer.token', 'synthetic-old-scorer-token');
    render(<OutboxTransfer competitionId={1} />);
    await userEvent.click(screen.getByText('Import scores from another phone'));
    fireEvent.change(screen.getByLabelText('Backup'), { target: { value: JSON.stringify([{ ...queued(3), viaLink: true }]) } });
    await userEvent.click(screen.getByRole('button', { name: 'Add scores' }));

    const imported = JSON.parse(localStorage.getItem(KEY) ?? '[]') as QueuedScore[];
    expect(imported).toHaveLength(1);
    expect(imported[0].raceId).toBe(3);
    expect(Boolean(imported[0].viaLink)).toBe(false);

    vi.mocked(api.post).mockResolvedValue({ data: {} });
    await act(async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      await flushOutbox();
    });
    expect(api.post).toHaveBeenCalledWith('/races/3/results', expect.anything(), expect.anything());
    expect(scorerApi.post).not.toHaveBeenCalled();
  });

  it('rejects a backup for another competition without changing the outbox', async () => {
    seed(queued(1));
    render(<OutboxTransfer competitionId={1} />);
    await userEvent.click(screen.getByText('Import scores from another phone'));
    fireEvent.change(screen.getByLabelText('Backup'), { target: { value: JSON.stringify([queued(3, 2)]) } });
    await userEvent.click(screen.getByRole('button', { name: 'Add scores' }));

    expect(await screen.findByText(/That backup could not be read/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual([queued(1)]);
  });

  it('explains a bad backup and clears the message when editing or closing', async () => {
    render(<OutboxTransfer competitionId={1} />);
    await userEvent.click(screen.getByText('Import scores from another phone'));
    fireEvent.change(screen.getByLabelText('Backup'), { target: { value: 'nonsense' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add scores' }));
    expect(await screen.findByText(/could not be read/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Backup'), { target: { value: 'x' } });
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });

  it('reads a chosen file into the box', async () => {
    render(<OutboxTransfer competitionId={1} />);
    await userEvent.click(screen.getByText('Import scores from another phone'));
    const file = new File(['[]'], 'backup.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Or choose a saved backup file'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByLabelText('Backup')).toHaveValue('[]'));
    fireEvent.change(screen.getByLabelText('Or choose a saved backup file'), { target: { files: [] } });
  });

  it('reports a file that cannot be read', async () => {
    render(<OutboxTransfer competitionId={1} />);
    await userEvent.click(screen.getByText('Import scores from another phone'));
    const file = new File(['x'], 'b.json');
    Object.defineProperty(file, 'text', { value: () => Promise.reject(new Error('no')) });
    fireEvent.change(screen.getByLabelText('Or choose a saved backup file'), { target: { files: [file] } });
    expect(await screen.findByText('That file could not be read.')).toBeInTheDocument();
  });

  it('closes the import sheet with Escape', async () => {
    render(<OutboxTransfer competitionId={1} />);
    await userEvent.click(screen.getByText('Import scores from another phone'));
    fireEvent.keyDown(screen.getByRole('dialog', { hidden: true }), { key: 'Escape' });
    fireEvent(screen.getByRole('dialog', { hidden: true }), new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByLabelText('Backup')).toBeNull());
  });
});
