import { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import {
  clampEmbedHeight, EMBED_VIEWS, embedPath, embedSearch, embedUrl, iframeSnippet, MAX_EMBED_HEIGHT, MIN_EMBED_HEIGHT, SEASON_EMBED_HEIGHT,
  type EmbedTarget, type EmbedTheme, type EmbedView,
} from '../../lib/embed';
import { displaySectionName } from '../../lib/section';
import { RefineNote, RefineSection } from '../refine/Refine';
import { SelectField } from '../../components/SelectField';
import { NumberField } from '../../components/NumberField';

type Props =
  | { kind: 'competition'; competitionId: number; name: string; sections: { id: number; displayName: string }[] }
  | { kind: 'season'; seasonId: string; title: string };

const DEFAULT_ACCENT = '#17385f';

/**
 * "Embed on your website": the organiser picks what to show and the colours, checks the preview and copies
 * an iframe snippet. The widget pages live under /embed/ and show public data only.
 */
export function EmbedCard(props: Props) {
  const ids = useId();
  const competition = props.kind === 'competition';
  const [view, setView] = useState<EmbedView>('standings');
  const [section, setSection] = useState<number | null>(null);
  const [theme, setTheme] = useState<EmbedTheme>('light');
  const [customColour, setCustomColour] = useState(false);
  const [colour, setColour] = useState(DEFAULT_ACCENT);
  const [height, setHeight] = useState(competition ? EMBED_VIEWS[0].height : SEASON_EMBED_HEIGHT);
  const [heightEdited, setHeightEdited] = useState(false);
  const [copied, setCopied] = useState<'yes' | 'manual' | null>(null);
  const snippetRef = useRef<HTMLTextAreaElement>(null);

  const target: EmbedTarget = props.kind === 'season' ? { kind: 'season', id: props.seasonId } : { kind: 'competition', id: props.competitionId };
  const options = { accent: customColour ? colour : null, theme, section: competition ? section : null };
  const path = embedPath(target, view) + embedSearch(options);
  const label = props.kind === 'season' ? props.title : props.name;
  const viewLabel = props.kind === 'season' ? 'Season standings' : EMBED_VIEWS.find((v) => v.id === view)?.label ?? 'Results';
  // The preview waits for the choices to settle so dragging the colour picker doesn't reload it every frame.
  const [previewPath, setPreviewPath] = useState(path);
  useEffect(() => {
    const timer = setTimeout(() => setPreviewPath(path), 400);
    return () => clearTimeout(timer);
  }, [path]);
  const snippet = iframeSnippet(embedUrl(window.location.origin, target, view, options), `${label}: ${viewLabel}`, height);

  function chooseView(next: EmbedView) {
    setView(next);
    if (!heightEdited) setHeight(EMBED_VIEWS.find((v) => v.id === next)?.height ?? EMBED_VIEWS[0].height);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied('yes');
    } catch {
      snippetRef.current?.select();
      setCopied('manual');
    }
  }

  return (
    <>
      <RefineSection title="Embed on your website" />
      <div className="rf-list flex flex-col gap-3 p-3">
        <p className="m-0 text-[15px]">
          Embed {props.kind === 'season' ? 'this season’s table' : 'live results'} on your club’s website.
          It updates automatically and only shows team names, places, points and times.
        </p>

        {props.kind === 'competition' && (
          <>
            <div role="group" aria-label="What to show" className="flex flex-wrap gap-2">
              {EMBED_VIEWS.map((v) => (
                <button key={v.id} type="button" className="rf-btn" aria-pressed={view === v.id} style={view === v.id ? { background: 'rgb(var(--mg-tint))', borderColor: 'rgb(var(--mg-heading))' } : undefined} onClick={() => chooseView(v.id)}>
                  {v.label}
                </button>
              ))}
            </div>
            {props.sections.length > 1 && (
              <label className="rf-fld" htmlFor={`${ids}-section`}>
                Age group
                <SelectField id={`${ids}-section`} value={section ?? ''} onChange={(e) => setSection(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{view === 'standings' ? 'All age groups (visitors choose)' : 'All age groups'}</option>
                  {props.sections.map((s) => <option key={s.id} value={s.id}>{displaySectionName(s.displayName)}</option>)}
                </SelectField>
              </label>
            )}
          </>
        )}

        <div role="group" aria-label="Background" className="flex flex-wrap gap-2">
          {(['light', 'dark'] as const).map((t) => (
            <button key={t} type="button" className="rf-btn" aria-pressed={theme === t} style={theme === t ? { background: 'rgb(var(--mg-tint))', borderColor: 'rgb(var(--mg-heading))' } : undefined} onClick={() => setTheme(t)}>
              {t === 'light' ? 'Light background' : 'Dark background'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-h-11 items-center gap-2 text-[15px] font-semibold">
            <input type="checkbox" checked={customColour} onChange={(e) => setCustomColour(e.target.checked)} />
            Use my club’s colour
          </label>
          {customColour && (
            <label className="rf-fld" htmlFor={`${ids}-colour`}>
              Colour
              <input id={`${ids}-colour`} type="color" value={colour} onChange={(e) => setColour(e.target.value)} style={{ width: 64, padding: 2 }} />
            </label>
          )}
          <label className="rf-fld" htmlFor={`${ids}-height`} style={{ width: 120 }}>
            Height (pixels)
            <NumberField id={`${ids}-height`} min={MIN_EMBED_HEIGHT} max={MAX_EMBED_HEIGHT} step={20} value={height}
              onChange={(e) => { setHeight(Number(e.target.value)); setHeightEdited(true); }}
              onBlur={() => setHeight((h) => clampEmbedHeight(h))} />
          </label>
        </div>

        <div>
          <h3 className="m-0 mb-1 text-[13px] font-bold uppercase tracking-[0.06em] text-[rgb(var(--mg-muted))]">Preview</h3>
          <iframe
            title={`Preview of the ${viewLabel.toLowerCase()} widget`}
            src={previewPath}
            loading="lazy"
            style={{ width: '100%', maxWidth: 420, height: Math.min(clampEmbedHeight(height), 640), border: '1px solid rgb(var(--mg-rule))', borderRadius: 10, display: 'block' }}
          />
        </div>

        <div className="rf-fld">
          <label htmlFor={`${ids}-code`}>Code to paste</label>
          <textarea id={`${ids}-code`} ref={snippetRef} readOnly rows={4} value={snippet} onFocus={(e) => e.currentTarget.select()} style={{ padding: 10, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, minHeight: 96 }} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="rf-btn rf-btn-primary" onClick={copy}>
            {copied === 'yes' ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            Copy code
          </button>
          <span role="status" className="text-sm text-[rgb(var(--mg-muted))]">
            {copied === 'yes' ? 'Copied.' : copied === 'manual' ? 'Select the code above and copy it.' : ''}
          </span>
        </div>
        <RefineNote>
          Paste into an Embed or Custom HTML block on your site.
        </RefineNote>
      </div>
    </>
  );
}
