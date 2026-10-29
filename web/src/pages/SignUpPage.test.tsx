import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import { SignUpPage } from './SignUpPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

const clubs = [
  { id: 1, name: 'Stockport Pony Club' },
  { id: 2, name: 'Stoke Pony Club' },
  { id: 3, name: 'Wirral Pony Club' },
];
const profile = { id: 'u1', email: 'sam@example.com', fullName: 'sam', clubId: 1, clubName: 'Stockport Pony Club', roles: ['Member', 'TrainerRequest'] };

function mount(entry: string | { pathname: string; state: unknown } = '/signup') {
  return render(<AuthProvider><MemoryRouter initialEntries={[entry]}><Routes>
    <Route path="/signup" element={<SignUpPage />} />
    <Route path="/login" element={<p>Sign in page</p>} />
    <Route path="/competitions" element={<p>Competitions page</p>} />
    <Route path="/me" element={<p>Profile page</p>} />
  </Routes></MemoryRouter></AuthProvider>);
}

async function fill(user: ReturnType<typeof userEvent.setup>, overrides: { club?: string; pick?: string | false; role?: string | false } = {}) {
  await user.type(screen.getByLabelText('Your name'), 'Sam Lee');
  await user.type(screen.getByLabelText('Email'), 'sam@example.com');
  await user.type(screen.getByLabelText('Password'), 'Passw0rd!x');
  await user.type(screen.getByLabelText('Club / team name'), overrides.club ?? 'Stoc');
  if (overrides.pick !== false) await user.click(screen.getByRole('button', { name: overrides.pick ?? 'Stockport Pony Club' }));
  if (overrides.role !== false) await user.click(screen.getByRole('radio', { name: overrides.role ?? 'Trainer' }));
}

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/clubs' ? clubs : profile }));
  vi.mocked(api.post).mockResolvedValue({ data: { token: 'test-token', expiresAt: '2099-01-01T00:00:00Z', user: profile } });
});

describe('SignUpPage layout', () => {
  it('puts the three roles in one card with a tick on the chosen one and a hint on each', async () => {
    mount();
    const radios = screen.getAllByRole('radio');
    expect(new Set(radios.map((radio) => radio.parentElement)).size).toBe(1);
    expect(radios[0].parentElement).toHaveClass('mg-card');
    expect(radios[1]).toHaveAccessibleDescription('Organise competitions and send in declarations');
    expect(radios[2]).toHaveAccessibleDescription('Run a club and approve its trainers');
    await userEvent.click(radios[1]);
    expect(radios[1].querySelector('svg')).toHaveClass('opacity-100');
    expect(radios[2].querySelector('svg')).toHaveClass('opacity-0');
  });

  it('floats the club suggestions over the form instead of pushing it down', async () => {
    mount();
    await userEvent.type(screen.getByLabelText('Club / team name'), 'Sto');
    const list = screen.getByRole('group', { name: 'Club suggestions' });
    expect(list).toHaveClass('absolute', 'z-20');
    expect(list.parentElement).toHaveClass('relative');
  });

  it('gives the privacy link a full-size tap target and notes caps lock under the password', () => {
    mount();
    expect(screen.getByRole('link', { name: 'How we use your information' })).toHaveClass('min-h-11');
    fireEvent.keyDown(screen.getByLabelText('Password'), { key: 'A', modifierCapsLock: true });
    expect(screen.getByText('Caps lock is on')).toBeInTheDocument();
  });
});

