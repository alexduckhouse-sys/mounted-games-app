import { useCallback, useState } from 'react';
import { loadAuto, saveAuto, type AutoRuleKey, type AutoState } from '../lib/streamAuto';

/** The Auto switch and rules for one competition, kept in this browser. */
export function useStreamAuto(competitionId: number) {
  const [state, setState] = useState<AutoState>(() => loadAuto(competitionId));
  const [forId, setForId] = useState(competitionId);
  if (forId !== competitionId) { setForId(competitionId); setState(loadAuto(competitionId)); }

  const update = useCallback((change: (current: AutoState) => AutoState) => {
    setState((current) => {
      const next = change(current);
      saveAuto(competitionId, next);
      return next;
    });
  }, [competitionId]);

  const setOn = useCallback((on: boolean) => update((current) => ({ ...current, on })), [update]);
  const setRule = useCallback((key: AutoRuleKey, patch: Partial<AutoState['rules'][AutoRuleKey]>) => update((current) => ({
    ...current, rules: { ...current.rules, [key]: { ...current.rules[key], ...patch } },
  })), [update]);

  return { auto: state, setOn, setRule };
}
