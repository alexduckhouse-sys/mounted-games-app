import { act, render } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageTransition } from './PageTransition';

let go: (to: string, replace?: boolean) => void = () => {};
let goBack: () => void = () => {};
const animations: Array<{ target: HTMLElement; keyframes: Keyframe[]; options: KeyframeAnimationOptions; finish: () => void; cancel: ReturnType<typeof vi.fn> }> = [];

function Harness({ disabled = false }: { disabled?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    go = (to, replace) => navigate(to, { replace });
    goBack = () => navigate(-1);
  }, [navigate]);
  return (
    <>
      <main ref={ref} id="main"><span id="inner">{pathname}</span><video /></main>
      <PageTransition mainRef={ref} pathname={pathname} disabled={disabled} />
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

  it('crossfades pages at the same level, with the real page fading up', () => {
    mount('/competitions/4/chat');
    act(() => go('/competitions/4'));
    expect(frames()).toHaveLength(1);
    expect(animations).toHaveLength(2);
    expect(animations[0].keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(animations[1].target.id).toBe('main');
    expect(animations[0].options.duration).toBe(160);
    expect(document.getElementById('main')!.style.visibility).toBe('');
  });

  it('leaves the fade to a page that has its own entrance', () => {
    mount('/competitions/4/chat');
    document.getElementById('main')!.classList.add('rf-page');
    act(() => go('/competitions/4'));
    expect(animations).toHaveLength(1);
  });

  it('does nothing when only the query changes', () => {
    mount('/competitions/4/chat');
    act(() => go('/competitions/4/chat?x=1'));
    expect(animations).toHaveLength(0);
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
    // The first move was ended on the spot and a new one began.
    expect(frames()).toHaveLength(1);
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

  it('does not break on a replace', () => {
    mount('/competitions/4/chat');
    act(() => go('/competitions/4/teams/9', true));
    expect(frames()).toHaveLength(2);
  });
});
