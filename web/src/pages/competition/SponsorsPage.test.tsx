import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SponsorsPage } from './SponsorsPage';

describe('SponsorsPage', () => {
  it('redirects /competitions/:id/sponsors to DetailsTab', () => {
    render(
      <MemoryRouter initialEntries={['/competitions/6/sponsors']}>
        <Routes>
          <Route path="/competitions/:id">
            <Route path="sponsors" element={<SponsorsPage />} />
            <Route path="details" element={<p>Details page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Details page')).toBeInTheDocument();
  });
});
