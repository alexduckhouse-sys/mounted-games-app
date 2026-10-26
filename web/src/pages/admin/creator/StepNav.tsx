import { useEffect, useRef, useState } from 'react';
import { Check, Menu, X } from 'lucide-react';
import { STEP_LABEL, type StepId } from '../../../lib/creatorDraft';

/** One entry in the step list: a number or a green tick, and its name. */
function StepButton({ id, index, current, done, open, onGo }: { id: StepId; index: number; current: boolean; done: boolean; open: boolean; onGo: () => void }) {
  return (
    <button type="button" className="cw-step" disabled={!open} aria-current={current ? 'step' : undefined} data-done={done} onClick={onGo}>
      <span className="cw-badge" aria-hidden="true">{done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : index + 1}</span>
      <span>{STEP_LABEL[id]}<span className="sr-only">{done ? ', done' : ''}</span></span>
    </button>
  );
}

/**
 * The steps of the creator, then Timetable. On a laptop they run down the side: done steps ticked green, the current one navy.
 * On a phone the same list opens from a Steps button. Steps beyond `reached` can't be opened yet (when editing, every step can).
 */
export function StepNav({ steps, current, reached, locked = false, onGo, timetable, onTimetable, title }: {
  steps: readonly StepId[];
  /** Position in `steps`; -1 when on the page after the competition is made. */
  current: number;
  reached: number;
  /** The competition has been made: the steps are shown as done but can't be opened. */
  locked?: boolean;
  onGo: (step: StepId) => void;
  /** Show Timetable as the last entry: available once the competition has been created. */
  timetable: { available: boolean; current: boolean } | null;
  onTimetable: () => void;
  title: string;
}) {
  const [drawer, setDrawer] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!drawer) return;
    closeRef.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [drawer]);

  const list = (afterGo?: () => void) => (
    <>
      {steps.map((id, i) => (
        <StepButton key={id} id={id} index={i} current={i === current} done={i <= reached && i !== current} open={!locked && i <= reached}
          onGo={() => { onGo(id); afterGo?.(); }} />
      ))}
      {timetable && (
        <button type="button" className="cw-step" disabled={!timetable.available} aria-current={timetable.current ? 'step' : undefined} data-done={false}
          onClick={() => { onTimetable(); afterGo?.(); }}>
          <span className="cw-badge" aria-hidden="true">{steps.length + 1}</span><span>Timetable</span>
        </button>
      )}
    </>
  );

  return (
    <div className="cw-navcell">
      <button type="button" className="cw-steps-btn" aria-haspopup="dialog" aria-expanded={drawer} onClick={() => setDrawer(true)}>
        <Menu className="h-[18px] w-[18px]" aria-hidden="true" />Steps
      </button>
      <nav aria-label="Steps" className="cw-nav">{list()}</nav>
      {drawer && (
        <div className="cw-drawer" role="dialog" aria-label="Steps">
          <nav aria-label="Steps, menu">
            <div className="cw-drawer-head"><span>{title}</span>
              <button ref={closeRef} type="button" aria-label="Close" onClick={() => setDrawer(false)}><X className="h-[18px] w-[18px]" aria-hidden="true" /></button>
            </div>
            {list(() => setDrawer(false))}
          </nav>
          <button type="button" className="cw-scrim" aria-label="Close" onClick={() => setDrawer(false)} />
        </div>
      )}
    </div>
  );
}
