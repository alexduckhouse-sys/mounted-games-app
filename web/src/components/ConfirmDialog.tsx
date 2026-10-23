import { useId, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { useDialogFocus } from './useDialogFocus';

export interface ConfirmOptions {
  /** What is about to happen, as a short question: "Delete this competition?". */
  title: string;
  /** Exactly what will happen, and whether it can be undone. */
  message: string;
  /** The button that does it: "Delete competition". Defaults to "Confirm". */
  confirmLabel?: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  /** Red header and button, for anything that deletes, removes or can't be undone. */
  destructive?: boolean;
  /** When set, the person must type this exactly before the confirm button works (for things like deleting a competition). */
  requireText?: string;
}

/** One confirmation, covering the whole screen with a blurred backdrop. Cancel has focus first; Escape cancels. */
export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive = false, requireText, onAnswer }: ConfirmOptions & { onAnswer: (confirmed: boolean) => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useDialogFocus(dialogRef, () => onAnswer(false), '[data-confirm-cancel]');
  const [typed, setTyped] = useState('');
  const blocked = requireText != null && typed.trim() !== requireText;
  const Icon = destructive ? AlertTriangle : HelpCircle;
  return (
    <div className="mg-confirm-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onAnswer(false); }}>
      <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} className={`mg-confirm ${destructive ? 'mg-confirm-danger' : ''}`}>
        <div className="mg-confirm-head">
          <Icon aria-hidden="true" className="h-6 w-6 shrink-0" />
          <h2 id={titleId}>{title}</h2>
        </div>
        <p id={bodyId} className="mg-confirm-body">{message}</p>
        {requireText != null && (
          <label className="mg-confirm-type">
            <span>Type <strong>{requireText}</strong> to confirm</span>
            <input value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} />
          </label>
        )}
        <div className="mg-confirm-actions">
          <button type="button" data-confirm-cancel className="mg-btn mg-btn-secondary" onClick={() => onAnswer(false)}>{cancelLabel}</button>
          <button type="button" className={`mg-btn ${destructive ? 'mg-btn-danger' : 'mg-btn-primary'}`} disabled={blocked} onClick={() => onAnswer(true)}>{confirmLabel}</button>
        </div>
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
