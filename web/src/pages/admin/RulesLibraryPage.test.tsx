import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import { RulesLibraryPage } from './RulesLibraryPage';

const auth = vi.hoisted(() => ({ admin: true }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canEdit: () => auth.admin }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../components/RaceDiagram', () => ({ RaceDiagram: () => <div data-testid="diagram" /> }));
vi.mock('../../components/DiagramEditor', () => ({ DiagramEditor: ({ onChange }: { onChange: (json: string) => void }) => <button type="button" onClick={() => onChange('[{"t":"pole"}]')}>change diagram</button> }));
vi.mock('../operations/RulebooksPage', () => ({ RulebooksPanel: () => <p>rulebook panel</p> }));

const race = (id: number, name: string, extra: Record<string, unknown> = {}) => ({ id, name, summary: `${name} summary`, rules: `${name} rules`, category: 'Bending', diagramJson: '[]', isBuiltIn: false, ...extra });
const show = () => render(<MemoryRouter><RulesLibraryPage /></MemoryRouter>);

beforeEach(() => {
  auth.admin = true;
  vi.mocked(api.get).mockResolvedValue({ data: [race(1, 'Pyramid'), race(2, 'Old Sock', { isBuiltIn: true }), race(3, 'Mug')] });
  vi.mocked(api.put).mockImplementation(async (_url, body) => ({ data: { ...race(1, 'Pyramid'), ...(body as object) } }) as never);
});
afterEach(() => { vi.useRealTimers(); });

describe('RulesLibraryPage', () => {
  it('lists the races with a search that filters them, then the rulebooks', async () => {
    const user = userEvent.setup();
    show();
    const list = await screen.findByLabelText('Races');
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['MugMug summary', 'Old SockOld Sock summary', 'PyramidPyramid summary']);
    await user.type(screen.getByRole('searchbox', { name: 'Search races' }), 'socks');
    expect(screen.getByText('No race called that')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'mug');
    expect(within(screen.getByLabelText('Races')).getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', 'Search 3 races');
    expect(screen.getByRole('button', { name: 'New race' })).toHaveClass('ops-addbar');
    await user.click(screen.getByRole('button', { name: 'Manage' }));
    expect(screen.getByText('rulebook panel')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to the rules library' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Rules library' })).toBeInTheDocument();
  });

  it('saves each field when it loses focus and has no Save button', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Pyramid/ }));
    expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();
    const summary = screen.getByLabelText('One-line summary');
    await user.clear(summary);
    await user.type(summary, 'Build it');
    expect(api.put).not.toHaveBeenCalled();
    await user.tab();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/race-templates/1', expect.objectContaining({ name: 'Pyramid', summary: 'Build it', rules: 'Pyramid rules' })));

    const rules = screen.getByLabelText('Rules');
    await user.clear(rules);
    await user.tab();
    await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/race-templates/1', expect.objectContaining({ rules: null })));
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Pyramid 2');
    await user.tab();
    await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/race-templates/1', expect.objectContaining({ name: 'Pyramid 2' })));
    await user.type(screen.getByLabelText('Category'), ' x');
    await user.tab();
    await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/race-templates/1', expect.objectContaining({ category: 'Bending x' })));
  });

  it('keeps the name when it is emptied, and says why a save failed', async () => {
    vi.mocked(api.put).mockRejectedValueOnce(new Error('no'));
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Pyramid/ }));
    await user.clear(screen.getByLabelText('Name'));
    await user.tab();
    expect(screen.getByLabelText('Name')).toHaveValue('Pyramid');
    expect(api.put).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Category'), 'x');
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save that');
  });

  it('saves a diagram change shortly after the last edit', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Pyramid/ }));
    await user.click(screen.getByRole('button', { name: 'Edit diagram' }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => { screen.getByRole('button', { name: 'change diagram' }).click(); });
    expect(api.put).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(api.put).toHaveBeenCalledWith('/race-templates/1', expect.objectContaining({ diagramJson: '[{"t":"pole"}]' }));
  });

  it('sends a pending diagram change when leaving the race', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Pyramid/ }));
    await user.click(screen.getByRole('button', { name: 'Edit diagram' }));
    await user.click(screen.getByRole('button', { name: 'change diagram' }));
    await user.click(screen.getByRole('button', { name: 'Back to the rules library' }));
    expect(api.put).toHaveBeenCalledWith('/race-templates/1', expect.objectContaining({ diagramJson: '[{"t":"pole"}]' }));
  });

  it('adds a race once it has a name, then opens it', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ data: race(9, 'Flag Race') });
    show();
    await user.click(await screen.findByRole('button', { name: 'New race' }));
    await user.type(screen.getByLabelText('Name'), 'Flag Race{Enter}');
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/race-templates', expect.objectContaining({ name: 'Flag Race' })));
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit race' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Flag Race');
  });

  it('does not add a nameless race and reports a failed add', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValueOnce(new Error('no'));
    show();
    await user.click(await screen.findByRole('button', { name: 'New race' }));
    await user.click(screen.getByRole('heading', { level: 1 }));
    expect(api.post).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Name'), 'Flag Race{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t add that race');
  });

  it('deletes a race in red text after asking, and not a built-in one', async () => {
    const asked = autoConfirm([false, true]);
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Old Sock/ }));
    expect(screen.queryByRole('button', { name: 'Delete this race' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to the rules library' }));
    await user.click(screen.getByRole('button', { name: /Pyramid/ }));
    const remove = screen.getByRole('button', { name: 'Delete this race' });
    expect(remove).toHaveClass('ops-danger-link');
    await user.click(remove);
    await waitFor(() => expect(asked).toHaveBeenCalledTimes(1));
    expect(api.delete).not.toHaveBeenCalled();
    await user.click(remove);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/race-templates/1'));
    expect(await screen.findByLabelText('Races')).not.toHaveTextContent('Pyramid');
  });

  it('is read-only for someone who cannot edit, with no add bar', async () => {
    auth.admin = false;
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Pyramid/ }));
    expect(screen.getByText('Pyramid rules')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to the rules library' }));
    expect(screen.queryByRole('button', { name: 'New race' })).not.toBeInTheDocument();
  });

  it('says why the races could not load, and when there are none', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    const first = show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the races');
    first.unmount();
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    show();
    expect(await screen.findByText('No races yet')).toBeInTheDocument();
  });
});
