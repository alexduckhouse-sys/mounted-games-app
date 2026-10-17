import type { ReactNode } from 'react';
import type { TestPayment } from './types';

export function PageHeader({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header className="flex flex-col gap-1.5">
      <h1 className="mg-h1">{title}</h1>
      <p className="mg-lede">{children}</p>
    </header>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mg-card flex flex-col items-start gap-3 p-4">
      <p>{message}</p>
      <button type="button" className="mg-btn mg-btn-secondary" onClick={onRetry}>Try again</button>
    </div>
  );
}

export function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'test' }) {
  const colour = {
    neutral: 'border-[rgb(var(--mg-control))] text-[rgb(var(--mg-body))]',
    good: 'border-emerald-500 bg-emerald-50 text-emerald-800',
    warn: 'border-amber-400 bg-amber-50 text-amber-900',
    test: 'border-violet-400 bg-violet-50 text-violet-900',
  }[tone];
  return <span className={`inline-flex min-h-6 items-center rounded-md border px-2 text-xs font-bold ${colour}`}>{children}</span>;
}

export function TestReceipt({ payment }: { payment: TestPayment }) {
  return (
    <div className="rounded-lg border-2 border-violet-400 bg-violet-50 p-3 text-violet-950" role="status">
      <p className="text-sm font-extrabold">{payment.receiptLabel}</p>
      <p className="mt-1 break-all text-xs">Test receipt: {payment.receiptReference}</p>
    </div>
  );
}
