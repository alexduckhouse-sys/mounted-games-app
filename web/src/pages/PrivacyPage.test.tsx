import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CompactPageBarProvider, useCompactPageBarState } from '../components/CompactPageBarContext';
import { PrivacyPage } from './PrivacyPage';

function HeaderProbe() {
  const { header } = useCompactPageBarState();
  return <span data-testid="header">{header ? `${header.title}|${header.backTo}` : 'none'}</span>;
}

describe('PrivacyPage', () => {
  it('renders Privacy, Terms of Service, Refunds, Cookies, and Safeguarding sections and sets the page header back link', () => {
    render(
      <MemoryRouter initialEntries={['/privacy']}>
        <CompactPageBarProvider>
          <PrivacyPage />
          <HeaderProbe />
        </CompactPageBarProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('header')).toHaveTextContent('Policies & legal|/settings');
    expect(screen.getByRole('heading', { name: /1\. Privacy & Data Protection/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /2\. Terms of Service & Platform Rules/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /3\. Refunds, Cancellations & Payments Policy/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /4\. Cookies & Offline Storage Policy/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /5\. Safeguarding, Filming & Equine Welfare/i })).toBeInTheDocument();
    expect(screen.getByText('[contact email to be added]')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'support@mountedgames.app' })).not.toBeInTheDocument();
  });

  it('scrolls to the target section when opened with a hash or direct policy path', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(
      <MemoryRouter initialEntries={['/privacy#refunds']}>
        <CompactPageBarProvider>
          <PrivacyPage />
        </CompactPageBarProvider>
      </MemoryRouter>,
    );

    expect(scrollIntoView).toHaveBeenCalledOnce();
  });
});
