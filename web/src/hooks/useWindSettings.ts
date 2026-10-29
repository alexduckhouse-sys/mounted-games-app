import { useEffect, useState } from 'react';
import { api } from '../api';
import { isLiteModeActive } from '../lite/liteMode';
import type { WindSelection } from '../components/WindReviewSheet';
import type { WindSnooze } from '../lib/windForecast';

export function useWindSettings(id: number, enabled: boolean) {
  const [state, setState] = useState<{ id: number; selections: WindSelection[]; acknowledgements: WindSnooze[] } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    async function load() { try { const { data } = await api.get(`/competitions/${id}/wind-review/rules`);
      if (!stopped && Array.isArray(data.selections)) setState({ id, selections: data.selections, acknowledgements: Array.isArray(data.acknowledgements) ? data.acknowledgements : [] });
    } catch { /* The default awareness prompts remain available. */ } }
    void load();
    const timer = setInterval(() => void load(), (isLiteModeActive() ? 20 : 10) * 60_000);
    window.addEventListener('mg:wind-review', load);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('mg:wind-review', load); };
  }, [id, enabled]);
  return enabled && state?.id === id ? state : null;
}
