import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { liteWrapper } from '../test/lite';
import { sponsor } from '../test/factories';
import { SponsorBadge } from './SponsorBadge';

afterEach(() => { vi.unstubAllEnvs(); });

const withLogo = sponsor(3, { name: 'Acme Feeds', logoUrl: '/api/competitions/1/sponsors/3/logo?v=2', linkUrl: 'https://acme.example/horses' });

describe('SponsorBadge', () => {
  it('links to the sponsor in a new tab, marked as paid and cut off from this page', () => {
    const Normal = liteWrapper('off');
    render(<Normal><SponsorBadge sponsor={withLogo} /></Normal>);
    const link = screen.getByRole('link', { name: /Acme Feeds/ });
    expect(link).toHaveAttribute('href', 'https://acme.example/horses');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'sponsored noopener noreferrer');
    expect(screen.getByRole('img', { name: 'Acme Feeds logo' })).toHaveAttribute('src', '/api/competitions/1/sponsors/3/logo?v=2');
  });

  it('shows only the name, not a link, when there is no https address', () => {
    const Normal = liteWrapper('off');
    render(<Normal><SponsorBadge sponsor={sponsor(1, { name: 'No Link Ltd', linkUrl: null })} large /></Normal>);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('No Link Ltd').closest('.mg-sponsor')).toHaveClass('mg-sponsor-large');
    render(<Normal><SponsorBadge sponsor={sponsor(2, { name: 'Odd', linkUrl: 'javascript:alert(1)' })} /></Normal>);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('waits for a tap before loading the logo in lite mode', () => {
    const Lite = liteWrapper('on');
    render(<Lite><SponsorBadge sponsor={withLogo} /></Lite>);
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Load image: Acme Feeds logo' }));
    expect(screen.getByRole('img', { name: 'Acme Feeds logo' })).toBeInTheDocument();
  });

  it('fetches the logo from the API’s own address when the build has one', () => {
    vi.stubEnv('VITE_API_BASE', 'https://api.example.com/api');
    const Normal = liteWrapper('off');
    render(<Normal><SponsorBadge sponsor={withLogo} /></Normal>);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://api.example.com/api/competitions/1/sponsors/3/logo?v=2');
  });
});
