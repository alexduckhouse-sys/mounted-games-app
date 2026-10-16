import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { CompetitionListSkeleton, PageSkeleton, TimetableSkeleton, ToplistRowsSkeleton, ToplistSkeleton } from './Skeletons';

describe('loading placeholders', () => {
  it.each([
    ['timetable', <TimetableSkeleton />, 'Loading timetable…'],
    ['toplist', <ToplistSkeleton />, 'Loading toplist…'],
    ['toplist rows', <ToplistRowsSkeleton />, 'Loading results…'],
    ['competition list', <CompetitionListSkeleton />, 'Loading competitions…'],
    ['page', <PageSkeleton />, 'Opening page…'],
  ])('announces the %s as busy to screen readers and hides the shapes', (_name, element, label) => {
    const { container } = render(element);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveTextContent(label);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('draws as many rows as asked for', () => {
    const rows = (element: ReactElement) => render(element).container.querySelectorAll('[aria-hidden="true"] > div').length;
    expect(rows(<ToplistRowsSkeleton rows={3} />)).toBe(3);
    expect(rows(<CompetitionListSkeleton rows={2} />)).toBe(2);
  });

  it('uses sensible default row counts', () => {
    expect(render(<ToplistRowsSkeleton />).container.querySelectorAll('.min-h-14')).toHaveLength(6);
    expect(render(<CompetitionListSkeleton />).container.querySelectorAll('.mg-row')).toHaveLength(4);
  });
});
