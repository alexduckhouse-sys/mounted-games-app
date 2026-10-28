import type { ComponentProps, MouseEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

/**
 * A back arrow that returns to the page the person came from, so scroll position and filters survive.
 * On a fresh load or deep link there is no earlier in-app page, so it goes to `to` (the fixed parent) instead.
 */
export function BackLink({ to, onClick, ...rest }: ComponentProps<typeof Link>) {
  const navigate = useNavigate();
  const location = useLocation();
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    // React Router gives the first entry of a session the key "default"; anything else has an in-app entry behind it.
    if (location.key === 'default') return;
    event.preventDefault();
    navigate(-1);
  }
  return <Link to={to} onClick={handleClick} {...rest} />;
}
