import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info, X } from 'lucide-react';
import { equipmentFromDiagram } from '../lib/raceEquipment';
import { loadRaceTemplates, raceNameKey } from '../lib/raceTemplates';
import type { RaceTemplate } from '../types';
import { RaceDiagram } from './RaceDiagram';
import './race-rules.css';

type Result = { key: string; template: RaceTemplate | null } | { key: string; failed: true };

/** An info button that opens a sheet with a race's rules and equipment. */
export function RaceRulesButton({ raceName, className = '', label }: { raceName: string; className?: string; label?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${raceNameKey(raceName)}|${attempt}`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  function close() {
    setOpen(false);
    window.setTimeout(() => buttonRef.current?.focus(), 0);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadRaceTemplates().then((list) => {
      if (!cancelled) setResult({ key, template: list.find((t) => raceNameKey(t.name) === raceNameKey(raceName)) ?? null });
    }).catch(() => { if (!cancelled) setResult({ key, failed: true }); });
    return () => { cancelled = true; };
  }, [open, raceName, key]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sheetRef.current?.querySelector<HTMLElement>('button')?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(sheetRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const current = result?.key === key ? result : null;
  const template = current && 'template' in current ? current.template : null;
  const equipment = template ? equipmentFromDiagram(template.diagramJson) : [];

  return <>
    <button ref={buttonRef} type="button" className={`race-rules-btn ${className}`} aria-label={`Rules for ${raceName}`} aria-haspopup="dialog" aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpen(true); }}>
      {label ?? <Info aria-hidden="true" className="h-4 w-4" />}
    </button>
    {open && createPortal(
      <div className="race-rules-overlay" onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
        <div ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="race-rules-sheet">
          <span className="race-rules-handle" aria-hidden="true" />
          <div className="race-rules-head">
            <h2 id={titleId}>{raceName}</h2>
            <button type="button" className="mg-icon-btn" aria-label="Close rules" onClick={close}><X aria-hidden="true" className="h-5 w-5" /></button>
          </div>
          {!current && <p role="status" className="mg-meta">Loading rules…</p>}
          {current && 'failed' in current && <p role="alert">Couldn’t load the rules. <button type="button" className="mg-text-link" onClick={() => setAttempt(attempt + 1)}>Try again</button></p>}
          {current && 'template' in current && !template && <p>No rules have been added for this race yet.</p>}
          {template && <div className="race-rules-body">
            {template.summary && <p>{template.summary}</p>}
            {template.diagramJson && <div className="race-rules-diagram"><RaceDiagram diagramJson={template.diagramJson} height={160} /></div>}
            {template.rules && <section aria-label="Rules"><h3>Rules</h3><p className="whitespace-pre-wrap">{template.rules}</p></section>}
            {equipment.length > 0 && <section aria-label="Equipment"><h3>Equipment</h3>
              <ul>{equipment.map((item) => <li key={item.label}>{item.count > 1 ? `${item.count} × ` : ''}{item.label}</li>)}</ul>
            </section>}
            {(template.summary || template.rules || equipment.length > 0) && (
              <section aria-label="How to win & common eliminations">
                <h3>How to win &amp; common eliminations</h3>
                <ul>
                  <li>First rider/team across the finish line with all lane equipment upright wins.</li>
                  <li>Handovers and dismounts must happen behind the start/finish or changeover line.</li>
                  <li>Common eliminations: knocked pole or equipment left down, missed changeover, or crossing outside the lane markers.</li>
                </ul>
              </section>
            )}
            {!template.summary && !template.rules && equipment.length === 0 && <p>No rules have been added for this race yet.</p>}
          </div>}
        </div>
      </div>,
      document.body,
    )}
  </>;
}
