import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, expect, it } from 'vitest';
import { BackLink } from './BackLink';

function Where() { return <span data-testid="at">{useLocation().pathname}</span>; }
const Page = () => <><Where /><Link to="/child">Open child</Link><BackLink to="/parent">Back</BackLink></>;

function app() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/start" element={<Navigate to="/landed" replace />} />
        <Route path="*" element={<Page />} />
      </Routes>
    </BrowserRouter>
  );
}

beforeEach(() => { window.history.replaceState(null, '', '/list'); });

it('goes to the previous page when the person navigated here', async () => {
  const user = userEvent.setup();
  render(app());
  await user.click(screen.getByRole('link', { name: 'Open child' }));
  expect(screen.getByTestId('at')).toHaveTextContent('/child');
  await user.click(screen.getByRole('link', { name: 'Back' }));
  await waitFor(() => expect(screen.getByTestId('at')).toHaveTextContent('/list'));
});

it('falls back to the fixed parent on a fresh load', async () => {
  const user = userEvent.setup();
  render(app());
  await user.click(screen.getByRole('link', { name: 'Back' }));
  expect(screen.getByTestId('at')).toHaveTextContent('/parent');
});

it('falls back to the fixed parent when the first entry was replaced by a redirect', async () => {
  window.history.replaceState(null, '', '/start');
  const user = userEvent.setup();
  render(app());
  expect(screen.getByTestId('at')).toHaveTextContent('/landed');
  await user.click(screen.getByRole('link', { name: 'Back' }));
  expect(screen.getByTestId('at')).toHaveTextContent('/parent');
});
