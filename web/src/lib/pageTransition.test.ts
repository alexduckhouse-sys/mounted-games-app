import { describe, expect, it } from 'vitest';
import { FADE_MS, PUSH_EASING, PUSH_MS, routeDepth, transitionFor, transitionPlan } from './pageTransition';

describe('routeDepth', () => {
  it('puts the global tab pages at 0, competition tabs at 1 and what they open deeper', () => {
    expect(routeDepth('/')).toBe(0);
    expect(routeDepth('/events')).toBe(0);
    expect(routeDepth('/competitions/past/')).toBe(0);
    expect(routeDepth('/me/orders')).toBe(0);
    expect(routeDepth('/competitions/4')).toBe(1);
    expect(routeDepth('/competitions/4/')).toBe(1);
    expect(routeDepth('/competitions/4/teams')).toBe(1);
    expect(routeDepth('/competitions/4/enter/details')).toBe(1);
    expect(routeDepth('/competitions/4/arena')).toBe(1);
    expect(routeDepth('/competitions/4/timetable')).toBe(1);
    expect(routeDepth('/competitions/4/rules')).toBe(2);
    expect(routeDepth('/competitions/4/teams/9')).toBe(3);
    expect(routeDepth('/competitions/4/session/12')).toBe(3);
  });

  it('counts the segments of other pages', () => {
    expect(routeDepth('/settings')).toBe(1);
    expect(routeDepth('/seasons/3')).toBe(2);
    expect(routeDepth('/a/b/c/d')).toBe(3);
  });
});

describe('transitionFor', () => {
  it('does nothing when only the query changed', () => {
    expect(transitionFor('/competitions/4', '/competitions/4', false)).toBeNull();
  });

  it('pushes going deeper and goes back going shallower', () => {
    expect(transitionFor('/competitions/4/teams', '/competitions/4/teams/9', false)).toBe('push');
    expect(transitionFor('/events', '/competitions/4', false)).toBe('push');
    expect(transitionFor('/competitions/4/teams/9', '/competitions/4/teams', false)).toBe('back');
    expect(transitionFor('/competitions/4/teams/9', '/competitions/4/teams', true)).toBe('back');
  });

  it('treats a browser back onto a deeper page as back', () => {
    expect(transitionFor('/events', '/competitions/4/teams/9', true)).toBe('back');
  });

  it('crossfades between pages at the same level, popped or not', () => {
    expect(transitionFor('/competitions/4', '/competitions/4/chat', false)).toBe('fade');
    expect(transitionFor('/competitions/4/chat', '/competitions/4', true)).toBe('fade');
    expect(transitionFor('/competitions/4/teams', '/competitions/4/arena', false)).toBe('fade');
    expect(transitionFor('/competitions/4/session/1', '/competitions/4/session/2', false)).toBe('fade');
  });
});

describe('transitionPlan', () => {
  it('slides the new page over the old one, which drifts left and dims', () => {
    const plan = transitionPlan('push');
    expect(plan).toMatchObject({ top: 'incoming', duration: PUSH_MS, easing: PUSH_EASING });
    expect(plan.incoming[0]).toMatchObject({ transform: 'translateX(100%)' });
    expect(plan.outgoing[1]).toMatchObject({ transform: 'translateX(-30%)', filter: 'brightness(.9)' });
  });

  it('reverses it going back, with the leaving page on top', () => {
    const plan = transitionPlan('back');
    expect(plan.top).toBe('outgoing');
    expect(plan.outgoing[1]).toMatchObject({ transform: 'translateX(100%)' });
    expect(plan.incoming[0]).toMatchObject({ transform: 'translateX(-30%)', filter: 'brightness(.9)' });
  });

  it('crossfades in 160ms', () => {
    expect(transitionPlan('fade')).toMatchObject({ duration: FADE_MS, easing: 'ease-out', top: 'outgoing' });
  });
});
