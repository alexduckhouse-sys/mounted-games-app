import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { MySignup } from '../../types';
import { DemoEntryPayment } from './DemoEntryPayment';
import { TestEntryPaymentPage } from './TestEntryPaymentPage';
import type { TestPayment } from './types';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

function signup(overrides: Partial<MySignup> = {}): MySignup {
  return {
    id: 42, competitionId: 5, competitionName: 'Demo Meadow Cup', competitionStart: '2026-11-01T09:00:00Z',
    competitionSectionId: 9, sectionName: 'Seniors teams', fullName: 'Ann Rider', amountMinor: 1500, status: 0,
    createdAt: '2026-10-22T10:00:00Z', ...overrides,
  };
}

function payment(status: 0 | 1 | 2 | 3, id = status + 1): TestPayment {
  return {
    id, competitionId: 5, target: 1, targetId: 42, operation: status === 3 ? 1 : 0,
    requestedOutcome: status === 3 ? null : status as 0 | 1 | 2,
    status, amountMinor: 1500, currency: 'GBP', isTest: true, provider: 'fake',
    receiptReference: `TEST-${id}`, receiptLabel: 'TEST PAYMENT — NO MONEY WAS TAKEN', createdAt: '2026-10-22T10:05:00Z',
  };
}

function serve(options: { signup?: MySignup | null; isDemo?: boolean; payments?: TestPayment[]; failSignups?: boolean } = {}) {
  const { isDemo = true, payments = [], failSignups = false } = options;
  const row = options.signup === undefined ? signup() : options.signup;
  get.mockImplementation(async (url) => {
    if (url === '/me/signups') {
      if (failSignups) throw new Error('offline');
      return { data: row ? [row] : [] } as never;
    }
    if (url === '/commerce/entry-payments/mine') return { data: payments } as never;
    return { data: { competitionId: 5, isDemo, isLocked: false, updatedAt: null } } as never;
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/me/signups/42/test-payment']}>
      <Routes>
        <Route path="/me/signups/:signupId/test-payment" element={<TestEntryPaymentPage />} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('test payment page', () => {
  it('labels itself as a test and asks for no card details', async () => {
    serve();
    renderPage();

    expect(await screen.findByRole('heading', { name: /Test payment/ })).toBeInTheDocument();
    expect(screen.getByText(/We don’t ask for card details\./).closest('.kit-strip-info')).toHaveTextContent('Test payment');
    expect(screen.getByText('This is a demo. No money will be taken or sent, and your entry hasn’t been paid for.').closest('.kit-strip-info')).not.toBeNull();
    expect(screen.getByText('Test amount')).toBeInTheDocument();
    expect(screen.getByText('£15.00')).toBeInTheDocument();
    expect(document.querySelectorAll('input, textarea, select')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Pay £15.00 (test)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try a declined card (test)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('pays, shows a TEST receipt and sends only the outcome', async () => {
    serve();
    post.mockResolvedValue({ data: { signupId: 42, signupStatus: 1, paidAt: '2026-10-22T10:05:00Z', payment: payment(0, 70) } } as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Pay £15.00 (test)' }));

    expect(await screen.findByRole('heading', { name: /Test receipt/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'TEST RECEIPT' })).toBeInTheDocument();
    expect(screen.getByText('TEST-70')).toBeInTheDocument();
    expect(screen.getByText('Approved (test)')).toBeInTheDocument();
    expect(screen.getByText(/never counted as money received/)).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/commerce/signups/42/demo-checkout', { idempotencyKey: expect.any(String), outcome: 0 });
  });

  it('shows a declined card, then lets the person go back and try again with a new attempt', async () => {
    serve();
    post.mockResolvedValueOnce({ data: { signupId: 42, signupStatus: 0, paidAt: null, payment: payment(1, 71) } } as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Try a declined card (test)' }));

    expect(await screen.findByText('Test card declined')).toBeInTheDocument();
    expect(screen.getAllByText('Nothing was charged.').some((element) => element.closest('.kit-strip-info'))).toBe(true);
    expect(screen.getByText('This is a demo. No money will be taken or sent, and your entry hasn’t been paid for.')).toBeInTheDocument();
    expect(screen.queryByText('TEST RECEIPT')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to the test payment' }));
    expect(screen.getByRole('button', { name: 'Pay £15.00 (test)' })).toBeInTheDocument();
  });

  it('records a cancel as its own test outcome', async () => {
    serve();
    post.mockResolvedValue({ data: { signupId: 42, signupStatus: 0, paidAt: null, payment: payment(2, 72) } } as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('Test payment cancelled')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/commerce/signups/42/demo-checkout', { idempotencyKey: expect.any(String), outcome: 2 });
  });

  it('keeps the same attempt key when a failed request is repeated', async () => {
    serve();
    post.mockRejectedValueOnce({ response: { data: { message: 'Busy, try again.' } } });
    post.mockResolvedValueOnce({ data: { signupId: 42, signupStatus: 1, paidAt: '', payment: payment(0, 73) } } as never);
    renderPage();
    const pay = await screen.findByRole('button', { name: 'Pay £15.00 (test)' });
    await userEvent.click(pay);
    expect(await screen.findByRole('alert')).toHaveTextContent('Busy, try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Pay £15.00 (test)' }));

    await screen.findByRole('heading', { name: 'TEST RECEIPT' });
    expect(post.mock.calls[0][1]).toEqual(post.mock.calls[1][1]);
  });

  it('opens straight on the receipt for an entry that is already paid, and runs a test refund', async () => {
    serve({ signup: signup({ status: 1 }), payments: [payment(0, 70)] });
    post.mockResolvedValue({ data: { signupId: 42, signupStatus: 2, paidAt: null, payment: payment(3, 74) } } as never);
    renderPage();

    expect(await screen.findByText('TEST-70')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try a test refund' }));
    expect(await screen.findByText('Test refund recorded')).toBeInTheDocument();
    expect(screen.getByText('TEST-74')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try a test refund' })).not.toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/commerce/signups/42/demo-refund', { idempotencyKey: expect.any(String), outcome: 0 });
  });

  it('reports a failed refund and lets the person retry it', async () => {
    serve({ signup: signup({ status: 1 }), payments: [payment(0, 70)] });
    post.mockRejectedValueOnce({ response: { data: 'Refund busy.' } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Try a test refund' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Refund busy.');
    expect(screen.getByRole('button', { name: 'Try a test refund' })).toBeEnabled();
  });

  it('never offers payment on a real event', async () => {
    serve({ isDemo: false });
    renderPage();

    expect(await screen.findByText('Online payment isn’t available for this event.')).toBeInTheDocument();
    expect(screen.getByText(/Pay the organiser directly/)).toBeInTheDocument();
    expect(screen.getByText('This is a demo. No money will be taken or sent, and your entry hasn’t been paid for.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pay/ })).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('says so when there is nothing to pay', async () => {
    serve({ signup: signup({ status: 3 }) });
    renderPage();

    expect(await screen.findByText('There is nothing to pay for this entry.')).toBeInTheDocument();
    expect(screen.getByText('This is a demo. No money will be taken or sent, and your entry hasn’t been paid for.')).toBeInTheDocument();
  });

  it('copes with an entry that is not on the account and with a failed load', async () => {
    serve({ signup: null });
    const first = renderPage();
    expect(await screen.findByRole('heading', { name: 'Couldn’t find that entry' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My signups' })).toHaveAttribute('href', '/me/signups');
    first.unmount();

    serve({ failSignups: true });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Couldn’t load this entry' })).toBeInTheDocument();
    serve();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Pay £15.00 (test)' })).toBeInTheDocument();
  });

  it('tolerates a missing payment history', async () => {
    get.mockImplementation(async (url) => {
      if (url === '/me/signups') return { data: [signup()] } as never;
      if (url === '/commerce/entry-payments/mine') throw new Error('offline');
      return { data: { competitionId: 5, isDemo: true, isLocked: false, updatedAt: null } } as never;
    });
    renderPage();

    expect(await screen.findByRole('button', { name: 'Pay £15.00 (test)' })).toBeInTheDocument();
  });
});

describe('demo entry link on My signups', () => {
  function renderLink(status: 0 | 1 | 2 | 3) {
    return render(<MemoryRouter><DemoEntryPayment signupId={42} signupStatus={status} /></MemoryRouter>);
  }

  it('links a pending demo entry to the test payment page', async () => {
    get.mockResolvedValue({ data: { competitionId: 5, isDemo: true, isLocked: false, updatedAt: null } } as never);
    renderLink(0);

    const link = await screen.findByRole('link', { name: 'Open the test payment page' });
    expect(link).toHaveAttribute('href', '/me/signups/42/test-payment');
    expect(screen.getByText('This is a demo. No money will be taken or sent, and your entry hasn’t been paid for.')).toBeInTheDocument();
  });

  it('links a paid demo entry to its test receipt', async () => {
    get.mockResolvedValue({ data: { competitionId: 5, isDemo: true, isLocked: false, updatedAt: null } } as never);
    renderLink(1);

    expect(await screen.findByRole('link', { name: 'View the test receipt' })).toBeInTheDocument();
  });

  it('shows the demo notice without a link on a real event still waiting for money, or when the check fails', async () => {
    get.mockResolvedValue({ data: { competitionId: 5, isDemo: false, isLocked: false, updatedAt: null } } as never);
    const real = renderLink(0);
    expect(await screen.findByText('This is a demo. No money will be taken or sent, and your entry hasn’t been paid for.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    real.unmount();

    get.mockRejectedValue(new Error('offline'));
    renderLink(0);
    expect(await screen.findByText('This is a demo. No money will be taken or sent, and your entry hasn’t been paid for.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows nothing for a paid entry on a real event, and nothing until it knows which kind of event it is', async () => {
    get.mockResolvedValue({ data: { competitionId: 5, isDemo: false, isLocked: false, updatedAt: null } } as never);
    const paid = renderLink(1);
    expect(paid.container).toBeEmptyDOMElement();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(paid.container).toBeEmptyDOMElement();
  });
});
