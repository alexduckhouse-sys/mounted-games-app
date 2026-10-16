import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompetitionIcon } from './CompetitionIcon';

describe('CompetitionIcon', () => {
  it('renders an emoji icon as text', () => {
    const { container } = render(<CompetitionIcon id="trophy" />);
    expect(container).toHaveTextContent('🏆');
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders a flag as a bundled image with empty alt text', () => {
    const { container } = render(<CompetitionIcon id="gb-wls" />);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', '/flags/gb-wls.png');
    expect(img).toHaveAttribute('alt', '');
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

  it('labels an emoji icon too', () => {
    render(<CompetitionIcon id="world" labelled />);
    expect(screen.getByRole('img', { name: 'World' })).toHaveTextContent('🌍');
  });

  it('falls back to the chequered flag and passes through a class name', () => {
    const { container } = render(<CompetitionIcon id="xx" className="text-xl" />);
    expect(container).toHaveTextContent('🏁');
    expect(container.firstElementChild).toHaveClass('text-xl');
  });
});
