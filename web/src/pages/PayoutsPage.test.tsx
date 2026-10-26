import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import type { ClubPayouts } from '../types';
import { PayoutsPage } from './PayoutsPage';

vi.setConfig({ testTimeout: 30_000 });

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const blank = (extra: Partial<ClubPayouts> = {}): ClubPayouts => ({
  clubId: 7, clubName: 'Stockport PC', status: 0, businessType: null, region: 0, currency: 'GBP',
  legalName: null, tradingName: null, addressLine1: null, addressLine2: null, city: null, postcode: null,
  contactEmail: null, contactPhone: null, registrationNumber: null, vatNumber: null,
  personFullName: null, personDateOfBirth: null, statementDescriptor: null, schedule: 1,
  bank: null, missing: ['businessType', 'bank'], updatedAt: null, ...extra,
});

const BULLETS = '••••';
const complete = (extra: Partial<ClubPayouts> = {}): ClubPayouts => blank({
  status: 1, businessType: 1, legalName: 'Stockport Pony Club', addressLine1: '1 High St', city: 'Stockport', postcode: 'SK1 1AA',
  contactEmail: 'a@example.org', contactPhone: '+44 7700 900123', personFullName: 'Ann Smith', personDateOfBirth: '1985-03-14',
  statementDescriptor: 'STOCKPORT PC', bank: { accountHolder: 'Stockport PC', bankName: 'Barclays', sortCode: '20-12-34', maskedAccount: `${BULLETS}1234`, ibanCountry: null },
  missing: [], ...extra,
});
/** Details all in and the account finished. */
const ready = (extra: Partial<ClubPayouts> = {}) => complete({ status: 2, ...extra });

function mount(options: { roles?: string[]; clubId?: number | null } = {}) {
  const auth: StoredAuth = {
    token: 't', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    user: { id: 'me', email: 'a@example.com', fullName: 'Alex Morgan', clubId: options.clubId === undefined ? 7 : options.clubId, clubName: 'Stockport PC', roles: options.roles ?? ['Manager'] },
  };
  localStorage.setItem('mg.auth', JSON.stringify(auth));
  return render(
    <MemoryRouter initialEntries={['/me/payouts']}>
      <AuthProvider><Routes>
        <Route path="/me/payouts" element={<PayoutsPage />} />
        <Route path="/me" element={<p>Profile page</p>} />
      </Routes></AuthProvider>
    </MemoryRouter>,
  );
}

let loaded: ClubPayouts;
const errorResponse = (errors: Record<string, string>) => Object.assign(new Error('bad'), { response: { status: 400, data: { message: Object.values(errors)[0], errors } } });
const status = () => waitFor(() => { const el = document.querySelector<HTMLElement>('.cs-status'); if (!el) throw new Error('no status line yet'); return el; });
const row = (label: string) => screen.findByRole('button', { name: new RegExp(`^${label}`) });
const dropdown = (label: string) => screen.findByRole('combobox', { name: new RegExp(`^${label}`) });
const sheet = () => within(screen.getByRole('dialog'));
const typeInto = async (label: string | RegExp, text: string) => userEvent.type(sheet().getByLabelText(label), text);
const done = (name = 'Done') => userEvent.click(sheet().getByRole('button', { name }));
const choose = async (label: string, option: string | RegExp) => {
  await userEvent.click(await dropdown(label));
  await userEvent.click(await screen.findByRole('option', { name: option }));
};

beforeEach(() => {
  loaded = blank();
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/clubs') return { data: [{ id: 7, name: 'Stockport PC' }, { id: 9, name: 'Other PC' }] };
    if (url === '/clubs/9/payouts') return { data: blank({ clubId: 9, clubName: 'Other PC' }) };
    if (url === '/clubs/7/payouts') return { data: loaded };
    throw new Error(`unexpected GET ${url}`);
  });
  vi.mocked(api.put).mockImplementation(async (_url, body) => ({ data: { ...loaded, ...(body as object), status: 1 } }));
  vi.mocked(api.post).mockResolvedValue({ data: ready() });
});

