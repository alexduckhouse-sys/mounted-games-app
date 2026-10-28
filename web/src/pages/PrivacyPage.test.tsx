import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CompactPageBarProvider, useCompactPageBarState } from '../components/CompactPageBarContext';
import { PrivacyPage } from './PrivacyPage';

function Probe() {
  const { pathname } = useLocation();
  const { header } = useCompactPageBarState();
  return <span data-testid="probe">{pathname}|{header ? `${header.title}|${header.backTo}` : 'none'}</span>;
}

function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CompactPageBarProvider>
        <Routes>
          {['/privacy', '/terms', '/refunds', '/cookies', '/safeguarding', '/data-deletion'].map((to) => <Route key={to} path={to} element={<PrivacyPage />} />)}
        </Routes>
        <Probe />
      </CompactPageBarProvider>
    </MemoryRouter>,
  );
}

const heading = (name: string) => screen.queryByRole('heading', { level: 2, name });

describe('PrivacyPage', () => {
  it('shows one policy at a time, with a Showing row and a sentence-case heading', () => {
    mount('/privacy');
    expect(screen.getByTestId('probe')).toHaveTextContent('Policies and legal|/settings');
    expect(screen.getByRole('combobox', { name: /Showing/ })).toHaveTextContent('Privacy');
    expect(heading('Privacy and data protection (UK GDPR)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'If you just watch' })).toBeInTheDocument();
    // The other four are not on the page, and the old numbered, upper-case labels and chips are gone.
    expect(heading('Terms of service and platform rules')).not.toBeInTheDocument();
    expect(screen.queryByText('Terms of use & event conduct')).not.toBeInTheDocument();
    expect(screen.queryByText(/^1\. /)).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Policy sections' })).not.toBeInTheDocument();
    expect(screen.getByText('[contact email to be added]')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'support@mountedgames.app' })).not.toBeInTheDocument();
  });

  it.each([
    ['/privacy', 'Privacy', 'Privacy and data protection (UK GDPR)', 'Deleting your account'],
    ['/terms', 'Terms of service', 'Terms of service and platform rules', 'Terms of use & event conduct'],
    ['/refunds', 'Refunds and payments', 'Refunds, cancellations and payments', 'Entries, withdrawals & shop refunds'],
    ['/cookies', 'Cookies and storage', 'Cookies and offline storage (UK PECR)', 'What stays on your device'],
    ['/safeguarding', 'Safeguarding and welfare', 'Safeguarding, filming and equine welfare', 'Equine welfare'],
  ])('%s opens its own policy', (path, label, title, card) => {
    mount(path);
    expect(screen.getByRole('combobox', { name: /Showing/ })).toHaveTextContent(label);
    expect(heading(title)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: card })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Questions or requests' })).toBeInTheDocument();
  });

  it('still opens the right policy from the old one-page address with a hash', () => {
    mount('/privacy#refunds');
    expect(heading('Refunds, cancellations and payments')).toBeInTheDocument();
    expect(heading('Privacy and data protection (UK GDPR)')).not.toBeInTheDocument();
  });

  it('changes policy from the dropdown, and each choice goes to its own address', async () => {
    mount('/privacy');
    await userEvent.click(screen.getByRole('combobox', { name: /Showing/ }));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Privacy', 'Terms of service', 'Refunds and payments', 'Cookies and storage', 'Safeguarding and welfare',
    ]);
    await userEvent.click(screen.getByRole('option', { name: 'Cookies and storage' }));
    expect(screen.getByTestId('probe')).toHaveTextContent('/cookies|');
    expect(heading('Cookies and offline storage (UK PECR)')).toBeInTheDocument();
    expect(heading('Privacy and data protection (UK GDPR)')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: /Showing/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Terms of service' }));
    expect(screen.getByTestId('probe')).toHaveTextContent('/terms|');
  });

  it('shows Facebook’s status address as the privacy policy, quoting a well-formed code without claiming what happened', () => {
    const view = mount('/data-deletion?code=0123456789abcdef');
    expect(heading('Privacy and data protection (UK GDPR)')).toBeInTheDocument();
    expect(screen.getByText(/Your reference is 0123456789abcdef\./)).toBeInTheDocument();
    expect(screen.queryByText(/we’ve removed/i)).not.toBeInTheDocument();
    view.unmount();

    // Anything else in the address isn't shown.
    mount('/data-deletion?code=<b>not-a-code</b>');
    expect(screen.queryByText(/Your reference/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Removing Google, Apple or Facebook' })).toBeInTheDocument();
  });

  it('keeps the legal wording', () => {
    mount('/privacy');
    expect(screen.getByText(/You don’t need an account to follow a competition, so we don’t know who you are/)).toBeInTheDocument();
    expect(screen.getByText(/Full account numbers are checked and then discarded, never stored/)).toBeInTheDocument();
  });
});

describe('PrivacyPage wording', () => {
  it('no longer mentions trainer notes, hashes or the hosting products by name', () => {
    mount('/privacy');
    expect(document.body.textContent).not.toMatch(/trainer notes|stored as a hash|Neon|Vercel/i);
    expect(document.body.textContent).toMatch(/scrambled securely/);
  });

  it('opens the safeguarding page without pointing back at text above', () => {
    mount('/safeguarding');
    expect(document.body.textContent).not.toMatch(/as described above/i);
  });
});
