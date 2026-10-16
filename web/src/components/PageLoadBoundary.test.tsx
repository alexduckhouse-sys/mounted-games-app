import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageLoadBoundary } from './PageLoadBoundary';

function Broken(): never { throw new Error('chunk failed to load'); }

const reload = vi.fn();
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('location', { ...window.location, reload });
});

describe('PageLoadBoundary', () => {
  it('shows the page when it loads', () => {
    render(<PageLoadBoundary page="/a"><p>Page content</p></PageLoadBoundary>);
    expect(screen.getByText('Page content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains the failure and offers a reload when the page cannot open', async () => {
    render(<PageLoadBoundary page="/a"><Broken /></PageLoadBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('This page couldn’t open');
    await userEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('tries again when the visitor moves to another page', () => {
    const { rerender } = render(<PageLoadBoundary page="/a"><Broken /></PageLoadBoundary>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(<PageLoadBoundary page="/b"><p>Other page</p></PageLoadBoundary>);
    expect(screen.getByText('Other page')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the error on screen while the page stays the same', () => {
    const { rerender } = render(<PageLoadBoundary page="/a"><Broken /></PageLoadBoundary>);
    rerender(<PageLoadBoundary page="/a"><p>Fixed</p></PageLoadBoundary>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('does nothing special when the page changes and nothing failed', () => {
    const { rerender } = render(<PageLoadBoundary page="/a"><p>One</p></PageLoadBoundary>);
    rerender(<PageLoadBoundary page="/b"><p>Two</p></PageLoadBoundary>);
    expect(screen.getByText('Two')).toBeInTheDocument();
  });
});
