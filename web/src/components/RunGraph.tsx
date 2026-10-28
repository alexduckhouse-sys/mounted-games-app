import { layoutRunGraph, shortLabel } from '../lib/runGraph';

/** One bar: how the run went. `top` is the place over the bar; `label` is the one or two short lines under it. */
export interface GraphRun {
  id: string | number;
  value: number;
  /** "1st", "E": printed over the bar so the result reads without colour. */
  top: string;
  /** Up to two short lines under the bar ("Heat 2", or "Nat" and "Aug"). */
  label: readonly string[];
  /** The whole run in words, for screen readers and the hover tip: "Heat 2, 3rd, 4 points". */
  description: string;
}

/**
 * A bar graph with a bar for each run: navy bars, the place over each, the heat (or event and month) under it, the
 * points scale up the side, and a dashed amber line behind the bars at the average. Everything it shows is also written
 * out (place, label, scale, and a list for screen readers), so nothing depends on colour. Drawn as plain inline SVG; with
 * more runs than fit a phone it scrolls sideways instead of squeezing the bars.
 */
export function RunGraph({ runs, average, ariaLabel, averageNote }: { runs: readonly GraphRun[]; average: number | null; ariaLabel: string; averageNote: string }) {
  const layout = layoutRunGraph(runs.map((run) => run.value), average);
  const scrolls = runs.length > 7;
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className={scrolls ? 'overflow-x-auto' : undefined} data-no-swipe="">
        <svg
          role="img"
          aria-label={ariaLabel}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={scrolls ? layout.width : '100%'}
          height={scrolls ? layout.height : undefined}
          style={{ display: 'block', maxWidth: scrolls ? 'none' : layout.width * 1.4 }}
        >
          {layout.scale.ticks.map((tick, index) => (
            <g key={tick}>
              <line x1={layout.left} x2={layout.width - 4} y1={layout.tickYs[index]} y2={layout.tickYs[index]} style={{ stroke: 'rgb(var(--mg-rule-soft))' }} strokeWidth="1" />
              <text x={layout.left - 6} y={layout.tickYs[index] + 4} textAnchor="end" fontSize="12" style={{ fill: 'rgb(var(--mg-muted))' }}>{tick}</text>
            </g>
          ))}
          {layout.averageY != null && (
            <line data-testid="run-average" x1={layout.left} x2={layout.width - 4} y1={layout.averageY} y2={layout.averageY} strokeWidth="2" strokeDasharray="6 4" style={{ stroke: 'rgb(var(--mg-late-time))' }} />
          )}
          {runs.map((run, index) => {
            const bar = layout.bars[index];
            return (
              <g key={run.id}>
                <title>{run.description}</title>
                <rect x={bar.x} y={bar.y} width={bar.width} height={Math.max(bar.height, 2)} rx="5" style={{ fill: 'rgb(var(--mg-heading))' }} />
                <text x={bar.centre} y={bar.y - 6} textAnchor="middle" fontSize="13" fontWeight="700" style={{ fill: 'rgb(var(--mg-ink))', paintOrder: 'stroke', stroke: 'rgb(var(--mg-surface))', strokeWidth: 3 }}>{run.top}</text>
                {run.label.slice(0, 2).map((line, row) => (
                  <text key={row} x={bar.centre} y={layout.bottom + 16 + row * 14} textAnchor="middle" fontSize="12" style={{ fill: 'rgb(var(--mg-muted))' }}>{shortLabel(line)}</text>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
      {average != null && (
        <figcaption className="m-0 flex items-center gap-2 text-[14px] font-medium text-[rgb(var(--mg-late-time))]">
          <svg aria-hidden="true" width="22" height="4" viewBox="0 0 22 4"><line x1="0" x2="22" y1="2" y2="2" strokeWidth="2" strokeDasharray="6 4" style={{ stroke: 'currentColor' }} /></svg>
          {averageNote}
        </figcaption>
      )}
      <ul className="sr-only">{runs.map((run) => <li key={run.id}>{run.description}</li>)}</ul>
    </figure>
  );
}
