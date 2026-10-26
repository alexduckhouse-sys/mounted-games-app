import { useId, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useDialogFocus } from './useDialogFocus';

export interface ConfirmOptions {
  /** What is about to happen, as a short question: "Delete this competition?". */
  title: string;
  /** Exactly what will happen, and whether it can be undone. Don't repeat the title. */
  message: string;
  /** The button that does it: "Delete competition". Defaults to "Confirm". */
  confirmLabel?: string;
  /** The way out. Defaults to "Cancel" for deletes and "Not now" for go-aheads; name the safe choice when "Cancel" would be confusing ("Keep invite"). */
  cancelLabel?: string;
  /** A delete-type answer: Cancel sized to its text beside a wide, filled red button. For anything that deletes, removes or can't be undone. */
  destructive?: boolean;
  /** When set, the person must type this exactly before the confirm button works (for things like deleting a competition). */
  requireText?: string;
}

/**
 * One question, as a bottom sheet on phones and a centred card on wider screens, over a dim backdrop. A delete-type
 * answer puts Cancel (outlined, sized to its text) beside the delete (filled red, filling the row), and Cancel has
 * focus first. A go-ahead has the filled navy action first and the outlined choice beside it. Escape cancels.
 */
export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel, destructive = false, requireText, onAnswer }: ConfirmOptions & { onAnswer: (confirmed: boolean) => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useDialogFocus(dialogRef, () => onAnswer(false), destructive ? '[data-confirm-cancel]' : '[data-confirm-yes]');
  const [typed, setTyped] = useState('');
  const blocked = requireText != null && typed.trim() !== requireText;
  const no = <button type="button" data-confirm-cancel className="kit-pill" onClick={() => onAnswer(false)}>{cancelLabel ?? (destructive ? 'Cancel' : 'Not now')}</button>;
  const yes = <button type="button" data-confirm-yes className={`kit-pill ${destructive ? 'kit-pill-del' : 'kit-pill-fill'}`} disabled={blocked} onClick={() => onAnswer(true)}>{confirmLabel}</button>;
  return (
    <div className="mg-confirm-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onAnswer(false); }}>
      <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} className={`mg-confirm ${destructive ? 'mg-confirm-danger' : ''}`}>
        <span aria-hidden="true" className="kit-sheet-grip" />
        <h2 id={titleId} className="mg-confirm-title">{title}</h2>
        <p id={bodyId} className="mg-confirm-body">{message}</p>
        {requireText != null && (
          <label className="mg-confirm-type">
            <span>Type <strong>{requireText}</strong> to confirm</span>
            <input value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} />
          </label>
        )}
        {destructive
          ? <div className="kit-acts-del">{no}{yes}</div>
          : <div className="kit-acts">{yes}{no}</div>}
      </div>
    </div>
  );
}

/** Opens a confirmation and resolves true if the person confirms, false if they cancel, press Escape or tap outside. */
// The imperative opener lives beside the component it renders.
// eslint-disable-next-line react-refresh/only-export-components
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const answer = (confirmed: boolean) => {
      resolve(confirmed);
      // Not inside the click that got us here: React will not unmount a root while it is handling that root's event.
      queueMicrotask(() => { root.unmount(); host.remove(); });
    };
    root.render(<ConfirmDialog {...options} onAnswer={answer} />);
  });
}

/** `const confirm = useConfirm(); if (!(await confirm({ title, message, destructive: true }))) return;` */
// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm(): typeof confirmDialog {
  return confirmDialog;
}
