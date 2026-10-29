import { act, render } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { useEffect, useReducer, useRef } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageTransition } from './PageTransition';

let go: (to: string, replace?: boolean, state?: unknown) => void = () => {};
let goBack: () => void = () => {};
// A page still opening shows a loading placeholder, as a lazy page's skeleton does, until the test lets it finish.
let opening = '';
let refresh: () => void = () => {};
const animations: Array<{ target: HTMLElement; keyframes: Keyframe[]; options: KeyframeAnimationOptions; finish: () => void; cancel: ReturnType<typeof vi.fn> }> = [];

function Harness({ disabled = false }: { disabled?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    refresh = rerender;
    go = (to, replace, state) => navigate(to, { replace, state });
    goBack = () => navigate(-1);
  }, [navigate]);
  return (
    <>
      <main ref={ref} id="main">
        {pathname === opening ? <div role="status" aria-busy="true">Loading</div> : <><span id="inner">{pathname}</span><video /></>}
      </main>
      <PageTransition mainRef={ref} disabled={disabled} />
    </>
  );
}

function mount(path: string, props: { disabled?: boolean; still?: boolean } = {}) {
  return render(
    <MotionConfig reducedMotion={props.still ? 'always' : 'never'}>
      <MemoryRouter initialEntries={['/events', path]} initialIndex={1}><Harness disabled={props.disabled} /></MemoryRouter>
    </MotionConfig>,
  );
}

beforeEach(() => {
  animations.length = 0;
  opening = '';
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    writable: true,
    value(this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      let finish: () => void = () => {};
      const finished = new Promise<void>((resolve) => { finish = resolve; });
      const cancel = vi.fn();
      animations.push({ target: this, keyframes, options, finish, cancel });
      return { finished, cancel };
    },
  });
});
afterEach(() => {
  // @ts-expect-error remove the stub so other tests see jsdom as it is
  delete HTMLElement.prototype.animate;
  vi.useRealTimers();
  document.querySelectorAll('[data-page-transition]').forEach((node) => node.remove());
});

