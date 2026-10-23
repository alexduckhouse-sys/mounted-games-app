import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Opens every new page at the top. Back and forward keep the browser's own scroll position, and a link to an
 * anchor (`#part`) is left to scroll to that part.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => {
    if (navigationType === 'POP' || hash) return;
    window.scrollTo({ top: 0, left: 0 });
  }, [pathname, hash, navigationType]);
  return null;
}
