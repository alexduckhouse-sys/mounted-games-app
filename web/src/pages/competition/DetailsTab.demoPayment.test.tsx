import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition } from '../../test/factories';
import { DetailsTab, SectionEntryPage } from './DetailsTab';

const state = vi.hoisted(() => ({ detail: null as unknown }));

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('./context', async (importOriginal) => ({ ...(await importOriginal<typeof import('./context')>()), useCompetition: () => ({ competition: state.detail, reload: vi.fn() }) }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1' }, canEdit: () => false, canManage: () => false, canOrganise: () => false, hasRole: () => false,
  }),
}));

const post = vi.mocked(api.post);

function section(priceMinor = 1500) {
  return {
    id: 9, competitionId: 1, format: 0, ageGroup: 'U12', displayName: 'Seniors teams', priceMinor,
    maxParticipants: null, usesRaceFinals: false, finalistCount: 0,
  };
}

function renderDetails() {
  return render(
    <MemoryRouter initialEntries={['/competitions/1/details']}>
      <Routes>
        <Route path="/competitions/:id/details" element={<DetailsTab />} />
        <Route path="/competitions/:id/enter/:sectionId" element={<SectionEntryPage />} />
        <Route path="/me/signups/:signupId/test-payment" element={<p>Test payment page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openForm() {
  await userEvent.click(await screen.findByRole('button', { name: /Join/ }));
}

async function confirmAs(name: string) {
  await userEvent.type(screen.getByLabelText('Your full name'), name);
  await userEvent.click(screen.getByRole('checkbox', { name: 'I agree' }));
  await userEvent.click(screen.getByRole('button', { name: /Confirm/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({ data: [] } as never);
});

describe('entering a competition', () => {
  it('takes a paid entry on a demo event straight to the test payment page', async () => {
    state.detail = competition({ isDemo: true, sections: [section()] as never });
    post.mockResolvedValue({ data: { id: 77, status: 0, amountMinor: 1500 } } as never);
    renderDetails();
    await openForm();
    await confirmAs('Ann Rider');

    expect(await screen.findByText('Test payment page')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/competitions/1/sections/9/signups', expect.objectContaining({ fullName: 'Ann Rider' }));
  });

  it('keeps a real event on pay-the-organiser: no test page, and the old wording', async () => {
    state.detail = competition({ sections: [section()] as never });
    post.mockResolvedValue({ data: { id: 78, status: 0, amountMinor: 1500 } } as never);
    renderDetails();
    await openForm();
    expect(screen.getByText('Paid entries stay pending until the organiser confirms payment.')).toBeInTheDocument();
    await confirmAs('Ann Rider');

    expect(await screen.findByText('Your entry is saved. Payment is still due.')).toBeInTheDocument();
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(screen.queryByText('Test payment page')).not.toBeInTheDocument();
  });

  it('does not send a free demo entry to the test page', async () => {
    state.detail = competition({ isDemo: true, sections: [section(0)] as never });
    post.mockResolvedValue({ data: { id: 79, status: 1, amountMinor: 0 } } as never);
    renderDetails();
    await openForm();
    expect(screen.getByText(/After you confirm, you will see a test payment page/)).toBeInTheDocument();
    await confirmAs('Ann Rider');

    expect(await screen.findByText('Your entry is confirmed.')).toBeInTheDocument();
    expect(screen.queryByText('Test payment page')).not.toBeInTheDocument();
  });
});
