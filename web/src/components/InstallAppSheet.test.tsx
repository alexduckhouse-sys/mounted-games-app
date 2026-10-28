import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetInstallState } from '../hooks/usePwaInstall';
import { fakeDevice, installPromptEvent, resetDevice, UA } from '../test/device';
import { InstallAppSheet } from './InstallAppSheet';

afterEach(() => {
  resetInstallState();
  resetDevice();
  Reflect.deleteProperty(navigator, 'clipboard');
});

const fakeClipboard = (writeText: () => Promise<void>) => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

describe('InstallAppSheet', () => {
  it('gives Safari on an iPhone three numbered steps', async () => {
    fakeDevice({ userAgent: UA.iphoneSafari });
    const onClose = vi.fn();
    render(<InstallAppSheet onClose={onClose} />);
    expect(screen.getByRole('heading', { name: 'Add to your Home Screen' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('It opens like any other app, and notifications can reach your iPhone.');
    const steps = screen.getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual([
      '1Tap Share in Safari. If you can’t see it, tap ⋯ first.',
      '2Choose Add to Home Screen. You may need to scroll down.',
      '3Tap Add, then open Mounted Games from your Home Screen.',
    ]);
    expect(screen.queryByText('Turn notifications on again from there.')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('leads with why when opened from a notification switch, and calls an iPad an iPad', () => {
    fakeDevice({ userAgent: UA.ipadDesktop, maxTouchPoints: 5 });
    render(<InstallAppSheet forNotifications onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Notifications only reach an iPad once the app is on its Home Screen.');
    expect(screen.getByText('Turn notifications on again from there.')).toBeInTheDocument();
  });

  it('sends other iPhone browsers to Safari, with a link to copy', async () => {
    fakeDevice({ userAgent: UA.iphoneInstagram });
    const writeText = vi.fn().mockResolvedValue(undefined);
    fakeClipboard(writeText);
    render(<InstallAppSheet forNotifications onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Open this page in Safari' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      'Only Safari can add Mounted Games to your Home Screen. Notifications only reach an iPhone once the app is on its Home Screen.');
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(await screen.findByRole('status')).toHaveTextContent('Link copied.');
  });

  it('says how to copy the link by hand when copying fails', async () => {
    fakeDevice({ userAgent: UA.iphoneChrome });
    fakeClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    const onClose = vi.fn();
    render(<InstallAppSheet onClose={onClose} />);
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Only Safari can add Mounted Games to your Home Screen.');
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Couldn’t copy the link. Copy it from the address bar instead.');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('gives Chromium one Install button that shows its prompt', async () => {
    fakeDevice({ userAgent: UA.android });
    const event = installPromptEvent('accepted');
    const onClose = vi.fn();
    render(<InstallAppSheet onClose={onClose} />);
    act(() => { window.dispatchEvent(event); });
    expect(screen.getByRole('heading', { name: 'Install the app' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(event.prompt).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('lets Chromium users say not now', async () => {
    fakeDevice({ userAgent: UA.desktopChrome });
    const event = installPromptEvent();
    const onClose = vi.fn();
    render(<InstallAppSheet onClose={onClose} />);
    act(() => { window.dispatchEvent(event); });
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(event.prompt).not.toHaveBeenCalled();
  });

  it('says when it is already installed', async () => {
    fakeDevice({ userAgent: UA.android, displayStandalone: true });
    const onClose = vi.fn();
    render(<InstallAppSheet onClose={onClose} />);
    expect(screen.getByRole('heading', { name: 'Already installed' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('points elsewhere to the browser menu', () => {
    fakeDevice({ userAgent: UA.desktopChrome });
    render(<InstallAppSheet onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Look for Install or Add to Home Screen in your browser’s menu.');
  });
});
