import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { HeatPickerBar } from './HeatViews';

vi.mock('../../components/ConfirmDialog', () => ({ confirmDialog: vi.fn() }));

const items = [{ key: 'a', label: 'Main · Seniors · Heat 1', status: 'On now', selected: true, onSelect: vi.fn() }];

describe('HeatPickerBar back button', () => {
  it('has no back arrow unless asked', () => {
    render(<MemoryRouter><HeatPickerBar arena="Main" label="Seniors · Heat 1" items={items} /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'Back to scoring' })).toBeNull();
  });

  it('goes back to the page the scorer came from', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/competitions/1/timetable', '/competitions/1/session/9']} initialIndex={1}>
        <Routes>
          <Route path="/competitions/1/timetable" element={<p>Timetable page</p>} />
          <Route path="/competitions/1/scoring" element={<p>Scoring list</p>} />
          <Route path="/competitions/1/session/9" element={<><Link to="/x">x</Link><HeatPickerBar arena="Main" label="Seniors · Heat 1" items={items} back={{ to: '/competitions/1/scoring', label: 'Back to scoring' }} /></>} />
        </Routes>
      </MemoryRouter>,
    );
    const back = screen.getByRole('link', { name: 'Back to scoring' });
    expect(back).toHaveAttribute('href', '/competitions/1/scoring');
    await user.click(back);
    // MemoryRouter has no window history index, so BackLink uses the fixed parent: the scoring list.
    expect(screen.getByText('Scoring list')).toBeInTheDocument();
  });
});
