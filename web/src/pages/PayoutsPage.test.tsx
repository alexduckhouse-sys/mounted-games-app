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
const typeInto = async (label: string | RegExp, text: string) => userEvent.type(screen.getByLabelText(label), text);
const next = () => userEvent.click(screen.getByRole('button', { name: 'Continue' }));
const errorResponse = (errors: Record<string, string>) => Object.assign(new Error('bad'), { response: { status: 400, data: { message: Object.values(errors)[0], errors } } });

beforeEach(() => {
  loaded = blank();
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/clubs') return { data: [{ id: 7, name: 'Stockport PC' }, { id: 9, name: 'Other PC' }] };
    if (url === '/clubs/9/payouts') return { data: blank({ clubId: 9, clubName: 'Other PC' }) };
    if (url === '/clubs/7/payouts') return { data: loaded };
    throw new Error(`unexpected GET ${url}`);
  });
  vi.mocked(api.put).mockImplementation(async (_url, body) => ({ data: { ...loaded, ...(body as object), status: 1 } }));
  vi.mocked(api.post).mockResolvedValue({ data: complete({ status: 2 }) });
});

describe('PayoutsPage: the stepped flow', () => {
  it('opens on step 1 with the test-mode note and six steps', async () => {
    mount();
    expect(await screen.findByText('Step 1 of 6:')).toBeInTheDocument();
    expect(screen.getByText(/Test mode: no real money moves yet/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Go to step/ })).toHaveLength(6);
    expect(screen.getByRole('radio', { name: /Registered charity/ })).toBeInTheDocument();
  });

  it('asks for who is being paid before moving on, then saves it', async () => {
    mount();
    await screen.findByText('Step 1 of 6:');
    await next();
    expect(screen.getByText('Pick who is being paid.')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('radio', { name: /Club or association/ }));
    await userEvent.click(screen.getByRole('button', { name: /Ireland or the EU/ }));
    await next();

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/clubs/7/payouts', { businessType: 1, region: 1 }));
    expect(await screen.findByText('Step 2 of 6:')).toBeInTheDocument();
  });

  it('checks the business details as the server does, and sends them', async () => {
    loaded = blank({ status: 1, businessType: 2, missing: ['legalName'] });
    mount();
    await screen.findByText('Step 2 of 6:');
    await next();
    expect(screen.getByText('Enter the legal name.')).toBeInTheDocument();
    expect(screen.getByText('Enter the charity number.')).toBeInTheDocument();

    await typeInto('Legal name', 'Stockport Pony Club');
    await typeInto('Address line 1', '1 High St');
    await typeInto('Town or city', 'Stockport');
    await typeInto('Postcode', 'nonsense');
    await typeInto('Contact email', 'a@example.org');
    await typeInto('Contact phone', '+44 7700 900123');
    await typeInto('Charity number', '1234567');
    await next();
    expect(screen.getByText('Enter a UK postcode, like SW1A 1AA.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Postcode'));
    await typeInto('Postcode', 'sk1 1aa');
    await userEvent.type(screen.getByLabelText(/VAT number/), 'GB123456789');
    await next();

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/clubs/7/payouts', expect.objectContaining({
      legalName: 'Stockport Pony Club', postcode: 'SK1 1AA', registrationNumber: '1234567', vatNumber: 'GB123456789', tradingName: '',
    })));
    expect(await screen.findByText('Step 3 of 6:')).toBeInTheDocument();
  });

  it('takes the responsible person, rejecting someone under 18', async () => {
    loaded = blank({ status: 1, businessType: 1, legalName: 'x', addressLine1: 'x', city: 'x', postcode: 'SK1 1AA', contactEmail: 'a@b.co', contactPhone: '01234567890', missing: ['personFullName'] });
    mount();
    await screen.findByText('Step 3 of 6:');
    await next();
    expect(screen.getByText("Enter the responsible person's full name.")).toBeInTheDocument();
    await typeInto('Full name', 'Ann Smith');
    await typeInto('Date of birth', '2020-01-01');
    await next();
    expect(screen.getByText('They must be at least 18.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Date of birth'));
    await typeInto('Date of birth', '1985-03-14');
    await next();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/clubs/7/payouts', { personFullName: 'Ann Smith', personDateOfBirth: '1985-03-14' }));
  });

  it('explicitly removes a saved birth date while keeping the responsible person', async () => {
    loaded = complete({ status: 2, personFullName: 'Fake Responsible Person', personDateOfBirth: '2000-01-01' });
    vi.mocked(api.put).mockResolvedValue({ data: { ...loaded, status: 1, personDateOfBirth: null, missing: ['personDateOfBirth'] } });
    mount();
    await screen.findByText('Payouts are ready', { exact: false });
    await userEvent.click(screen.getByRole('button', { name: 'Go to step 3: Responsible person' }));
    await userEvent.clear(screen.getByLabelText('Date of birth'));
    await next();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/clubs/7/payouts', {
      personFullName: 'Fake Responsible Person', personDateOfBirth: null, clearPersonDateOfBirth: true,
    }));
    expect(await screen.findByText('Step 4 of 6:')).toBeInTheDocument();
    expect(screen.queryByText('Payouts are ready', { exact: false })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Go to step 3: Responsible person' }));
    expect(screen.getByLabelText('Date of birth')).toHaveValue('');
    await next();
    expect(screen.getByText('Enter their date of birth.')).toBeInTheDocument();
  });

  it('takes a UK bank account with numeric boxes, shows the sort code as 12-34-56, and clears the numbers once sent', async () => {
    loaded = complete({ bank: null, missing: ['bank'] });
    vi.mocked(api.put).mockResolvedValue({ data: complete() });
    mount();
    await screen.findByText('Step 4 of 6:');
    await next();
    expect(screen.getByText('Enter the name on the account.')).toBeInTheDocument();
    expect(screen.getByText('A sort code has 6 digits.')).toBeInTheDocument();
    expect(screen.getByText('An account number has 8 digits.')).toBeInTheDocument();

    expect(screen.getByLabelText('Sort code')).toHaveAttribute('inputmode', 'numeric');
    expect(screen.getByLabelText('Account number')).toHaveAttribute('inputmode', 'numeric');
    await typeInto('Name on the account', 'Stockport PC');
    await typeInto('Sort code', '20e1234');
    await typeInto('Account number', '1234-5e678x9');
    expect(screen.getByLabelText('Sort code')).toHaveValue('20-12-34');
    expect(screen.getByLabelText('Account number')).toHaveValue('12345678');
    await next();

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/clubs/7/payouts/bank', { accountHolder: 'Stockport PC', sortCode: '20-12-34', accountNumber: '12345678' }));
    expect(await screen.findByText('Step 5 of 6:')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('12345678');
  });

  it('shows saved bank details masked only, with a way to change them', async () => {
    loaded = complete();
    mount();
    await screen.findByText('Step 6 of 6:');
    await userEvent.click(screen.getByRole('button', { name: 'Go to step 4: Bank account' }));
    expect(screen.getByText(`Barclays ${BULLETS}1234`)).toBeInTheDocument();
    expect(screen.queryByLabelText('Account number')).not.toBeInTheDocument();
    await next();
    expect(await screen.findByText('Step 5 of 6:')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Go to step 4: Bank account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByLabelText('Account number')).toHaveValue('');
  });

  it('asks Ireland and EU clubs for an IBAN and a BIC, in groups of four', async () => {
    loaded = complete({ region: 1, currency: 'EUR', bank: null, missing: ['bank'], postcode: 'D02 X285' });
    mount();
    await screen.findByText('Step 4 of 6:');
    await typeInto('Name on the account', 'Stockport PC');
    await typeInto('IBAN', 'ie29aibk93115212345679');
    await typeInto(/^BIC/, 'nope');
    await next();
    expect(screen.getByText("That IBAN doesn't look right. Check it and try again.")).toBeInTheDocument();
    expect(screen.getByText('A BIC has 8 or 11 letters and numbers.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('IBAN'));
    await typeInto('IBAN', 'ie29aibk93115212345678');
    expect(screen.getByLabelText('IBAN')).toHaveValue('IE29 AIBK 9311 5212 3456 78');
    await userEvent.clear(screen.getByLabelText(/^BIC/));
    await next();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/clubs/7/payouts/bank', { accountHolder: 'Stockport PC', iban: 'IE29 AIBK 9311 5212 3456 78', bic: null }));
  });

  it('keeps the statement descriptor to capitals, letters and numbers, and picks a schedule', async () => {
    loaded = complete({ statementDescriptor: null, missing: ['statementDescriptor'] });
    mount();
    await screen.findByText('Step 5 of 6:');
    await next();
    expect(screen.getByText('Enter a statement descriptor.')).toBeInTheDocument();
    await typeInto('Statement descriptor', 'abc*');
    expect(screen.getByLabelText('Statement descriptor')).toHaveValue('ABC');
    await next();
    expect(screen.getByText('Use 5 to 22 letters, numbers or spaces, with at least one letter.')).toBeInTheDocument();
    await typeInto('Statement descriptor', 'de pc');
    await userEvent.click(screen.getByRole('combobox', { name: 'Payout schedule' }));
    await userEvent.click(screen.getByRole('option', { name: /After each event/ }));
    await next();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/clubs/7/payouts', { statementDescriptor: 'ABCDE PC', schedule: 2 }));
  });

  it('shows the API\'s field errors and the next step on a failed save', async () => {
    loaded = blank({ status: 1, businessType: 1, missing: ['legalName'] });
    vi.mocked(api.put).mockRejectedValueOnce(errorResponse({ contactEmail: 'Enter a valid email address.' }));
    mount();
    await screen.findByText('Step 2 of 6:');
    await typeInto('Legal name', 'Club');
    await typeInto('Address line 1', '1 High St');
    await typeInto('Town or city', 'Stockport');
    await typeInto('Postcode', 'SK1 1AA');
    await typeInto('Contact email', 'a@example.org');
    await typeInto('Contact phone', '01234567890');
    await next();
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 6:')).toBeInTheDocument();
  });

  it('reviews the details with edit links, then finishes', async () => {
    loaded = complete();
    mount();
    await screen.findByText('Step 6 of 6:');
    const review = within(screen.getByRole('region', { name: 'Review and finish' }));
    expect(review.getByText('Stockport Pony Club')).toBeInTheDocument();
    expect(review.getByText('Ann Smith · 14 March 1985')).toBeInTheDocument();
    expect(review.getByText(`Barclays ${BULLETS}1234`)).toBeInTheDocument();
    expect(review.getByText('STOCKPORT PC')).toBeInTheDocument();
    await userEvent.click(review.getByRole('button', { name: 'Edit legal name' }));
    expect(await screen.findByText('Step 2 of 6:')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Go to step 6: Review and finish' }));

    await userEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(await screen.findByRole('status')).toHaveTextContent(`Payouts are ready · Barclays ${BULLETS}1234`);
    expect(api.post).toHaveBeenCalledWith('/clubs/7/payouts/finish');
    expect(screen.getByRole('button', { name: 'Finished' })).toBeDisabled();
  });

  it('says what is still missing when finishing fails', async () => {
    loaded = complete({ status: 1, missing: ['statementDescriptor'], statementDescriptor: null });
    vi.mocked(api.post).mockRejectedValueOnce(errorResponse({ statementDescriptor: 'Enter a statement descriptor.' }));
    mount();
    await screen.findByText('Step 5 of 6:');
    await userEvent.click(screen.getByRole('button', { name: 'Go to step 6: Review and finish' }));
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(await screen.findByText('Some details are missing. Fix them to finish.')).toBeInTheDocument();
    expect(screen.getByText(/Still to do: statement and schedule/)).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });

  it('goes back a step', async () => {
    loaded = blank({ status: 1, businessType: 1, missing: ['legalName'] });
    mount();
    await screen.findByText('Step 2 of 6:');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Step 1 of 6:')).toBeInTheDocument();
  });

  it('shows a message when saving fails without field errors', async () => {
    loaded = blank({ status: 1, businessType: 1, missing: ['legalName'] });
    mount();
    await screen.findByText('Step 2 of 6:');
    await userEvent.click(screen.getByRole('button', { name: 'Go to step 1: Who\'s being paid' }));
    vi.mocked(api.put).mockRejectedValueOnce(new Error('offline'));
    await next();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save. Try again.');
  });
});

describe('PayoutsPage: access and loading', () => {
  it('shows a message when the details cannot be loaded', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('down'));
    mount();
    expect(await screen.findByText('Could not load the payout details. Try again.')).toBeInTheDocument();
  });

  it('refuses an odd response', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { nope: true } });
    mount();
    expect(await screen.findByText('Could not load the payout details. Try again.')).toBeInTheDocument();
  });

  it('lets an admin pick any club', async () => {
    mount({ roles: ['Admin'], clubId: null });
    await userEvent.selectOptions(await screen.findByLabelText('Club'), 'Other PC');
    expect(await screen.findByText('Step 1 of 6:')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/clubs/9/payouts');
  });

  it('tells someone with no club to join one', async () => {
    mount({ clubId: null });
    expect(await screen.findByText('Payouts belong to a club. Join a club first.')).toBeInTheDocument();
  });
});
