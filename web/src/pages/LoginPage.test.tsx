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
  ['Team manager', ['Manager'], false],
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
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'Passw0rd!x' } });
  await user.click(screen.getByRole('button', { name: /Create .* account/ }));
  expect(await screen.findByText('Home page')).toBeInTheDocument();
  if (requested) {
    expect(screen.getByRole('status')).toHaveTextContent('Thanks. An admin needs to approve trainer accounts. You can use the app as a member in the meantime.');
  } else {
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  }
});
