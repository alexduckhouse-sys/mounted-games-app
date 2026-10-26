import { Check } from 'lucide-react';
import './eventPages.css';

/**
 * The steps of entering a competition: numbered circles joined by a line. `current` is the step you are on, counted
 * from 1; pass `labels.length + 1` once everything is done, so every circle shows a tick. The line fills from step to
 * step, the current circle pops and finished steps get a tick. Both stop moving with reduced motion or lite mode.
 */
export function EntryStepper({ labels, current }: { labels: string[]; current: number }) {
  const count = labels.length;
  const progress = count > 1 ? Math.round((100 * (Math.min(current, count) - 1)) / (count - 1)) : 0;
  return (
    <ol className="ev-stepper" aria-label="Entry steps" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
      <span className="ev-line" aria-hidden="true" style={{ left: `${50 / count}%`, right: `${50 / count}%` }}>
        <span className="ev-fill" style={{ width: `${progress}%` }} />
      </span>
      {labels.map((label, index) => {
        const number = index + 1;
        const state = number < current ? 'done' : number === current ? 'cur' : 'todo';
        return (
          <li key={label} className="ev-step" data-state={state} aria-current={state === 'cur' ? 'step' : undefined}>
            <span className="ev-dot">{state === 'done' ? <Check className="h-4 w-4" strokeWidth={3} aria-label="Done" /> : number}</span>
            <span className="ev-step-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