const frames = () => document.querySelectorAll('[data-page-transition]');
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('PageTransition', () => {
  it('does not move on first load', () => {
    mount('/competitions/4');
    expect(animations).toHaveLength(0);
    expect(frames()).toHaveLength(0);
  });

  it('pushes: copies of both pages slide, the real page waits unseen, then everything is tidied away', async () => {
    mount('/competitions/4/teams');
    act(() => go('/competitions/4/teams/9'));
    expect(frames()).toHaveLength(2);
    expect(animations).toHaveLength(2);
    expect(animations[0].keyframes[1]).toMatchObject({ transform: 'translateX(-30%)' });
    expect(animations[1].keyframes[0]).toMatchObject({ transform: 'translateX(100%)' });
    expect(animations[0].options).toMatchObject({ duration: 420, easing: 'cubic-bezier(.32,.72,0,1)' });
    const main = document.getElementById('main')!;
    expect(main.style.visibility).toBe('hidden');
    // The old page's copy shows the old page, and nothing in a copy can be reached or played.
    const copies = [...frames()] as HTMLElement[];
    expect(copies[0]).toHaveAttribute('aria-hidden', 'true');
    expect(copies[0]).toHaveAttribute('inert');
    expect(copies[0].textContent).toContain('/competitions/4/teams');
    expect(copies[1].textContent).toContain('/competitions/4/teams/9');
    expect(copies[0].querySelector('video')).toBeNull();
    expect(copies[0].querySelector('[id]')).toBeNull();
    expect(copies[0].style.zIndex).toBe('20');
    expect(copies[1].style.zIndex).toBe('21');

    animations.forEach((a) => a.finish());
    await flush();
    expect(frames()).toHaveLength(0);
    expect(main.style.visibility).toBe('');
  });

  it('goes back with the leaving page on top', () => {
    mount('/competitions/4/teams/9');
    act(() => go('/competitions/4/teams'));
    const copies = [...frames()] as HTMLElement[];
    expect(copies).toHaveLength(2);
    expect(animations[0].keyframes[1]).toMatchObject({ transform: 'translateX(100%)' });
    expect(copies[0].style.zIndex).toBe('21');
  });

  it('uses the viewport position of the new page when the browser went back', () => {
    mount('/competitions/4/teams/9');
    act(() => goBack());
    expect(animations).toHaveLength(2);
  });

  it('fades the new page up at the same level, with no copy of the old page over it', () => {
    mount('/competitions/4/chat');
    act(() => go('/competitions/4'));
    expect(frames()).toHaveLength(0);
    expect(animations).toHaveLength(1);
    expect(animations[0].target.id).toBe('main');
    expect(animations[0].keyframes).toEqual([{ opacity: 0.4 }, { opacity: 1 }]);
    expect(animations[0].options.duration).toBe(160);
    expect(document.getElementById('main')!.style.visibility).toBe('');
  });

  it('still fades a page that carries the shared page class (the page has no entrance of its own)', () => {
    mount('/competitions/4/chat');
    document.getElementById('main')!.classList.add('rf-page');
    act(() => go('/competitions/4'));
    expect(animations).toHaveLength(1);
    expect(frames()).toHaveLength(0);
  });

  it('paints the sliding copies in the page background, so the old page never shows through the new one', () => {
    document.body.style.backgroundColor = 'rgb(247, 247, 247)';
    mount('/competitions/4');
    act(() => go('/competitions/4/teams/9'));
    expect([...frames()].map((holder) => (holder as HTMLElement).style.background)).toEqual(['rgb(247, 247, 247)', 'rgb(247, 247, 247)']);
    document.body.style.backgroundColor = '';
  });

  it('slides when a link asks for it, even within one page or between pages at the same level', () => {
    mount('/competitions/4/session/1?heat=1');
    act(() => go('/competitions/4/session/1?heat=2', false, { mgTransition: 'push' }));
    expect(animations).toHaveLength(2);
    expect(animations[1].keyframes[0]).toMatchObject({ transform: 'translateX(100%)' });
    animations.length = 0;
    act(() => go('/competitions/4/session/2?heat=5', false, { mgTransition: 'push' }));
    expect(animations[1].keyframes[0]).toMatchObject({ transform: 'translateX(100%)' });
  });

  it('does nothing when only the query changes', () => {
    mount('/competitions/4/chat');
    act(() => go('/competitions/4/chat?x=1'));
    expect(animations).toHaveLength(0);
  });

  it('keeps a slide running when the shell re-renders without a new page (the page loading, a ticker update)', () => {
    mount('/competitions/4/teams');
    act(() => go('/competitions/4/teams/9'));
    expect(frames()).toHaveLength(2);
    act(() => go('/competitions/4/teams/9?tab=stats'));
    expect(frames()).toHaveLength(2);
    expect(animations[0].cancel).not.toHaveBeenCalled();
    expect(animations[1].cancel).not.toHaveBeenCalled();
  });

  it('tidies up when the animation is cancelled, runs out of time, or another move starts', async () => {
    vi.useFakeTimers();
    mount('/competitions/4/teams');
    act(() => go('/competitions/4/teams/9'));
    expect(frames()).toHaveLength(2);
    act(() => { vi.advanceTimersByTime(600); });
    expect(frames()).toHaveLength(0);
    expect(animations[0].cancel).toHaveBeenCalled();

    act(() => go('/competitions/4/teams'));
    expect(frames()).toHaveLength(2);
    act(() => go('/competitions/4/chat'));
    // The first move was ended on the spot and a new one (a fade of the real page, with no copies) began.
    expect(frames()).toHaveLength(0);
    expect(animations[animations.length - 1].target.id).toBe('main');
  });

  it('removes its copies if the shell goes away mid-move', () => {
    const view = mount('/competitions/4/teams');
    act(() => go('/competitions/4/teams/9'));
    expect(frames()).toHaveLength(2);
    view.unmount();
    expect(frames()).toHaveLength(0);
  });

  it('stays still when disabled, in lite mode or with reduced motion', () => {
    mount('/competitions/4/teams', { disabled: true });
    act(() => go('/competitions/4/teams/9'));
    expect(animations).toHaveLength(0);
  });

  it('stays still with reduced motion', () => {
    mount('/competitions/4/teams', { still: true });
    act(() => go('/competitions/4/teams/9'));
    expect(animations).toHaveLength(0);
    expect(frames()).toHaveLength(0);
  });

  it('stays still where the browser cannot animate', () => {
    mount('/competitions/4/teams');
    // @ts-expect-error simulate a browser without the Web Animations API
    delete HTMLElement.prototype.animate;
    act(() => go('/competitions/4/teams/9'));
    expect(frames()).toHaveLength(0);
  });

  it('holds the old page while the new one is still opening, then slides the real page in', async () => {
    mount('/competitions/4/teams');
    opening = '/competitions/4/teams/9';
    act(() => go('/competitions/4/teams/9'));
    // Only the held copy of the old page shows; the skeleton waits unseen and nothing moves yet.
    expect(frames()).toHaveLength(1);
    expect(frames()[0].textContent).toContain('/competitions/4/teams');
    expect(animations).toHaveLength(0);
    const main = document.getElementById('main')!;
    expect(main.style.visibility).toBe('hidden');
    // A change inside the skeleton is not the page arriving.
    main.querySelector('[aria-busy]')!.append('…');
    await flush();
    expect(animations).toHaveLength(0);

    opening = '';
    act(() => refresh());
    await flush();
    expect(animations).toHaveLength(2);
    const copies = [...frames()] as HTMLElement[];
    expect(copies).toHaveLength(2);
    expect(copies[1].textContent).toContain('/competitions/4/teams/9');
    expect(copies[1].textContent).not.toContain('Loading');

    animations.forEach((a) => a.finish());
    await flush();
    expect(frames()).toHaveLength(0);
    expect(main.style.visibility).toBe('');
  });

  it('stops waiting after a moment and fades in whatever is there', () => {
    vi.useFakeTimers();
    mount('/competitions/4/chat');
    opening = '/competitions/4/arena';
    act(() => go('/competitions/4/arena'));
    expect(frames()).toHaveLength(1);
    expect(animations).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(350); });
    expect(frames()).toHaveLength(0);
    expect(animations).toHaveLength(1);
    expect(animations[0].target.id).toBe('main');
    expect(document.getElementById('main')!.style.visibility).toBe('');
  });

  it('drops the held page if another move starts or the shell goes away while waiting', () => {
    const view = mount('/competitions/4/chat');
    opening = '/competitions/4/arena';
    act(() => go('/competitions/4/arena'));
    expect(frames()).toHaveLength(1);
    opening = '';
    act(() => go('/competitions/4/teams'));
    // The held page went with the first move; the second one is a plain fade of the real page.
    expect(frames()).toHaveLength(0);
    expect(animations).toHaveLength(1);
    expect(document.getElementById('main')!.style.visibility).toBe('');

    opening = '/competitions/4/teams/9';
    act(() => go('/competitions/4/teams/9'));
    expect(frames()).toHaveLength(1);
    view.unmount();
    expect(frames()).toHaveLength(0);
  });

  it('does not break on a replace', () => {
    mount('/competitions/4/chat');
    act(() => go('/competitions/4/teams/9', true));
    expect(frames()).toHaveLength(2);
  });
});
