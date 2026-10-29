import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LegacyEventRedirect } from './LegacyEventRedirect';
function Destination() { const l = useLocation(); return <output>{l.pathname}{l.search}{l.hash}</output>; }
describe('old organiser bookmarks', () => {
  it.each([
    ['/admin/competitions/7/format?section=11', '/competitions/7/timetable-and-draw?section=11'],
    ['/admin/competitions/7/format#fm-dec', '/competitions/7/entries#dec-form'],
  ])('keeps the destination and context of %s', (from, to) => {
    render(<MemoryRouter initialEntries={[from]}><Routes>
      <Route path="admin/competitions/:id/format" element={<LegacyEventRedirect />} />
      <Route path="*" element={<Destination />} />
    </Routes></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveTextContent(to);
  });
});
