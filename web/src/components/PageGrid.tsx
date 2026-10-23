import type { ReactNode } from 'react';

/**
 * A laptop page: the main column plus a rail. Below `lg` it is one column, so the phone layout is untouched.
 * - `right` (default): main takes 2/3, the rail 1/3 (at least 320px) and sticks under the header.
 * - `left`: a 240px rail on the left (filters, age groups, tool nav) and the content on the right.
 * `railFirst` puts the rail above the main column on phones (e.g. filters, a stream card).
 */
export function PageGrid({ children, aside, variant = 'right', railFirst = false, sticky = true, className = '', asideLabel }: {
  children: ReactNode;
  aside: ReactNode;
  variant?: 'right' | 'left';
  railFirst?: boolean;
  sticky?: boolean;
  className?: string;
  asideLabel?: string;
}) {
  const columns = variant === 'left' ? 'lg:grid-cols-[240px_minmax(0,1fr)]' : 'lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]';
  const mainCol = variant === 'left' ? 'lg:col-start-2' : 'lg:col-start-1';
  const asideCol = variant === 'left' ? 'lg:col-start-1' : 'lg:col-start-2';
  return (
    <div className={`flex flex-col gap-4 lg:grid lg:items-start lg:gap-6 ${columns} ${className}`.trim()}>
      <div className={`min-w-0 ${mainCol} lg:row-start-1`}>{children}</div>
      <aside aria-label={asideLabel} className={`min-w-0 ${asideCol} lg:row-start-1 ${railFirst ? 'order-first lg:order-none' : ''} ${sticky ? 'lg:sticky lg:top-[calc(var(--mg-shell-h,104px)+16px)] lg:self-start' : ''}`.trim()}>{aside}</aside>
    </div>
  );
}
