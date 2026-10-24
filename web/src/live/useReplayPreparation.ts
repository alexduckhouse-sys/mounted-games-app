import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReplayEncodingOptions } from './replayEncoding';
import type { SavedReplayClip } from './replayBuffer';

export function useReplayPreparation() {
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.abort(); };
  }, []);
  const prepare = useCallback(async (
    task: (options: ReplayEncodingOptions) => Promise<SavedReplayClip | null>,
    done: (clip: SavedReplayClip) => void,
  ) => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setProgress(0); setError('');
    try {
      const clip = await task({ signal: controller.signal, onProgress: (fraction) => { if (mounted.current && !controller.signal.aborted) setProgress(fraction); } });
      if (mounted.current && !controller.signal.aborted) {
        if (clip) done(clip); else setError('No replay video is available yet. Try again after a few seconds.');
      }
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not prepare the replay. Try again.');
    } finally {
      if (active.current === controller) active.current = null;
      if (mounted.current) setProgress(null);
    }
  }, []);
  return { prepare, progress, error, cancel: () => active.current?.abort() };
}
