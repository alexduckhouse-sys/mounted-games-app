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
