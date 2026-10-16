import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Clock } from 'lucide-react';
import type { TickerItem } from '../lib/ticker';
import { AgeGroupsProvider, useAgeGroups } from './AgeGroupsContext';
import { CompetitionMetaProvider } from './CompetitionMetaContext';
import { useCompetitionMeta, type CompetitionMeta } from './competitionMeta';
import { NavExtrasProvider, useNavExtras } from './NavExtrasContext';
import { TickerProvider, useTicker } from './TickerContext';

const silenceErrors = () => vi.spyOn(console, 'error').mockImplementation(() => {});

describe('AgeGroupsContext', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <AgeGroupsProvider>{children}</AgeGroupsProvider>;

  it('starts with no competition and no groups', () => {
    const { result } = renderHook(() => useAgeGroups(), { wrapper });
    expect(result.current).toMatchObject({ competitionId: null, groups: [] });
  });

  it('publishes the open competition’s age groups with a setter that stays the same', () => {
    const { result } = renderHook(() => useAgeGroups(), { wrapper });
    const setGroups = result.current.setGroups;
    act(() => result.current.setGroups(3, [{ id: 1, name: 'Seniors' }]));
    expect(result.current).toMatchObject({ competitionId: 3, groups: [{ id: 1, name: 'Seniors' }] });
    expect(result.current.setGroups).toBe(setGroups);
    act(() => result.current.setGroups(null, []));
    expect(result.current).toMatchObject({ competitionId: null, groups: [] });
  });

  it('must be used inside its provider', () => {
    const spy = silenceErrors();
    expect(() => renderHook(() => useAgeGroups())).toThrow('useAgeGroups must be used within AgeGroupsProvider');
    spy.mockRestore();
  });
});

describe('CompetitionMetaContext', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <CompetitionMetaProvider>{children}</CompetitionMetaProvider>;
  const meta: CompetitionMeta = { id: 4, name: 'Spring Games', startDate: '2026-06-01', live: true };

  it('holds the open competition’s header details', () => {
    const { result } = renderHook(() => useCompetitionMeta(), { wrapper });
    expect(result.current.meta).toBeNull();
    act(() => result.current.setMeta(meta));
    expect(result.current.meta).toEqual(meta);
    act(() => result.current.setMeta(null));
    expect(result.current.meta).toBeNull();
  });

  it('must be used inside its provider', () => {
    const spy = silenceErrors();
    expect(() => renderHook(() => useCompetitionMeta())).toThrow('useCompetitionMeta must be used within CompetitionMetaProvider');
    spy.mockRestore();
  });
});

describe('NavExtrasContext', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <NavExtrasProvider>{children}</NavExtrasProvider>;
  const extra = { to: '/admin/rules', label: 'Rules', icon: Clock };

  it('lets a page add menu links and take them away again', () => {
    const { result } = renderHook(() => useNavExtras(), { wrapper });
    expect(result.current.extras).toEqual([]);
    act(() => result.current.setExtras([extra]));
    expect(result.current.extras).toEqual([extra]);
    act(() => result.current.clear());
    expect(result.current.extras).toEqual([]);
  });

  it('keeps stable functions so pages can use them as effect dependencies', () => {
    const { result } = renderHook(() => useNavExtras(), { wrapper });
    const { setExtras, clear } = result.current;
    act(() => result.current.setExtras([extra]));
    expect(result.current.setExtras).toBe(setExtras);
    expect(result.current.clear).toBe(clear);
  });

  it('must be used inside its provider', () => {
    const spy = silenceErrors();
    expect(() => renderHook(() => useNavExtras())).toThrow('useNavExtras must be used inside NavExtrasProvider');
    spy.mockRestore();
  });
});

describe('TickerContext', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <TickerProvider>{children}</TickerProvider>;
  const line = (extra: Partial<TickerItem> = {}): TickerItem => ({ key: 'late', kind: 'late', text: 'Running 6 min behind', ...extra });

  it('shows what the page publishes', () => {
    const { result } = renderHook(() => useTicker(), { wrapper });
    expect(result.current.items).toEqual([]);
    act(() => result.current.setItems([line()]));
    expect(result.current.items).toEqual([line()]);
  });

  it('keeps the same list when a republish says nothing new, so the rotation is not reset', () => {
    const { result } = renderHook(() => useTicker(), { wrapper });
    act(() => result.current.setItems([line()]));
    const before = result.current.items;
    act(() => result.current.setItems([line()]));
    expect(result.current.items).toBe(before);
    act(() => result.current.setItems([line({ text: 'Running 7 min behind' })]));
    expect(result.current.items).not.toBe(before);
  });

  it('must be used inside its provider', () => {
    const spy = silenceErrors();
    expect(() => renderHook(() => useTicker())).toThrow('useTicker must be used within TickerProvider');
    spy.mockRestore();
  });
});