describe('PayoutsPage: one page', () => {
  it('says what is left in amber, and shows the two cards with the plain online-payments note', async () => {
    loaded = complete({ bank: null, missing: ['bank'] });
    mount();
    expect(await status()).toHaveTextContent('One thing left: add the club’s bank account.');
    expect(await status()).toHaveAttribute('data-tone', 'warn');
    expect(screen.getByRole('heading', { name: 'Who gets paid' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Money' })).toBeInTheDocument();
    for (const label of ['Paid to', 'Country', 'Legal name and address', 'Responsible person', 'Bank account', 'Name on statements', 'When you get paid']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('Add')).toHaveTextContent('Add');
    expect(screen.getByRole('button', { name: /^Bank account/ })).toContainElement(screen.getByText('Add'));
    expect(screen.getByText('Online payments aren’t switched on yet. Entries are paid to you directly until they are.')).toBeInTheDocument();
    expect(screen.queryByText(/Test mode/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Step \d of 6/)).not.toBeInTheDocument();
  });

  it('shows the saved values on the rows', async () => {
    loaded = ready();
    mount();
    expect(await status()).toHaveTextContent('Ready. Money from entries goes to account ending 1234.');
    expect(await status()).toHaveAttribute('data-tone', 'good');
    expect(await dropdown('Paid to')).toHaveTextContent('Club or association');
    expect(screen.getByRole('combobox', { name: /^Country/ })).toHaveTextContent('United Kingdom (£)');
    expect(screen.getByRole('button', { name: /^Legal name and address/ })).toHaveTextContent('Stockport Pony Club');
    expect(screen.getByRole('button', { name: /^Responsible person/ })).toHaveTextContent('Ann Smith');
    expect(screen.getByRole('button', { name: /^Bank account/ })).toHaveTextContent(`Barclays ${BULLETS}1234`);
    expect(screen.getByRole('button', { name: /^Name on statements/ })).toHaveTextContent('STOCKPORT PC');
    expect(screen.getByRole('combobox', { name: /^When you get paid/ })).toHaveTextContent('Weekly');
  });

  it('counts several missing things in words', async () => {
    loaded = blank({ status: 1, businessType: 1, missing: ['legalName', 'personFullName', 'bank'] });
    mount();
    expect(await status()).toHaveTextContent('Three things left: add the legal name and address, the responsible person and the club’s bank account.');
  });
});

describe('PayoutsPage: choices save from the row', () => {
  it('saves who is being paid', async () => {
    mount();
    await choose('Paid to', 'Registered charity');
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/clubs/7/payouts', { businessType: 2 }));
  });

  it('saves the country, and the schedule', async () => {
    loaded = complete({ bank: null, missing: ['bank'] });
    mount();
    await choose('Country', 'Ireland or the EU (€)');
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/clubs/7/payouts', { region: 1 }));
    await choose('When you get paid', 'After each event');
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/clubs/7/payouts', { schedule: 2 }));
  });

  it('does nothing when the choice is the one already made', async () => {
    loaded = ready();
    mount();
    await choose('When you get paid', 'Weekly');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('says why when a choice cannot be saved', async () => {
    vi.mocked(api.put).mockRejectedValueOnce(new Error('offline'));
    mount();
    await choose('Paid to', 'Company');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save the payout details. Check your signal and try again.');
  });

  it('shows the API\'s field problem when a choice is refused', async () => {
    vi.mocked(api.put).mockRejectedValueOnce(errorResponse({ region: 'Pick a region.' }));
    mount();
    await choose('Country', 'Ireland or the EU (€)');
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick a region.');
  });
});

describe('PayoutsPage: legal name and address', () => {
  it('checks the details as the server does, and sends them', async () => {
    loaded = blank({ status: 1, businessType: 2, missing: ['legalName'] });
    mount();
    await userEvent.click(await row('Legal name and address'));
    await done();
    expect(sheet().getByText('Enter the legal name.')).toBeInTheDocument();
    expect(sheet().getByText('Enter the charity number.')).toBeInTheDocument();

    await typeInto('Legal name', 'Stockport Pony Club');
    await typeInto('Address line 1', '1 High St');
    await typeInto('Town or city', 'Stockport');
    await typeInto('Postcode', 'nonsense');
    await typeInto('Contact email', 'a@example.org');
    await typeInto('Contact phone', '+44 7700 900123');
    await typeInto('Charity number', '1234567');
    await done();
    expect(sheet().getByText('Enter a UK postcode, like SW1A 1AA.')).toBeInTheDocument();
    await userEvent.clear(sheet().getByLabelText('Postcode'));
    await typeInto('Postcode', 'sk1 1aa');
    await typeInto(/VAT number/, 'GB123456789');
    await done();

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/clubs/7/payouts', expect.objectContaining({
      legalName: 'Stockport Pony Club', postcode: 'SK1 1AA', registrationNumber: '1234567', vatNumber: 'GB123456789', tradingName: '',
    })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('only asks for a company number when the payee is a company', async () => {
    loaded = complete({ businessType: 3, registrationNumber: '12345678' });
    mount();
    await userEvent.click(await row('Legal name and address'));
    expect(sheet().getByLabelText('Company number')).toHaveValue('12345678');
  });

  it('leaves out the registration box for a club', async () => {
    loaded = complete();
    mount();
    await userEvent.click(await row('Legal name and address'));
    expect(sheet().queryByLabelText(/number$/i)).not.toBeInTheDocument();
    expect(sheet().getByLabelText('Legal name')).toHaveValue('Stockport Pony Club');
  });

  it('keeps the sheet open with the API\'s field errors', async () => {
    loaded = complete();
    vi.mocked(api.put).mockRejectedValueOnce(errorResponse({ contactEmail: 'Enter a valid email address.' }));
    mount();
    await userEvent.click(await row('Legal name and address'));
    await done();
    expect(await sheet().findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Legal name and address' })).toBeInTheDocument();
  });

  it('shows a message when saving fails without field errors', async () => {
    loaded = complete();
    vi.mocked(api.put).mockRejectedValueOnce(new Error('offline'));
    mount();
    await userEvent.click(await row('Legal name and address'));
    await done();
    expect(await sheet().findByText('Couldn’t save the payout details. Check your signal and try again.')).toBeInTheDocument();
  });
});

describe('PayoutsPage: responsible person', () => {
  it('rejects someone under 18, then saves', async () => {
    loaded = blank({ status: 1, businessType: 1, legalName: 'x', addressLine1: 'x', city: 'x', postcode: 'SK1 1AA', contactEmail: 'a@b.co', contactPhone: '01234567890', missing: ['personFullName'] });
    mount();
    await userEvent.click(await row('Responsible person'));
    await done();
    expect(sheet().getByText('Enter the responsible person\'s full name.')).toBeInTheDocument();
    await typeInto('Full name', 'Ann Smith');
    await typeInto('Date of birth', '2020-01-01');
    await done();
    expect(sheet().getByText('They must be at least 18.')).toBeInTheDocument();
    await userEvent.clear(sheet().getByLabelText('Date of birth'));
    await typeInto('Date of birth', '1985-03-14');
    await done();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/clubs/7/payouts', { personFullName: 'Ann Smith', personDateOfBirth: '1985-03-14' }));
  });

  it('explicitly removes a saved birth date while keeping the responsible person', async () => {
    loaded = ready({ personFullName: 'Fake Responsible Person', personDateOfBirth: '2000-01-01' });
    vi.mocked(api.put).mockResolvedValue({ data: { ...loaded, status: 1, personDateOfBirth: null, missing: ['personDateOfBirth'] } });
    mount();
    await userEvent.click(await row('Responsible person'));
    await userEvent.clear(sheet().getByLabelText('Date of birth'));
    await done();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/clubs/7/payouts', {
      personFullName: 'Fake Responsible Person', personDateOfBirth: null, clearPersonDateOfBirth: true,
    }));
    expect(await status()).toHaveTextContent('One thing left: add the responsible person.');
  });
});

describe('PayoutsPage: bank account', () => {
  it('takes a UK bank account with numeric boxes, shows the sort code as 12-34-56, and clears the numbers once sent', async () => {
    loaded = complete({ bank: null, missing: ['bank'] });
    vi.mocked(api.put).mockResolvedValue({ data: complete({ missing: [] }) });
    mount();
    await userEvent.click(await row('Bank account'));
    await done('Save');
    expect(sheet().getByText('Enter the name on the account.')).toBeInTheDocument();
    expect(sheet().getByText('A sort code has 6 digits.')).toBeInTheDocument();
    expect(sheet().getByText('An account number has 8 digits.')).toBeInTheDocument();

    expect(sheet().getByLabelText('Sort code')).toHaveAttribute('inputmode', 'numeric');
    expect(sheet().getByLabelText('Account number')).toHaveAttribute('inputmode', 'numeric');
    await typeInto('Name on the account', 'Stockport PC');
    await typeInto('Sort code', '20e1234');
    await typeInto('Account number', '1234-5e678x9');
    expect(sheet().getByLabelText('Sort code')).toHaveValue('20-12-34');
    expect(sheet().getByLabelText('Account number')).toHaveValue('12345678');
    await done('Save');

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/clubs/7/payouts/bank', { accountHolder: 'Stockport PC', sortCode: '20-12-34', accountNumber: '12345678' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.body.textContent).not.toContain('12345678');
  });

  it('shows saved bank details masked only', async () => {
    loaded = ready();
    mount();
    await userEvent.click(await row('Bank account'));
    expect(screen.getByRole('dialog', { name: 'Bank account' })).toHaveAccessibleDescription(`Now Barclays ${BULLETS}1234. We check the numbers and keep the last 4 digits only.`);
    expect(sheet().getByLabelText('Account number')).toHaveValue('');
  });

  it('asks Ireland and EU clubs for an IBAN and a BIC, in groups of four', async () => {
    loaded = complete({ region: 1, currency: 'EUR', bank: null, missing: ['bank'], postcode: 'D02 X285' });
    mount();
    await userEvent.click(await row('Bank account'));
    await typeInto('Name on the account', 'Stockport PC');
    await typeInto('IBAN', 'ie29aibk93115212345679');
    await typeInto(/^BIC/, 'nope');
    await done('Save');
    expect(sheet().getByText('That IBAN doesn\'t look right. Check it and try again.')).toBeInTheDocument();
    expect(sheet().getByText('A BIC has 8 or 11 letters and numbers.')).toBeInTheDocument();
    await userEvent.clear(sheet().getByLabelText('IBAN'));
    await typeInto('IBAN', 'ie29aibk93115212345678');
    expect(sheet().getByLabelText('IBAN')).toHaveValue('IE29 AIBK 9311 5212 3456 78');
    await userEvent.clear(sheet().getByLabelText(/^BIC/));
    await done('Save');
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/clubs/7/payouts/bank', { accountHolder: 'Stockport PC', iban: 'IE29 AIBK 9311 5212 3456 78', bic: null }));
  });

  it('says so when the bank account cannot be saved', async () => {
    loaded = complete({ bank: null, missing: ['bank'] });
    vi.mocked(api.put).mockRejectedValueOnce(new Error('offline'));
    mount();
    await userEvent.click(await row('Bank account'));
    await typeInto('Name on the account', 'Stockport PC');
    await typeInto('Sort code', '201234');
    await typeInto('Account number', '12345678');
    await done('Save');
    expect(await sheet().findByText('Couldn’t save the bank account. Check your signal and try again.')).toBeInTheDocument();
  });

  it('shows the API\'s bank field errors', async () => {
    loaded = complete({ bank: null, missing: ['bank'] });
    vi.mocked(api.put).mockRejectedValueOnce(errorResponse({ sortCode: 'That sort code does not exist.' }));
    mount();
    await userEvent.click(await row('Bank account'));
    await typeInto('Name on the account', 'Stockport PC');
    await typeInto('Sort code', '201234');
    await typeInto('Account number', '12345678');
    await done('Save');
    expect(await sheet().findByText('That sort code does not exist.')).toBeInTheDocument();
  });
});

describe('PayoutsPage: name on statements', () => {
  it('keeps it to capitals, letters and numbers, and sends only that', async () => {
    loaded = complete({ statementDescriptor: null, missing: ['statementDescriptor'] });
    mount();
    await userEvent.click(await row('Name on statements'));
    await done();
    expect(sheet().getByText('Enter a statement descriptor.')).toBeInTheDocument();
    await typeInto('Name', 'abc*');
    expect(sheet().getByLabelText('Name')).toHaveValue('ABC');
    await done();
    expect(sheet().getByText('Use 5 to 22 letters, numbers or spaces, with at least one letter.')).toBeInTheDocument();
    await typeInto('Name', 'de pc');
    await done();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/clubs/7/payouts', { statementDescriptor: 'ABCDE PC' }));
  });
});

describe('PayoutsPage: finishing', () => {
  it('finishes the set-up on its own once nothing is missing', async () => {
    loaded = complete({ statementDescriptor: null, missing: ['statementDescriptor'] });
    vi.mocked(api.put).mockResolvedValue({ data: complete() });
    mount();
    await userEvent.click(await row('Name on statements'));
    await typeInto('Name', 'stockport pc');
    await done();
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/clubs/7/payouts/finish'));
    await waitFor(() => expect(document.querySelector('.cs-status')).toHaveTextContent('Ready. Money from entries goes to account ending 1234.'));
  });

  it('does not finish while something is missing', async () => {
    loaded = complete({ statementDescriptor: null, missing: ['statementDescriptor', 'bank'], bank: null });
    mount();
    await userEvent.click(await row('Name on statements'));
    await typeInto('Name', 'stockport pc');
    await done();
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.post).not.toHaveBeenCalled();
  });

  it('says so when it saved but could not finish', async () => {
    loaded = complete({ statementDescriptor: null, missing: ['statementDescriptor'] });
    vi.mocked(api.put).mockResolvedValue({ data: complete() });
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    mount();
    await userEvent.click(await row('Name on statements'));
    await typeInto('Name', 'stockport pc');
    await done();
    expect(await screen.findByText('Saved, but couldn’t finish the set-up. Check your signal and try again.')).toBeInTheDocument();
  });
});

describe('PayoutsPage: access and loading', () => {
  it('shows a message when the details cannot be loaded, and tries again', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('down'));
    mount();
    expect(await screen.findByText('Couldn’t load the payout details. Check your signal and try again.')).toBeInTheDocument();
    loaded = ready();
    vi.mocked(api.get).mockImplementation(async () => ({ data: loaded }));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await status()).toHaveTextContent('Ready.');
  });

  it('refuses an odd response', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { nope: true } });
    mount();
    expect(await screen.findByText('Couldn’t load the payout details. Check your signal and try again.')).toBeInTheDocument();
  });

  it('lets an admin pick any club', async () => {
    mount({ roles: ['Admin'], clubId: null });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/clubs'));
    await choose('Club', 'Other PC');
    expect(await status()).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/clubs/9/payouts');
  });

  it('tells someone with no club to join one', async () => {
    mount({ clubId: null });
    expect(await screen.findByText('Payouts belong to a club. Join a club first.')).toBeInTheDocument();
  });

  it('renders nothing when nobody is signed in', () => {
    localStorage.clear();
    const { container } = render(<MemoryRouter><AuthProvider><PayoutsPage /></AuthProvider></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
