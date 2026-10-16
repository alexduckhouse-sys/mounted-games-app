import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider, THEMES, useTheme } from './ThemeContext';

const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>;
const mount = () => renderHook(() => useTheme(), { wrapper });

describe('ThemeProvider', () => {
  it('offers the five themes', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['eguk', 'light', 'dark', 'ocean', 'sunset']);
  });

  it('defaults to EGUK Navy and applies it to the page', () => {
    const { result } = mount();
    expect(result.current.theme).toBe('eguk');
    expect(document.documentElement.dataset.theme).toBe('eguk');
    expect(localStorage.getItem('mg.theme')).toBe('eguk');
  });

  it('restores a saved theme', () => {
    localStorage.setItem('mg.theme', 'ocean');
    const { result } = mount();
    expect(result.current.theme).toBe('ocean');
    expect(document.documentElement.dataset.theme).toBe('ocean');
  });

  it.each(['', 'neon', 'DARK', 'undefined'])('falls back to the default for the unknown saved theme %j', (saved) => {
    localStorage.setItem('mg.theme', saved);
    expect(mount().result.current.theme).toBe('eguk');
  });

  it('switches theme, updating the page and what is saved', () => {
    const { result } = mount();
    act(() => result.current.setTheme('dark'));
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('mg.theme')).toBe('dark');
  });
});

describe('useTheme', () => {
  it('must be used inside the provider', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useTheme())).toThrow('useTheme must be used within ThemeProvider');
    error.mockRestore();
  });
});
