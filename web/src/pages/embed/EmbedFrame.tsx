import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { clockText, embedColours, type EmbedOptions } from '../../lib/embed';
import './embed.css';

/**
 * The shell shared by every widget: a heading, the content, and a small link back to the full page. The
 * link opens in a new tab so the club's page keeps its place. Nothing here reads sign-in, storage or caches.
 */
export function EmbedFrame({ title, subtitle, updatedAt, options, homeHref, children }: {
  title: string;
  subtitle?: string;
  updatedAt?: Date | null;
  options: EmbedOptions;
  homeHref: string;
  children: ReactNode;
}) {
  useEffect(() => {
    document.documentElement.dataset.theme = options.theme === 'dark' ? 'dark' : 'eguk';
  }, [options.theme]);
  useEffect(() => {
    document.title = `${title} · Mounted Games`;
  }, [title]);
  useEffect(() => {
    // Frames are for visitors of the club's page, not for search results.
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    document.head.appendChild(robots);
    return () => robots.remove();
  }, []);

  const colours = embedColours(options.accent, options.theme);
  const style = colours
    ? ({ '--emb-accent': colours.text, '--emb-fill': colours.fill, '--emb-on-fill': colours.onFill } as CSSProperties)
    : undefined;
  const sub = [subtitle, updatedAt ? `Updated ${clockText(updatedAt)}` : ''].filter(Boolean).join(' · ');
  return (
    <div className="emb" style={style}>
      <header className="emb-head">
        <h1 className="emb-title">{title}</h1>
        {sub && <p className="emb-sub">{sub}</p>}
      </header>
      <main className="emb-main">{children}</main>
      <footer className="emb-foot">
        <a href={homeHref} target="_blank" rel="noopener">Powered by Mounted Games</a>
      </footer>
    </div>
  );
}

/** A short message in place of the data: loading, not found, or a failed load with a retry. */
export function EmbedMessage({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="emb-msg" role="status">
      <p style={{ margin: 0 }}>{children}</p>
      {onRetry && <button type="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

/** Shown when the last refresh failed but earlier data is still on screen. */
export function StaleNotice() {
  return <p className="emb-stale" role="status">Couldn’t refresh. Showing the last results we had.</p>;
}
