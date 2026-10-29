import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: { get: () => Promise.resolve({ data: [] }), post: () => Promise.resolve({ data: {} }) },
}));

afterEach(() => window.history.replaceState(null, '', '/'));

describe('the old /register address', () => {
  it('lands on the sign up page', async () => {
    window.history.replaceState(null, '', '/register');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Create an account' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/signup');
  });
});

describe('the old Format page address', () => {
  it('goes to Before the day for that competition', async () => {
    window.history.replaceState(null, '', '/admin/competitions/4/format');
    render(<App />);
    await vi.waitFor(() => expect(window.location.pathname).not.toBe('/admin/competitions/4/format'));
    expect(window.location.pathname).toBe('/competitions/4/operations');
  });
});
