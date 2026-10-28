import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetInstallState } from '../hooks/usePwaInstall';
import { fakeDevice, installPromptEvent, resetDevice, UA } from '../test/device';
import { InstallCard } from './InstallCard';

const TEXT_IOS = 'Add Mounted Games to your Home Screen to get heat alerts on this phone.';

function mount(pathname = '/events') {
  return render(<MemoryRouter><InstallCard pathname={pathname} className="mt-4" /></MemoryRouter>);
}

/** Pretends this is the given visit: earlier visits are already counted, and this session isn't yet. */
const onVisit = (n: number) => localStorage.setItem('mg.install.visits', String(n - 1));

beforeEach(() => { fakeDevice({ userAgent: UA.iphoneSafari }); });
afterEach(() => {
  resetInstallState();
  resetDevice();
});

describe('InstallCard', () => {
  it('stays away on the first two visits', () => {
    mount();
    expect(screen.queryByText(TEXT_IOS)).toBeNull();
    sessionStorage.clear();
    onVisit(2);
    mount();
    expect(screen.queryByText(TEXT_IOS)).toBeNull();
  });

  it('shows on the third visit, and opens the Home Screen steps', async () => {
    onVisit(3);
    mount();
    const card = screen.getByText(TEXT_IOS).closest('.kit-strip')!;
    expect(card).toHaveClass('mt-4');
    await userEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(screen.getByRole('heading', { name: 'Add to your Home Screen' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText(TEXT_IOS)).toBeInTheDocument();
  });

  it('goes for good when put away', async () => {
    onVisit(5);
    const first = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Don’t show this again' }));
    expect(screen.queryByText(TEXT_IOS)).toBeNull();
    expect(localStorage.getItem('mg.install.dismissed')).not.toBeNull();
    first.unmount();
    sessionStorage.clear();
    mount();
    expect(screen.queryByText(TEXT_IOS)).toBeNull();
  });

  it('keeps off kiosks and camera pages', () => {
    onVisit(4);
    mount('/competitions/3/tv');
    expect(screen.queryByText(TEXT_IOS)).toBeNull();
  });

  it('never shows once the app is on the Home Screen', () => {
    fakeDevice({ userAgent: UA.iphoneSafari, iosStandalone: true });
    onVisit(4);
    mount();
    expect(screen.queryByText(TEXT_IOS)).toBeNull();
  });

  it('never shows on a desktop, even with an install prompt', () => {
    fakeDevice({ userAgent: UA.desktopChrome });
    onVisit(4);
    mount();
    act(() => { window.dispatchEvent(installPromptEvent()); });
    expect(screen.queryByRole('button', { name: 'Show me' })).toBeNull();
  });

  it('on Android, waits for the browser prompt and offers to install', async () => {
    fakeDevice({ userAgent: UA.android });
    onVisit(4);
    mount();
    expect(screen.queryByRole('button', { name: 'Show me' })).toBeNull();
    const event = installPromptEvent('accepted');
    act(() => { window.dispatchEvent(event); });
    expect(screen.getByText('Install Mounted Games to open it from your Home Screen.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show me' }));
    await userEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(event.prompt).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Show me' })).toBeNull();
  });
});
