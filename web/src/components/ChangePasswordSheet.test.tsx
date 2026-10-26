import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ChangePasswordSheet } from './ChangePasswordSheet';

vi.mock('../api', () => ({ api: { post: vi.fn() } }));

const onClose = vi.fn();
const onChanged = vi.fn();

beforeEach(() => {
  onClose.mockReset();
  onChanged.mockReset();
  vi.mocked(api.post).mockResolvedValue({ status: 204 });
});

const mount = () => {
  render(<ChangePasswordSheet onClose={onClose} onChanged={onChanged} />);
  return within(screen.getByRole('dialog', { name: 'Change password' }));
};

describe('ChangePasswordSheet', () => {
  it('asks for the current and a new password, and starts with nothing to send', () => {
    const sheet = mount();
    expect(sheet.getByLabelText('Current password')).toHaveAttribute('autocomplete', 'current-password');
    expect(sheet.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password');
    expect(sheet.getByRole('button', { name: 'Change password' })).toBeDisabled();
  });

  it('shows the next password rule as the new one is typed, and holds the button until every rule is met', async () => {
    const user = userEvent.setup();
    const sheet = mount();
    await user.type(sheet.getByLabelText('Current password'), 'old-Passw0rd!');
    await user.type(sheet.getByLabelText('New password'), 'abc');
    expect(sheet.getAllByText(/At least 8 characters/).length).toBeGreaterThan(0);
    expect(sheet.getByRole('button', { name: 'Change password' })).toBeDisabled();
    await user.type(sheet.getByLabelText('New password'), 'defgh1!');
    expect(sheet.getAllByText(/Password meets all requirements|All password requirements met/).length).toBeGreaterThan(0);
    expect(sheet.getByRole('button', { name: 'Change password' })).toBeEnabled();
  });

  it('needs the current password too', async () => {
    const user = userEvent.setup();
    const sheet = mount();
    await user.type(sheet.getByLabelText('New password'), 'Brand-new9pw');
    expect(sheet.getByRole('button', { name: 'Change password' })).toBeDisabled();
  });

  it('sends both passwords and tells the page it worked', async () => {
    const user = userEvent.setup();
    const sheet = mount();
    await user.type(sheet.getByLabelText('Current password'), 'old-Passw0rd!');
    await user.type(sheet.getByLabelText('New password'), 'Brand-new9pw{Enter}');
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/change-password', { currentPassword: 'old-Passw0rd!', newPassword: 'Brand-new9pw' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('shows the server’s reason, keeps what was typed, and lets the person try again', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 400, data: { message: 'Your current password isn’t right.' } } });
    const user = userEvent.setup();
    const sheet = mount();
    await user.type(sheet.getByLabelText('Current password'), 'wrong');
    await user.type(sheet.getByLabelText('New password'), 'Brand-new9pw');
    await user.click(sheet.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your current password isn’t right.');
    expect(onChanged).not.toHaveBeenCalled();
    expect(sheet.getByLabelText('New password')).toHaveValue('Brand-new9pw');
    await waitFor(() => expect(sheet.getByRole('button', { name: 'Change password' })).toBeEnabled());
  });

  it('falls back to a plain message when there was no signal', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    const sheet = mount();
    await user.type(sheet.getByLabelText('Current password'), 'old-Passw0rd!');
    await user.type(sheet.getByLabelText('New password'), 'Brand-new9pw');
    await user.click(sheet.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t change your password. Check your signal and try again.');
  });

  it('closes from Cancel without sending anything', async () => {
    const user = userEvent.setup();
    const sheet = mount();
    await user.click(sheet.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.post).not.toHaveBeenCalled();
  });
});
