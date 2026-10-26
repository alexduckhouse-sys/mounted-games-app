import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { api } from '../../api';
import { DemoPaymentFlow, DemoPaymentLock } from './DemoPaymentFlow';
import { DemoOrderCheckout } from './EventShopPage';
import type { EventOrder, FakePaymentOutcome, TestPayment } from './types';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const post = vi.mocked(api.post);

beforeEach(() => {
  vi.clearAllMocks();
});

function payment(status: 0 | 1 | 2 | 3, id = status + 1): TestPayment {
  return {
    id, competitionId: 5, target: 1, targetId: 42, operation: status === 3 ? 1 : 0,
    requestedOutcome: status === 3 ? null : status as 0 | 1 | 2,
    status, amountMinor: 2500, currency: 'GBP', isTest: true, provider: 'fake',
    receiptReference: `TEST-${id}`, receiptLabel: 'TEST PAYMENT — NO MONEY TAKEN', createdAt: '',
  };
}

function order(overrides: Partial<EventOrder> = {}): EventOrder {
  return {
    id: 31, competitionId: 5, buyerUserId: 'buyer', status: 1, totalMinor: 2500, currency: 'GBP',
    isTestOrder: true, hasStockReservation: true, paidAt: null, cancelledAt: null, refundedAt: null,
    lines: [], testPayments: [], createdAt: '', updatedAt: '', ...overrides,
  };
}

async function enterSuccessDetails() {
  await userEvent.click(screen.getByRole('button', { name: 'Enter demo details' }));
  await userEvent.click(screen.getByRole('button', { name: 'Use demo details' }));
}

describe('DemoPaymentFlow', () => {
  it('rejects real card details and sends only the selected fake outcome and payment key', async () => {
    const onPay = vi.fn(async (outcome: FakePaymentOutcome, key: string) => {
      void outcome;
      void key;
      return payment(0);
    });
    render(<DemoPaymentFlow targetKey="order-31" title="Order #31" amountMinor={2500} onPay={onPay} />);
    await userEvent.click(screen.getByRole('button', { name: 'Enter demo details' }));
    await userEvent.type(screen.getByLabelText('Name on demo card'), 'Made Up Rider');
    await userEvent.type(screen.getByLabelText('Demo card number'), '5555555555554444');
    await userEvent.type(screen.getByLabelText('Demo expiry'), '12/34');
    await userEvent.type(screen.getByLabelText('Demo CVC'), '123');
    await userEvent.click(screen.getByRole('button', { name: 'Run demo payment for £25.00' }));
    expect(await screen.findByText('Use one of the demo card numbers shown below.')).toBeInTheDocument();
    expect(onPay).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Use demo details' }));
    await userEvent.click(screen.getByRole('button', { name: 'Run demo payment for £25.00' }));
    await screen.findByRole('heading', { name: 'Demo payment approved' });
    expect(onPay).toHaveBeenCalledOnce();
    const [outcome, key] = onPay.mock.calls[0];
    expect(outcome).toBe(0);
    expect(key).toMatch(/^demo-payment-order-31-/);
    expect(JSON.stringify(onPay.mock.calls[0])).not.toContain('4242424242424242');
  });

  it.each([
    ['decline', 'Use decline card', 1, 1, 'Demo payment declined'],
    ['cancel', null, 2, 2, 'Demo payment cancelled'],
  ] as const)('shows the server-confirmed %s result', async (_name, detailsButton, outcome, status, heading) => {
    const onPay = vi.fn(async () => payment(status));
    render(<DemoPaymentFlow targetKey="entry-42" title="Competition entry #42" amountMinor={2500} onPay={onPay} />);
    await userEvent.click(screen.getByRole('button', { name: 'Enter demo details' }));
    if (detailsButton) await userEvent.click(screen.getByRole('button', { name: detailsButton }));
    await userEvent.click(screen.getByRole('button', { name: detailsButton ? 'Run demo payment for £25.00' : 'Cancel demo payment' }));
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(onPay).toHaveBeenCalledWith(outcome, expect.any(String));
  });

  it('keeps the same payment key when the response is lost and the user retries', async () => {
    const onPay = vi.fn()
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce(payment(0));
    render(<DemoPaymentFlow targetKey="order-31" title="Order #31" amountMinor={2500} onPay={onPay} />);
    await enterSuccessDetails();
    await userEvent.click(screen.getByRole('button', { name: 'Run demo payment for £25.00' }));
    expect(await screen.findByText('Couldn’t check the demo payment. Check your signal and try again.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Run demo payment for £25.00' }));
    await screen.findByRole('heading', { name: 'Demo payment approved' });
    expect(onPay.mock.calls[1][1]).toBe(onPay.mock.calls[0][1]);
  });

  it('can retry a declined payment when its receipt is fed back by the parent', async () => {
    const onPay = vi.fn()
      .mockResolvedValueOnce(payment(1, 10))
      .mockResolvedValueOnce(payment(0, 11));
    function Parent() {
      const [latest, setLatest] = useState<TestPayment | null>(null);
      return <DemoPaymentFlow targetKey="order-31" title="Order #31" amountMinor={2500} initialPayment={latest} onPay={onPay} onPayment={setLatest} />;
    }
    render(<Parent />);
    await userEvent.click(screen.getByRole('button', { name: 'Enter demo details' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use decline card' }));
    await userEvent.click(screen.getByRole('button', { name: 'Run demo payment for £25.00' }));
    await screen.findByRole('heading', { name: 'Demo payment declined' });
    await userEvent.click(screen.getByRole('button', { name: 'Try another demo payment' }));
    expect(screen.getByLabelText('Demo card number')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use demo details' }));
    await userEvent.click(screen.getByRole('button', { name: 'Run demo payment for £25.00' }));
    expect(await screen.findByRole('heading', { name: 'Demo payment approved' })).toBeInTheDocument();
  });

  it('has a static lock state for reduced-motion users', () => {
    render(<DemoPaymentLock state="waiting" reducedMotion />);
    expect(document.querySelector('.demo-lock')).toHaveAttribute('data-reduced-motion', 'true');
  });
});

describe('demo payment entry points', () => {
  it('runs the order form without putting demo card fields in the request', async () => {
    const paidOrder = order({ status: 2, testPayments: [payment(0)] });
    post.mockResolvedValue({ data: { order: paidOrder, payment: payment(0) } } as never);
    render(<DemoOrderCheckout order={order()} onChanged={vi.fn()} />);
    await enterSuccessDetails();
    await userEvent.click(screen.getByRole('button', { name: 'Run demo payment for £25.00' }));
    await screen.findByRole('heading', { name: 'Demo payment approved' });
    expect(post).toHaveBeenCalledWith('/commerce/orders/31/demo-checkout', {
      idempotencyKey: expect.any(String), outcome: 0,
    });
  });
});
