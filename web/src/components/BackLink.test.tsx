import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { expect, it } from 'vitest';
import { BackLink } from './BackLink';

function Where() { return <span data-testid="at">{useLocation().pathname}</span>; }

function app(initial: string[]) {
  return (
    <MemoryRouter initialEntries={initial} initialIndex={initial.length - 1}>
      <Routes>
        <Route path="*" element={<><Where /><Link to="/child">Open child</Link><BackLink to="/parent">Back</BackLink></>} />
      </Routes>
    </MemoryRouter>
  );
}

it('goes to the previous page when the person navigated here', async () => {
  const user = userEvent.setup();
  render(app(['/list']));
  await user.click(screen.getByRole('link', { name: 'Open child' }));
  expect(screen.getByTestId('at')).toHaveTextContent('/child');
  await user.click(screen.getByRole('link', { name: 'Back' }));
  expect(screen.getByTestId('at')).toHaveTextContent('/list');
});

it('falls back to the fixed parent on a fresh load', async () => {
  const user = userEvent.setup();
  render(app(['/deep']));
  await user.click(screen.getByRole('link', { name: 'Back' }));
  expect(screen.getByTestId('at')).toHaveTextContent('/parent');
});
