import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { QrCode } from './QrCode';

it('draws an accessible SVG with a quiet zone and fixed black-on-white colours', () => {
  const { container } = render(<QrCode value="https://mg.example/competitions/1" label="QR code for Spring Games" className="w-40" />);
  const svg = screen.getByRole('img', { name: 'QR code for Spring Games' });
  expect(svg.tagName.toLowerCase()).toBe('svg');
  expect(svg).toHaveClass('w-40');
  const [x, , width] = svg.getAttribute('viewBox')!.split(' ').map(Number);
  expect(x).toBe(-4);
  expect(width).toBeGreaterThan(8);
  expect(container.querySelector('rect')).toHaveAttribute('fill', '#fff');
  expect(container.querySelector('path')).toHaveAttribute('fill', '#000');
  expect(container.querySelector('path')!.getAttribute('d')).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
});

it('renders nothing when there is nothing to encode', () => {
  const { container } = render(<QrCode value="" label="empty" />);
  expect(container).toBeEmptyDOMElement();
});
