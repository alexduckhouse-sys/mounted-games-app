import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { api } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import { TrainerAccountNotice } from '../components/TrainerAccountNotice';
import { LoginPage } from './LoginPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

it.each([
  ['Trainer', ['Member', 'TrainerRequest'], true],
  ['Team manager', ['Member', 'ManagerRequest'], true],
  ['Pony Club member', ['Member'], false],
] as const)('shows the appropriate signup result for %s', async (label, roles, requested) => {
  const profile = { id: 'test-user', email: 'test@example.com', fullName: 'Test Applicant', clubId: null, clubName: null, roles };
  vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/clubs' ? [] : profile }));
  vi.mocked(api.post).mockResolvedValue({ data: { token: 'test-token', expiresAt: '2099-01-01T00:00:00Z', user: profile } });
  render(<AuthProvider><MemoryRouter initialEntries={['/login']}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/" element={<><p>Home page</p><TrainerAccountNotice /></>} />
  </Routes></MemoryRouter></AuthProvider>);

  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Sign up' }));
  if (label !== 'Trainer') await user.click(screen.getByRole('button', { name: label }));
  fireEvent.change(screen.getByRole('textbox', { name: /Username/ }), { target: { value: 'test-applicant' } });
  fireEvent.change(screen.getByLabelText(/Pony Club or team/), { target: { value: 'Stockport PC' } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'Passw0rd!x' } });
  await user.click(screen.getByRole('button', { name: /Create .* account/ }));
  expect(await screen.findByText('Home page')).toBeInTheDocument();
  if (requested) {
    expect(screen.getByRole('status')).toHaveTextContent('Thanks. Your request needs approving before you can organise. You can use the app as a member in the meantime.');
  } else {
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  }
});

it('asks for a club or team name, and sends it with the signup', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  vi.mocked(api.post).mockResolvedValue({ data: { token: 't', expiresAt: '2099-01-01T00:00:00Z', user: { id: 'u', email: 'e', fullName: 'F', clubId: 1, clubName: 'Welsh Dragons', roles: ['Member'] } } });
  render(<AuthProvider><MemoryRouter initialEntries={['/login']}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/" element={<p>Home page</p>} />
  </Routes></MemoryRouter></AuthProvider>);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Sign up' }));
  expect(screen.getByLabelText(/Pony Club or team/)).toBeRequired();
  expect(screen.queryByText('(optional)')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: /Username/ }), { target: { value: 'new-person' } });
  fireEvent.change(screen.getByLabelText(/Pony Club or team/), { target: { value: '  Welsh Dragons ' } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'Passw0rd!x' } });
  await user.click(screen.getByRole('button', { name: /Create .* account/ }));
  await screen.findByText('Home page');
  expect(api.post).toHaveBeenCalledWith('/auth/signup-trainer', expect.objectContaining({ clubName: 'Welsh Dragons' }));
});