describe('SignUpPage', () => {
  it('asks for a name, email, password, club / team name and role, and nothing else', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument();
    for (const label of ['Your name', 'Email', 'Password', 'Club / team name']) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('aria-labelledby') && document.getElementById(radio.getAttribute('aria-labelledby')!)?.textContent)).toEqual(['Rider or parent', 'Trainer', 'Team manager']);
    expect(screen.queryByLabelText(/Username/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PBKDF2/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Close' })).toHaveAttribute('href', '/');
  });

  it('suggests matching clubs and offers to add the typed name', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Club / team name'), 'sto');
    const list = within(await screen.findByRole('group', { name: 'Club suggestions' }));
    expect(list.getAllByRole('button').map((b) => b.textContent)).toEqual(['Stockport Pony Club', 'Stoke Pony Club', 'Add "sto"']);
  });

  it('does not offer to add a club that already matches exactly', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Club / team name'), 'wirral pony club');
    const list = within(await screen.findByRole('group', { name: 'Club suggestions' }));
    expect(list.getAllByRole('button').map((b) => b.textContent)).toEqual(['Wirral Pony Club']);
  });

  it('shows no suggestions until something is typed, and hides them once a club is picked', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.queryByRole('group', { name: 'Club suggestions' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Club / team name'), 'Stoc');
    await user.click(await screen.findByRole('button', { name: 'Stockport Pony Club' }));
    expect(screen.getByLabelText('Club / team name')).toHaveValue('Stockport Pony Club');
    expect(screen.queryByRole('group', { name: 'Club suggestions' })).not.toBeInTheDocument();
    // Typing again un-picks it.
    await user.type(screen.getByLabelText('Club / team name'), 'x');
    expect(screen.getByRole('group', { name: 'Club suggestions' })).toBeInTheDocument();
  });

  it('tells you who approves once a club and role are chosen', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Club / team name'), 'Stoc');
    await user.click(await screen.findByRole('button', { name: 'Stockport Pony Club' }));
    expect(screen.queryByText(/Approved by/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Trainer' }));
    expect(screen.getByText("Approved by Stockport Pony Club's team manager.")).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Team manager' }));
    expect(screen.getByText('Approved by Mounted Games admins.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Team manager' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Trainer' })).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps Create account disabled until every field is filled and a club is picked', async () => {
    const user = userEvent.setup();
    mount();
    const submit = screen.getByRole('button', { name: 'Create account' });
    expect(submit).toBeDisabled();
    await fill(user, { pick: false, role: false });
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Stockport Pony Club' }));
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Rider or parent' }));
    expect(submit).toBeEnabled();
  });

  it.each([
    ['Rider or parent', 'Member', 'Your team manager will approve you as a member.'],
    ['Trainer', 'Trainer', 'Your team manager will approve you as a trainer.'],
    ['Team manager', 'Manager', 'Mounted Games admins will approve you as team manager.'],
  ])('sends the %s request and says who will approve it', async (label, apiRole, sentence) => {
    const user = userEvent.setup();
    mount();
    await fill(user, { role: label });
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Request sent to Stockport Pony Club' })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(sentence.replace('.', '\\.')))).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/auth/signup-trainer', {
      username: 'sam@example.com', password: 'Passw0rd!x', role: apiRole, clubName: 'Stockport Pony Club', fullName: 'Sam Lee',
    });
  });

  it('sends a new club by name when the person adds it', async () => {
    const user = userEvent.setup();
    mount();
    await fill(user, { club: 'Welsh MG', pick: 'Add "Welsh MG"', role: 'Rider or parent' });
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Request sent to Welsh MG' })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/auth/signup-trainer', expect.objectContaining({ clubName: 'Welsh MG', role: 'Member' }));
  });

  it('offers to follow a competition or go to the profile once the request is sent', async () => {
    const user = userEvent.setup();
    mount();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('link', { name: 'Follow a competition' })).toHaveAttribute('href', '/events');
    await user.click(screen.getByRole('link', { name: 'Go to my profile' }));
    expect(screen.getByText('Profile page')).toBeInTheDocument();
  });

  it('offers a way back to where they were headed, such as a competition\'s entry page', async () => {
    const user = userEvent.setup();
    mount({ pathname: '/signup', state: { from: '/competitions/25/enter' } });
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('link', { name: 'Back to the competition' })).toHaveAttribute('href', '/competitions/25/enter');
  });

  it('puts an email that is already registered under the email field', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 409, data: { message: 'That username is already taken.' } } });
    const user = userEvent.setup();
    mount();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('There’s already an account with that email. Sign in instead?');
    const email = screen.getByLabelText('Email');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    await user.type(email, 'm');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('puts the password rules the server lists under the password field', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 400, data: { errors: ['Passwords must have a digit.', 'Passwords must have a symbol.'] } } });
    const user = userEvent.setup();
    mount();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords must have a digit. Passwords must have a symbol.');
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('puts a password problem the server describes in a message under the password field', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 400, data: { message: 'Password is required.' } } });
    const user = userEvent.setup();
    mount();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Password is required.');
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(/^Password is required\./);
  });

  it('shows any other failure above the button, without losing what was typed', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('Network Error'));
    const user = userEvent.setup();
    mount();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t create the account. Check your signal and try again.');
    expect(screen.getByLabelText('Your name')).toHaveValue('Sam Lee');
  });

  it('still works when the clubs cannot be loaded, by adding the typed name', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Club / team name'), 'My club');
    expect(within(screen.getByRole('group', { name: 'Club suggestions' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Add "My club"']);
  });

  it('ignores a clubs response that is not a list', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: '<html>' });
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Club / team name'), 'St');
    expect(within(screen.getByRole('group', { name: 'Club suggestions' })).getAllByRole('button')).toHaveLength(1);
  });

  it('links to the privacy page and toggles showing and hiding the password', async () => {
    mount();
    expect(screen.getByRole('link', { name: 'How we use your information' })).toHaveAttribute('href', '/privacy');
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  describe('password checklist', () => {
    it('shows one unmet rule at a time in order of importance as the person types, with "special character" and never "non-alphanumeric"', async () => {
      const user = userEvent.setup();
      mount();
      const input = screen.getByLabelText('Password');
      expect(screen.queryByText(/At least 8 characters/)).not.toBeInTheDocument();
      await user.type(input, 'abc');
      expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
      expect(screen.queryByText('A number')).not.toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/alphanumeric/i);
      expect(input).toHaveAccessibleDescription(/At least 8 characters/);
    });

    it('advances through each requirement one at a time while typing, and confirms when all are met', async () => {
      const user = userEvent.setup();
      mount();
      const input = screen.getByLabelText('Password');
      await user.type(input, 'abcdefgh');
      expect(screen.getByText('A number')).toBeInTheDocument();
      expect(screen.getByText('Next requirement: A number.')).toHaveAttribute('aria-live', 'polite');
      await user.type(input, '1');
      expect(screen.getByText('A special character (like ! ? # @ £)')).toBeInTheDocument();
      await user.type(input, '!');
      expect(screen.getByText('Password meets all requirements.')).toBeInTheDocument();
      expect(screen.getByText('All password requirements met.')).toBeInTheDocument();
      await user.clear(input);
      expect(screen.queryByText('Password meets all requirements.')).not.toBeInTheDocument();
    });

    it('keeps Create account off until every rule is met', async () => {
      const user = userEvent.setup();
      mount();
      await fill(user);
      const submit = screen.getByRole('button', { name: 'Create account' });
      expect(submit).toBeEnabled();
      await user.clear(screen.getByLabelText('Password'));
      await user.type(screen.getByLabelText('Password'), 'Passw0rdxx');
      expect(submit).toBeDisabled();
    });

    it('shows the server rule failures in friendly words, from the error codes', async () => {
      vi.mocked(api.post).mockRejectedValue({ response: { status: 400, data: {
        errors: ['Passwords must have at least one non alphanumeric character.'], errorCodes: ['PasswordRequiresNonAlphanumeric'] } } });
      const user = userEvent.setup();
      mount();
      await fill(user);
      await user.click(screen.getByRole('button', { name: 'Create account' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Your password needs a special character (like ! ? # @ £).');
      expect(alert.textContent).not.toMatch(/alphanumeric/i);
    });

    it('rewrites an older "non-alphanumeric" message from the server', async () => {
      vi.mocked(api.post).mockRejectedValue({ response: { status: 400, data: { message: 'Password needs a non-alphanumeric character.' } } });
      const user = userEvent.setup();
      mount();
      await fill(user);
      await user.click(screen.getByRole('button', { name: 'Create account' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Password needs a special character.');
    });
  });

  describe('email checks', () => {
    it('suggests the right domain for a common typo, and fixes it on request', async () => {
      const user = userEvent.setup();
      mount();
      const email = screen.getByLabelText('Email');
      await user.type(email, 'sam@gmial.com');
      expect(screen.queryByText(/Did you mean/)).not.toBeInTheDocument();
      await user.tab();
      expect(await screen.findByText(/Did you mean/)).toHaveTextContent('Did you mean sam@gmail.com?');
      await user.click(screen.getByRole('button', { name: 'Use that' }));
      expect(email).toHaveValue('sam@gmail.com');
      expect(screen.queryByText(/Did you mean/)).not.toBeInTheDocument();
    });

    it('flags an address that cannot be real once the person leaves the field', async () => {
      const user = userEvent.setup();
      mount();
      const email = screen.getByLabelText('Email');
      await user.type(email, 'sam@gmail');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await user.tab();
      expect(await screen.findByRole('alert')).toHaveTextContent('That doesn’t look like a valid email address.');
      expect(email).toHaveAttribute('aria-invalid', 'true');
      await user.type(email, '.com');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows the server verdict on the domain or a throwaway address under the email field', async () => {
      vi.mocked(api.post).mockRejectedValue({ response: { status: 400, data: { message: "We couldn't find a mailbox for that address's domain. Check the spelling after the @.", code: 'email_domain' } } });
      const user = userEvent.setup();
      mount();
      await fill(user);
      await user.click(screen.getByRole('button', { name: 'Create account' }));
      expect(await screen.findByRole('alert')).toHaveTextContent("couldn't find a mailbox");
      expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    });

    it('says a confirmation link was emailed once the request is sent', async () => {
      const user = userEvent.setup();
      mount();
      await fill(user);
      await user.click(screen.getByRole('button', { name: 'Create account' }));
      expect(await screen.findByText(/emailed you a link to confirm your address/)).toBeInTheDocument();
    });
  });
});
