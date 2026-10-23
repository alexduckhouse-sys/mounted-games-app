import { useEffect, useRef, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Field } from '../../auth/Field';
import { parseDob, parseHeight, type DecRider } from '../../../lib/decForm';
import type { SavedRider } from '../../../types';

interface Props {
  title: string;
  /** The reserve doesn't ride, so it has no pony. */
  reserve: boolean;
  editing: boolean;
  form: DecRider;
  choices: SavedRider[];
  addLabel: string;
  ready: boolean;
  onChange: (patch: Partial<DecRider>) => void;
  onPick: (saved: SavedRider) => void;
  onCommit: () => void;
  onClose: () => void;
}

const wide = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1024px)').matches;

/**
 * The rider panel: a side panel on a laptop and a bottom sheet on a phone. It is the same markup both ways;
 * the classes decide where it sits. Pick a saved rider to fill every field, or type a new one.
 */
export function RiderPanel({ title, reserve, editing, form, choices, addLabel, ready, onChange, onPick, onCommit, onClose }: Props) {
  const nameRef = useRef<HTMLInputElement>(null);
  const slotKey = `${title}|${editing}`;
  // On a laptop the cursor goes straight to the name; on a phone that would only throw the keyboard up.
  useEffect(() => { if (wide()) nameRef.current?.focus(); }, [slotKey]);

  function keys(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  }

  const dobBad = form.dob.trim() !== '' && parseDob(form.dob) === null;
  const heightBad = form.height.trim() !== '' && parseHeight(form.height) === null;

  return (
    <>
      <button type="button" aria-hidden="true" tabIndex={-1} onClick={onClose} className="fixed inset-0 z-40 bg-[rgb(var(--mg-overlay)/0.55)] lg:hidden" />
      <section aria-label={title} onKeyDown={keys}
        className="z-50 flex flex-col gap-4 bg-[rgb(var(--mg-surface))] p-4 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[88vh] max-lg:overflow-y-auto max-lg:rounded-t-2xl max-lg:pb-[calc(20px+env(safe-area-inset-bottom))] max-lg:shadow-[0_-12px_32px_rgb(var(--mg-overlay)/0.25)] lg:sticky lg:top-6 lg:gap-[18px] lg:rounded-xl lg:border-[1.5px] lg:border-[rgb(var(--mg-heading))] lg:p-6">
        <div className="flex items-center gap-3">
          <h2 className="mg-display flex-1 text-[26px] font-bold leading-tight text-[rgb(var(--mg-heading))] lg:text-[28px]">{title}</h2>
          <button type="button" className="mg-icon-btn" aria-label="Close" onClick={onClose}><X aria-hidden="true" className="h-[18px] w-[18px]" /></button>
        </div>

        {!editing && choices.length > 0 && (
          <div className="flex flex-col gap-2">
            <span id="dec-saved-riders" className="text-sm font-semibold text-[rgb(var(--mg-body))]">Pick a saved rider</span>
            <div role="group" aria-labelledby="dec-saved-riders" className="flex flex-wrap gap-2">
              {choices.map((saved) => {
                const on = form.savedRiderId === saved.id;
                return (
                  <button key={saved.id} type="button" aria-pressed={on} onClick={() => onPick(saved)}
                    className={`min-h-11 rounded-full border-[1.5px] px-4 text-[15px] font-semibold ${on ? 'border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-button))] text-white' : 'border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))] text-[rgb(var(--mg-heading))]'}`}>
                    {saved.fullName}
                  </button>
                );
              })}
            </div>
            <div aria-hidden="true" className="mt-1 flex items-center gap-2.5 text-[13px] font-medium text-[rgb(var(--mg-muted))]">
              <span className="h-px flex-1 bg-[rgb(var(--mg-rule))]" />or type a new one<span className="h-px flex-1 bg-[rgb(var(--mg-rule))]" />
            </div>
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-3">
          <Field label="Rider">
            {({ id }) => (
              <div className="mg-field">
                <input id={id} ref={nameRef} value={form.fullName} placeholder="Full name" autoComplete="off"
                  onChange={(e) => onChange({ fullName: e.target.value, savedRiderId: null })} />
              </div>
            )}
          </Field>
          <Field label="Date of birth">
            {({ id }) => (
              <div className="mg-field" data-invalid={dobBad}>
                <input id={id} value={form.dob} placeholder="dd/mm/yyyy" inputMode="numeric" autoComplete="off" aria-invalid={dobBad}
                  onChange={(e) => onChange({ dob: e.target.value })} />
              </div>
            )}
          </Field>
          {!reserve && (
            <>
              <Field label="Pony">
                {({ id }) => (
                  <div className="mg-field">
                    <input id={id} value={form.pony} placeholder="Pony's name" autoComplete="off" onChange={(e) => onChange({ pony: e.target.value })} />
                  </div>
                )}
              </Field>
              <Field label="Height (hh)">
                {({ id }) => (
                  <div className="mg-field" data-invalid={heightBad}>
                    <input id={id} value={form.height} placeholder="13.2" inputMode="decimal" autoComplete="off" aria-invalid={heightBad}
                      onChange={(e) => onChange({ height: e.target.value })} />
                  </div>
                )}
              </Field>
            </>
          )}
        </div>

        <button type="button" className="mg-btn mg-btn-primary w-full" disabled={!ready} onClick={onCommit}>{addLabel}</button>
      </section>
    </>
  );
}
