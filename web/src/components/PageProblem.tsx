import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './sitePages.css';

export interface PageProblemProps {
  title: string;
  /** One sentence: what to do next. */
  children: ReactNode;
  /** The main pill, filled: "Try again", "Reload page". */
  primaryLabel?: string;
  onPrimary?: () => void;
  /** The second pill, outlined: "Go back", "Competitions". Give it `onSecondary`, or `secondaryTo` for a link. */
  secondaryLabel?: string;
  onSecondary?: () => void;
  secondaryTo?: string;
}

/**
 * A whole page that can't show: no card, a heading, one sentence and up to two pills, the same pattern as
 * Page not found. Use it instead of an error card when there is nothing else on the page to look at.
 */
export function PageProblem({ title, children, primaryLabel, onPrimary, secondaryLabel, onSecondary, secondaryTo }: PageProblemProps) {
  return (
    <div className="skin mx-auto w-full max-w-[560px]" role="alert">
      <div className="sp-small">
        <h1>{title}</h1>
        <p>{children}</p>
        {(primaryLabel || secondaryLabel) && (
          <div className="sp-acts">
            {primaryLabel && <button type="button" className="sp-pill sp-pill-fill" onClick={onPrimary}>{primaryLabel}</button>}
            {secondaryLabel && secondaryTo && <Link to={secondaryTo} className="sp-pill">{secondaryLabel}</Link>}
            {secondaryLabel && !secondaryTo && <button type="button" className="sp-pill" onClick={onSecondary}>{secondaryLabel}</button>}
          </div>
        )}
      </div>
    </div>
  );
}
