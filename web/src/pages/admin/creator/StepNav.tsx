import { Check } from 'lucide-react';
import { STEP_IDS, STEP_LABEL } from '../../../lib/creatorDraft';

/**
 * The steps of the creator. On a phone it is a row of dots under "Step 3 of 7"; on a laptop it is a list down the
 * side. Steps beyond `reached` can't be opened yet (when editing, every step can).
 */
export function StepNav({ current, reached, onGo }: { current: number; reached: number; onGo: (step: number) => void }) {
  return (
    <nav aria-label="Steps" className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start">
      <p className="text-sm font-semibold text-[rgb(var(--mg-muted))] lg:hidden">
        Step {current + 1} of {STEP_IDS.length}<span aria-hidden="true"> · </span><span className="text-[rgb(var(--mg-heading))]">{STEP_LABEL[STEP_IDS[current]]}</span>
      </p>
      <ol className="m-0 flex list-none items-center gap-2 p-0 lg:flex-col lg:items-stretch lg:gap-1">
        {STEP_IDS.map((id, i) => {
          const done = i < current;
          const now = i === current;
          const open = i <= reached;
          return (
            <li key={id} className="flex lg:block">
              <button type="button" disabled={!open} aria-current={now ? 'step' : undefined} aria-label={`${STEP_LABEL[id]}${done ? ', done' : ''}`} onClick={() => onGo(i)}
                className={`flex min-h-11 items-center gap-2.5 rounded-xl border-[1.5px] px-1.5 py-1 text-left disabled:opacity-50 lg:w-full lg:px-3 ${now ? 'border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-surface))]' : 'border-transparent'}`}>
                <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${done ? 'bg-[rgb(var(--mg-ok))] text-white' : now ? 'bg-[rgb(var(--mg-heading))] text-white' : 'border-2 border-[rgb(var(--mg-control))] text-[rgb(var(--mg-muted))]'}`}>
                  {done ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
                </span>
                <span aria-hidden="true" className={`hidden text-sm lg:inline ${now ? 'font-bold text-[rgb(var(--mg-heading))]' : 'font-semibold text-[rgb(var(--mg-body))]'}`}>{STEP_LABEL[id]}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
