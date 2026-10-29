import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { equipmentFromDiagram } from '../lib/raceEquipment';
import { findRaceTemplate, loadRaceTemplates, raceNameKey } from '../lib/raceTemplates';
import type { RaceTemplate, SectionFormat } from '../types';
import { useExitDelay } from '../hooks/useExitDelay';
import { Notice } from './Notice';
import { useT } from '../i18n/LanguageContext';
import { RaceDiagram } from './RaceDiagram';
import { SwipeSheet } from './SwipeSheet';
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

/** An info button that opens a sheet with a race's rules and equipment, in the Pairs or Individual version when `format` says the section rides one. */
export function RaceRulesButton({ raceName, format, className = '', label }: { raceName: string; format?: SectionFormat | null; className?: string; label?: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${raceNameKey(raceName)}|${format ?? ''}|${attempt}`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // The sheet and the dim behind it leave the way Sheet's do (skin.css), then the sheet unmounts.
  const { closing, close } = useExitDelay(() => {
    setOpen(false);
    window.setTimeout(() => buttonRef.current?.focus(), 0);
  });
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadRaceTemplates().then((list) => {
      if (!cancelled) setResult({ key, template: findRaceTemplate(list, raceName, format) });
    }).catch(() => { if (!cancelled) setResult({ key, failed: true }); });
    return () => { cancelled = true; };
  }, [open, raceName, format, key]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sheetRef.current?.querySelector<HTMLElement>('button')?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
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
    <button ref={buttonRef} type="button" className={`race-rules-btn ${className}`} aria-label={t('competition.rules.for', { name: raceName })} aria-haspopup="dialog" aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpen(true); }}>
      {label ?? <Info aria-hidden="true" className="h-4 w-4" />}
    </button>
    {open && createPortal(
      <div className={`race-rules-overlay${closing ? ' is-closing' : ''}`} onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
        <SwipeSheet ref={sheetRef} onClose={close} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`race-rules-sheet${closing ? ' is-closing' : ''}`}>
          <span className="race-rules-handle" aria-hidden="true" />
          <div className="race-rules-head">
            <h2 id={titleId}>{raceName}</h2>
            {template?.format === 1 && <p className="race-rules-version">{t('competition.rules.pairsVersion')}</p>}
            {template?.format === 3 && <p className="race-rules-version">{t('competition.rules.individualVersion')}</p>}
          </div>
          {!current && <Notice tone="info">{t('competition.rules.loading')}</Notice>}
          {current && 'failed' in current && <Notice actionLabel={t('common.tryAgain')} onAction={() => setAttempt(attempt + 1)}>{t('competition.rules.failed')}</Notice>}
          {current && 'template' in current && !template && <Notice tone="info" role={null}>{t('competition.rules.none')}</Notice>}
          {template && <div className="race-rules-body">
            {template.summary && <p>{template.summary}</p>}
            {template.diagramJson && <div className="race-rules-diagram"><RaceDiagram drop diagramJson={template.diagramJson} height={160} /></div>}
            {template.rules && <section aria-label={t('competition.rules.link')}><h3>{t('competition.rules.link')}</h3><p className="whitespace-pre-wrap">{template.rules}</p></section>}
            {equipment.length > 0 && <section aria-label={t('competition.rules.equipment')}><h3>{t('competition.rules.equipment')}</h3>
              <ul>{equipment.map((item) => <li key={item.label}>{item.count > 1 ? `${item.count} × ` : ''}{item.label}</li>)}</ul>
            </section>}
            {highlights.length > 0 && (
              <section aria-label={t('competition.rules.howToWin')}>
                <h3>{t('competition.rules.howToWin')}</h3>
                <ul>
                  {highlights.map((text) => <li key={text}>{text}</li>)}
                </ul>
              </section>
            )}
            {!template.summary && !template.rules && equipment.length === 0 && <Notice tone="info" role={null}>{t('competition.rules.none')}</Notice>}
          </div>}
          <div className="kit-acts race-rules-acts"><button type="button" className="kit-pill kit-pill-fill" aria-label={t('competition.rules.close')} onClick={() => close()}>{t('common.close')}</button></div>
        </SwipeSheet>
      </div>,
      document.body,
    )}
  </>;
}
