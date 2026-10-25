import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { EntryRosette, Rosette } from './Rosette';

it('writes the team and section on the tails, and says the entry is in', () => {
  render(<EntryRosette team="Oak Seniors" section="Teams Seniors" year={2026}>Your entry is confirmed.</EntryRosette>);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent("You're entered");
  expect(status).toHaveTextContent('Oak Seniors, Teams Seniors');
  expect(status).toHaveTextContent('Your entry is confirmed.');
  expect(status.querySelector('svg')).toHaveTextContent('2026');
});

it('cuts a long name to fit a ribbon, and leaves out the note when there is none', () => {
  const { container } = render(<EntryRosette team="The Very Long Pony Club Name A" section="Teams Seniors" year={2026} />);
  expect(container.querySelector('svg')).toHaveTextContent('The Very Long Pon…');
  expect(container.querySelector('.mg-entry-rosette-note')).toBeNull();
});

it('draws a plain badge without ribbons text or centre words', () => {
  const { container } = render(<Rosette width={26} />);
  expect(container.querySelectorAll('text')).toHaveLength(0);
  expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 190 186');
});
