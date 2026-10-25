import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { EquipmentPage } from './EquipmentPage';

vi.mock('../competition/context', () => ({ useCompetition: () => ({ competition: { id: 7, name: 'Spring Open' }, reload: vi.fn() }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn() } }));

const row = (key: string, kind: string, bucket: string, count: number, acknowledged = false) => ({ key, kind, bucket, count, acknowledged, acknowledgedAt: null });
const readiness = {
  equipmentFingerprint: 'fp-1',
  equipmentChecklist: [
    row('Lane|Pole|30', 'Pole', 'Lane', 30),
    row('Lane|Stepping stone|36', 'Stepping stone', 'Lane', 36),
    row('Start|Baton|12', 'Baton', 'Start', 12),
    row('Top|Baton|6', 'Baton', 'Top', 6, true),
  ],
};

function show() {
  return render(<MemoryRouter><EquipmentPage /></MemoryRouter>);
}

describe('EquipmentPage', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({ data: readiness });
    vi.mocked(api.put).mockResolvedValue({ data: readiness });
  });

  it('groups big and little equipment and counts stepping stones as sets, with no sub-lines', async () => {
    show();
    const bigList = (await screen.findByLabelText('Big equipment')) as HTMLElement;
    expect(within(bigList).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(bigList).getByText('6 × Stepping stone set')).toBeInTheDocument();
    expect(within(bigList).getByText('30 × Pole')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Little equipment')).getByText('18 × Baton')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Big equipment/ })).toHaveTextContent('0 of 2');
    expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();
  });

  it('saves every tick straight away', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('checkbox', { name: '30 × Pole' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/operations/equipment-acknowledgements',
      { acknowledgedKeys: ['Top|Baton|6', 'Lane|Pole|30'], expectedFingerprint: 'fp-1' }));
  });

  it('ticks all the parts of a merged row together, and a part-ticked row shows as unticked', async () => {
    const user = userEvent.setup();
    show();
    const baton = await screen.findByRole('checkbox', { name: '18 × Baton' });
    expect(baton).not.toBeChecked();
    await user.click(baton);
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(expect.any(String), { acknowledgedKeys: ['Top|Baton|6', 'Start|Baton|12'], expectedFingerprint: 'fp-1' }));
  });

  it('refreshes and says so when another device changed the list', async () => {
    vi.mocked(api.put).mockRejectedValueOnce({ response: { status: 409 } });
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('checkbox', { name: '30 × Pole' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('changed on another device');
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('shows why the list could not load, and an empty list plainly', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    const first = show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the equipment list');
    first.unmount();
    vi.mocked(api.get).mockResolvedValue({ data: { ...readiness, equipmentChecklist: [] } });
    show();
    expect(await screen.findByText(/No equipment items/)).toBeInTheDocument();
  });
});
