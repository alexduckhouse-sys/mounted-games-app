import type { ReactNode } from 'react';
import { Notice } from '../../components/Notice';
import type { TestPayment } from './types';

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Notice actionLabel="Try again" onAction={onRetry}>{message}</Notice>
  );
}

export function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'test' }) {
  const colour = {
    neutral: 'border-[rgb(var(--mg-control))] text-[rgb(var(--mg-body))]',
    good: 'border-[rgb(var(--mg-ok))] bg-[rgb(var(--mg-ok)/0.14)] text-[rgb(var(--mg-ok))]',
    warn: 'border-[rgb(var(--mg-problem-ink)/0.4)] bg-[rgb(var(--mg-problem-bg))] text-[rgb(var(--mg-problem-ink))]',
    test: 'border-[rgb(var(--mg-info-ink)/0.4)] bg-[rgb(var(--mg-info-bg))] text-[rgb(var(--mg-info-ink))]',
  }[tone];
  return <span className={`inline-flex min-h-6 items-center rounded-md border px-2 text-xs font-bold ${colour}`}>{children}</span>;
}

export function TestReceipt({ payment }: { payment: TestPayment }) {
  return (
    <Notice tone="info" className="mg-rise w-full text-left">
      <span className="block font-extrabold">{payment.receiptLabel}</span>
      <span className="mt-1 block break-all text-xs">Test receipt: {payment.receiptReference}</span>
    </Notice>
  );
}
