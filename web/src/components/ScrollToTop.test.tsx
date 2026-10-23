import { act, render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScrollToTop } from './ScrollToTop';

function setup() {
  const router = createMemoryRouter([{ path: '*', element: <ScrollToTop /> }], { initialEntries: ['/a'] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('ScrollToTop', () => {
  beforeEach(() => {
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  it('opens a new page at the top', async () => {
    const router = setup();
    vi.mocked(window.scrollTo).mockClear();
    await act(() => router.navigate('/b'));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0 });
  });

  it('keeps the scroll position on back', async () => {
    const router = setup();
    await act(() => router.navigate('/b'));
    vi.mocked(window.scrollTo).mockClear();
    await act(() => router.navigate(-1));
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('leaves anchor links to scroll to their part', async () => {
    const router = setup();
    vi.mocked(window.scrollTo).mockClear();
    await act(() => router.navigate('/b#part'));
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
