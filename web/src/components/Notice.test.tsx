import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { Notice } from './Notice';

describe('Notice', () => {
  it('is an amber problem strip that is announced, by default', () => {
    render(<Notice>Couldn’t load the entries. Check your signal and try again.</Notice>);
    const strip = screen.getByRole('alert');
    expect(strip).toHaveClass('kit-strip', 'kit-strip-problem');
    expect(strip).toHaveTextContent('Couldn’t load the entries.');
    expect(strip.querySelector('svg')).not.toBeNull();
  });

  it('is a calm blue-grey status strip for information', () => {
    render(<Notice tone="info" icon={Clock}>Last updated 12:04. Checking for changes…</Notice>);
    expect(screen.getByRole('status')).toHaveClass('kit-strip-info');
  });

  it('can be left unannounced', () => {
    render(<Notice role={null}>Quiet</Notice>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Quiet').closest('.kit-strip')).not.toHaveAttribute('role');
  });

  it('has a small outlined action button that can be switched off', async () => {
    const onAction = vi.fn();
    const { rerender } = render(<Notice actionLabel="Try again" onAction={onAction}>Failed</Notice>);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    rerender(<Notice actionLabel="Try again" onAction={onAction} actionDisabled>Failed</Notice>);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled();
  });

  it('can make its action a link', () => {
    render(<MemoryRouter><Notice tone="info" actionLabel="Message the organisers" actionTo="/competitions/4/contact">Closed</Notice></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Message the organisers' })).toHaveAttribute('href', '/competitions/4/contact');
  });

  it('can be put away', async () => {
    const onDismiss = vi.fn();
    render(<Notice onDismiss={onDismiss} dismissLabel="Dismiss error">Failed</Notice>);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
