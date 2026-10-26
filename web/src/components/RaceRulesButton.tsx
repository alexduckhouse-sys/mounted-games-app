import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { equipmentFromDiagram } from '../lib/raceEquipment';
import { loadRaceTemplates, raceNameKey } from '../lib/raceTemplates';
import type { RaceTemplate } from '../types';
import { Notice } from './Notice';
import { RaceDiagram } from './RaceDiagram';
import './race-rules.css';

type Result = { key: string; template: RaceTemplate | null } | { key: string; failed: true };

/** Quote the stored race guidance; generic advice can contradict a game's rules. */
function ruleHighlights(template: RaceTemplate): string[] {
  const sentences = (template.rules ?? '').split(/(?<=[.!?])\s+|\n+/).map((text) => text.trim()).filter(Boolean);
  const winning = sentences.find((text) => /\bwinning\b|\bwins?\b/i.test(text));
  const corrections = sentences.filter((text) => /eliminat|knock|drop|miss|must|return|correct|penalt/i.test(text) && text !== winning);
  const candidates = [template.summary?.trim(), winning, ...corrections, ...sentences];
  return [...new Set(candidates.filter((text): text is string => !!text))].slice(0, 3);
}

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
  const highlights = template ? ruleHighlights(template) : [];
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
          </div>
          {!current && <Notice tone="info">Loading rules…</Notice>}
          {current && 'failed' in current && <Notice actionLabel="Try again" onAction={() => setAttempt(attempt + 1)}>Couldn’t load the rules. Check your signal and try again.</Notice>}
          {current && 'template' in current && !template && <Notice tone="info" role={null}>No rules have been added for this race yet.</Notice>}
          {template && <div className="race-rules-body">
            {template.summary && <p>{template.summary}</p>}
            {template.diagramJson && <div className="race-rules-diagram"><RaceDiagram drop diagramJson={template.diagramJson} height={160} /></div>}
            {template.rules && <section aria-label="Rules"><h3>Rules</h3><p className="whitespace-pre-wrap">{template.rules}</p></section>}
            {equipment.length > 0 && <section aria-label="Equipment"><h3>Equipment</h3>
              <ul>{equipment.map((item) => <li key={item.label}>{item.count > 1 ? `${item.count} × ` : ''}{item.label}</li>)}</ul>
            </section>}
            {highlights.length > 0 && (
              <section aria-label="How to win & common eliminations">
                <h3>How to win &amp; common eliminations</h3>
                <ul>
                  {highlights.map((text) => <li key={text}>{text}</li>)}
                </ul>
              </section>
            )}
            {!template.summary && !template.rules && equipment.length === 0 && <Notice tone="info" role={null}>No rules have been added for this race yet.</Notice>}
          </div>}
          <div className="kit-acts race-rules-acts"><button type="button" className="kit-pill kit-pill-fill" aria-label="Close rules" onClick={close}>Close</button></div>
        </div>
      </div>,
      document.body,
    )}
  </>;
}
