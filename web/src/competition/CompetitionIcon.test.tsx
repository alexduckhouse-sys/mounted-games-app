import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompetitionIcon } from './CompetitionIcon';

describe('CompetitionIcon', () => {
  it('draws the trophy and world symbols as tiles, not emoji', () => {
    for (const id of ['trophy', 'world']) {
      const { container, unmount } = render(<CompetitionIcon id={id} />);
      expect(container.querySelector(`[data-icon="${id}"] svg`)).toBeInTheDocument();
      expect(container).not.toHaveTextContent(/🏆|🌍/u);
      expect(container.querySelector('img')).toBeNull();
      unmount();
    }
  });

  it('renders a flag as a bundled image with empty alt text, kept to its own proportions', () => {
    const { container } = render(<CompetitionIcon id="gb-wls" />);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', '/flags/gb-wls.png');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveClass('max-h-full', 'max-w-full', 'object-contain');
  });

  it('hides the icon from assistive technology unless it is labelled', () => {
    const { container } = render(<CompetitionIcon id="fr" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('exposes the label and tooltip when labelled', () => {
    render(<CompetitionIcon id="nl" labelled />);
    expect(screen.getByRole('img', { name: 'Netherlands' })).toHaveAttribute('title', 'Netherlands');
  });

  it('labels a symbol too', () => {
    render(<CompetitionIcon id="world" labelled />);
    expect(screen.getByRole('img', { name: 'World' })).toBeInTheDocument();
  });

  it('falls back to the drawn chequered flag in the same frame, and passes through a class name', () => {
    const { container } = render(<CompetitionIcon id="xx" className="text-xl" />);
    expect(container.querySelector('svg[data-icon="flag"]')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('text-xl', 'h-[1.125em]', 'w-[1.625em]');
  });
});
