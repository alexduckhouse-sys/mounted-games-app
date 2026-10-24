import { useEffect, useRef, useState } from 'react';
import { useCurrentCompetition } from './CurrentCompetitionContext';

const SWIPE_DISMISS_PX = 48;

/** Bottom sheet asking whether to keep this competition for next time (a cookie) or just for this visit. */
export function RememberCompetitionDialog() {
  const { current, setRememberChoice } = useCurrentCompetition();
  const ref = useRef<HTMLDialogElement>(null);
  const startY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function beginDrag(y: number) {
    startY.current = y;
  }
  function moveDrag(y: number) {
    if (startY.current === null) return;
    setDragY(Math.max(0, y - startY.current));
  }
  function endDrag(y?: number) {
    if (startY.current === null) return;
    const distance = Math.max(dragY, (y ?? startY.current) - startY.current);
    startY.current = null;
    setDragY(0);
    if (distance >= SWIPE_DISMISS_PX) setRememberChoice('visit');
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="remember-competition-title"
      aria-describedby="remember-competition-detail"
      onCancel={() => setRememberChoice('visit')}
      onTouchStart={(e) => beginDrag(e.touches[0].clientY)}
      onTouchMove={(e) => moveDrag(e.touches[0].clientY)}
      onTouchEnd={(e) => endDrag(e.changedTouches[0]?.clientY)}
      onPointerDown={(e) => beginDrag(e.clientY)}
      onPointerMove={(e) => moveDrag(e.clientY)}
      onPointerUp={(e) => endDrag(e.clientY)}
      style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
      className="mg-font mx-auto mb-0 mt-auto w-full max-w-xl rounded-t-[20px] bg-[rgb(var(--mg-surface))] px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-2.5 text-[rgb(var(--mg-ink))] shadow-xl backdrop:bg-[rgb(var(--mg-overlay)/0.45)]"
    >
      <div className="flex flex-col gap-4">
        <span aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-[rgb(var(--mg-control))]" />
        <div className="flex items-center gap-3">
          <h2 id="remember-competition-title" className="mg-display text-2xl font-bold leading-tight text-[rgb(var(--mg-heading))]">Remember this competition?</h2>
        </div>
        <p id="remember-competition-detail" className="mg-meta !text-sm">We'll save a cookie on this device for six months, so {current?.name ?? 'it'} opens straight away next time. You can change this in Settings.</p>
        <div className="grid grid-cols-2 gap-2.5">
          <button className="mg-btn mg-btn-secondary !border-[rgb(var(--mg-heading))]" onClick={() => setRememberChoice('visit')}>No thanks</button>
          <button autoFocus className="mg-btn mg-btn-primary" onClick={() => setRememberChoice('remember')}>Remember</button>
        </div>
      </div>
    </dialog>
  );
}
