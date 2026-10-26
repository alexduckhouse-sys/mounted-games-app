import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { NotFoundPage } from './NotFoundPage';

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/events', '/old-link']} initialIndex={1}>
      <Routes>
        <Route path="/old-link" element={<NotFoundPage />} />
        <Route path="*" element={<p>Somewhere else</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

describe('NotFoundPage', () => {
  it('says the page was not found in plain words, with no card around it', () => {
    const { container } = mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByText('We couldn’t find that page. The link may be old or mistyped.')).toBeInTheDocument();
    expect(container.querySelector('.mg-card')).toBeNull();
  });

  it('has a filled See competitions pill and an outlined Go back pill', () => {
    mount();
    const see = screen.getByRole('link', { name: 'See competitions' });
    expect(see).toHaveAttribute('href', '/events');
    expect(see).toHaveClass('sp-pill', 'sp-pill-fill');
    const back = screen.getByRole('button', { name: 'Go back' });
    expect(back).toHaveClass('sp-pill');
    expect(back).not.toHaveClass('sp-pill-fill');
    expect(screen.queryByRole('link', { name: /Browse events|Go to home/ })).not.toBeInTheDocument();
  });

  it('goes back to the page you came from', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/events');
    expect(screen.getByText('Somewhere else')).toBeInTheDocument();
  });
});
