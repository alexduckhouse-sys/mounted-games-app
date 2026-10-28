import { Component, type RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { useStillMotion } from '../lite/useStillMotion';
import { transitionFor, transitionPlan, type PageTransitionKind } from '../lib/pageTransition';

interface Props {
  /** The element the routed page renders into. Header, ticker and tab bar are outside it and stay still. */
  mainRef: RefObject<HTMLElement | null>;
  pathname: string;
  /** The query string: it only counts when a move is forced, so a heat switch inside one session can still slide. */
  search: string;
  /** A link can ask for a slide with `state: { mgTransition: 'push' }`, whatever the depth of the two pages. */
  forced: boolean;
  popped: boolean;
  /** Lite mode, reduced motion, or a page that shouldn't move (filming). */
  disabled: boolean;
}

interface Box { top: number; left: number; width: number; height: number }
interface Snapshot { kind: PageTransitionKind; copy: HTMLElement; box: Box; scrollReset: boolean }

/** A still copy of a page: no ids, nothing that plays or loads, and nothing a finger or a screen reader can reach. */
function stillCopy(source: HTMLElement): HTMLElement {
  const copy = source.cloneNode(true) as HTMLElement;
  copy.style.visibility = '';
  copy.querySelectorAll('video, audio, iframe, script, [autofocus]').forEach((node) => node.remove());
  copy.removeAttribute('id');
  copy.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  return copy;
}

function boxOf(element: HTMLElement): Box {
  const { top, left, width, height } = element.getBoundingClientRect();
  return { top, left, width, height };
}

/**
 * A fixed frame the size of the screen, under the header and tab bar, holding one copy of a page where it was. It is
 * painted in the page's own background, so neither page shows through the gaps in the other as they slide.
 */
function frame(copy: HTMLElement, box: Box, layer: number): HTMLElement {
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.setAttribute('inert', '');
  holder.setAttribute('data-page-transition', '');
  const ground = getComputedStyle(document.body).backgroundColor;
  holder.style.cssText = `position:fixed;inset:0;z-index:${19 + layer};overflow:hidden;pointer-events:none;will-change:transform,opacity${ground ? `;background:${ground}` : ''}`;
  copy.style.cssText += `;position:absolute;margin:0;top:${box.top}px;left:${box.left}px;width:${box.width}px;height:${box.height}px`;
  holder.appendChild(copy);
  document.body.appendChild(holder);
  return holder;
}

/**
 * Moves between pages the way a phone app does. Going deeper slides the new page in from the right while the old one
 * drifts left and dims; going back reverses it; pages at the same level crossfade. It works on still copies of the two
 * pages, so the real page is never transformed (that would unpin fixed bars inside it) and nothing is remounted.
 * The old page is copied in `getSnapshotBeforeUpdate`, the last moment before React swaps the routed page.
 */
class PageTransitionHost extends Component<Props> {
  private cleanup: (() => void) | null = null;

  getSnapshotBeforeUpdate(prev: Props): Snapshot | null {
    const { mainRef, pathname, search, forced, popped, disabled } = this.props;
    const samePath = prev.pathname === pathname;
    // Any other re-render (the page finishing loading, a ticker update) must leave a running transition alone.
    if (samePath && !(forced && !popped && prev.search !== search)) return null;
    this.cleanup?.();
    const main = mainRef.current;
    if (disabled || !main || typeof main.animate !== 'function') return null;
    const kind: PageTransitionKind | null = forced && !popped ? 'push' : transitionFor(prev.pathname, pathname, popped);
    if (!kind) return null;
    // A new page opens at the top; a move within the same page keeps the scroll it had.
    return { kind, copy: stillCopy(main), box: boxOf(main), scrollReset: !samePath && !popped };
  }

  componentDidUpdate(_prev: Props, _state: unknown, snapshot: Snapshot | null) {
    const main = this.props.mainRef.current;
    if (!snapshot || !main) return;
    const { kind, copy, box, scrollReset } = snapshot;
    const plan = transitionPlan(kind);
    const timing: KeyframeAnimationOptions = { duration: plan.duration, easing: plan.easing, fill: 'both' };
    const holders: HTMLElement[] = [];
    const running: Animation[] = [];
    if (kind === 'fade') {
      // Only the new page fades up (unless it brings its own entrance). A copy of the old page fading out on top showed
      // through the new one for a moment (the "running late" line over the toplist's age band), so there is none.
      if (main.classList.contains('rf-page') || main.querySelector('.rf-page')) return;
      running.push(main.animate(plan.incoming, timing));
    } else {
      const outgoing = frame(copy, box, plan.top === 'outgoing' ? 2 : 1);
      holders.push(outgoing);
      running.push(outgoing.animate(plan.outgoing, timing));
      // A copy of the new page slides in; the real one waits, unseen, so it is never moved.
      const next = boxOf(main);
      const incoming = frame(stillCopy(main), { ...next, top: scrollReset ? next.top + window.scrollY : next.top }, plan.top === 'incoming' ? 2 : 1);
      holders.push(incoming);
      running.push(incoming.animate(plan.incoming, timing));
      main.style.visibility = 'hidden';
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      running.forEach((animation) => animation.cancel());
      holders.forEach((holder) => holder.remove());
      main.style.visibility = '';
      if (this.cleanup === finish) this.cleanup = null;
    };
    const timer = window.setTimeout(finish, plan.duration + 150);
    Promise.all(running.map((animation) => animation.finished)).then(finish, finish);
    this.cleanup = finish;
  }

  componentWillUnmount() {
    this.cleanup?.();
  }

  render() {
    return null;
  }
}

/** Put this next to the element the routed page renders into. */
export function PageTransition({ mainRef, disabled }: { mainRef: RefObject<HTMLElement | null>; disabled?: boolean }) {
  const still = useStillMotion();
  const popped = useNavigationType() === 'POP';
  const { pathname, search, state } = useLocation();
  const forced = (state as { mgTransition?: string } | null)?.mgTransition === 'push';
  return <PageTransitionHost mainRef={mainRef} pathname={pathname} search={search} forced={forced} popped={popped} disabled={still || !!disabled} />;
}
