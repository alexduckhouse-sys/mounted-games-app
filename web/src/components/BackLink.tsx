import type { ComponentProps, MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

/**
 * A back arrow that returns to the page the person came from, so scroll position and filters survive.
 * On a fresh load or deep link there is no earlier in-app page, so it goes to `to` (the fixed parent) instead.
 */
export function BackLink({ to, onClick, ...rest }: ComponentProps<typeof Link>) {
  const navigate = useNavigate();
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    // React Router numbers history entries from 0 (`idx`), and a redirect on first load replaces entry 0 rather than adding one.
    // Only an index above 0 means an earlier in-app page exists; otherwise go to the fixed parent.
    const idx = (window.history.state as { idx?: unknown } | null)?.idx;
    if (typeof idx !== 'number' || idx <= 0) return;
    event.preventDefault();
    navigate(-1);
  }
  return <Link to={to} onClick={handleClick} {...rest} />;
}
