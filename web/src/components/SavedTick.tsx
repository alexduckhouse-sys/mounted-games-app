import { useCallback, type ReactNode } from 'react';
import { useToast } from './Toast';

/**
 * Says "<label> saved" in the toast (see Toast.tsx) for forms that save as you go and for a scored race. Taps go
 * straight through, so a scorer can carry on with the next race underneath. Render `node` once.
 */
export function useSavedToast(): { show: (label: string) => void; node: ReactNode } {
  const toast = useToast();
  const toastShow = toast.show;
  const show = useCallback((label: string) => toastShow(`${label} saved`), [toastShow]);
  return { show, node: toast.node };
}
