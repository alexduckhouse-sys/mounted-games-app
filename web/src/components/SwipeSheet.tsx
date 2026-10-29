import { useCallback, type HTMLAttributes, type Ref } from 'react';
import { useSwipeToClose } from '../hooks/useSwipeToClose';

/**
 * A plain `div` that can be swiped down to close, for bottom sheets that are not built on `Sheet`. The sheet follows
 * the finger, closes past a quarter of its height (or on a quick flick) and eases back otherwise. Mount it only
 * while the sheet is open, so each opening starts fresh. It doesn't animate the leave itself: have the parent play
 * it (`useExitDelay`) and pass that `close` as `onClose`.
 */
export function SwipeSheet({ onClose, ref, style, children, ...rest }: HTMLAttributes<HTMLDivElement> & { onClose: () => void; ref?: Ref<HTMLDivElement> }) {
  const swipe = useSwipeToClose<HTMLDivElement>(onClose);
  const { ref: swipeRef } = swipe;
  const setRef = useCallback((node: HTMLDivElement | null) => {
    swipeRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref, swipeRef]);
  return (
    <div ref={setRef} {...rest} {...swipe.handlers} style={style}>
      {children}
    </div>
  );
}
