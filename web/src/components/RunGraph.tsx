import { layoutRunGraph, shortLabel, type GraphLayout } from '../lib/runGraph';

/** The drawing is never wider than this, so a phone shows it whole; more runs than fit get slimmer bars. */
const FIT = 360;
/** With `fill`, the widest a bar gets, so two runs read as bars rather than blocks. */
const FILL_BAR = 56;
/** With `compact`, the plot and the foot (room for one label line) are shorter than the usual 150 and 40. */
const COMPACT = { plot: 120, foot: 28 };

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
  /** What `showValues` prints over the bar instead of `top` (the points, already formatted). Defaults to `value`. */
  valueText?: string;
}

/**
 * A bar graph with a bar for each run: navy bars, the place over each, the heat (or event and month) under it, the
 * points scale up the side, and a dashed amber line behind the bars at the average. Everything it shows is also written
 * out (place, label, scale, and a list for screen readers), so nothing depends on colour. Drawn as plain inline SVG that
 * fits the width: with many runs the bars get slimmer, and the place and label are left off a bar too narrow to carry
 * them (the list for screen readers and each bar's tip still say everything).
 *
 * Options, all off by default so the usual graph is unchanged: `hideAxisLabels` leaves the numbers off the scale
 * (the gridlines stay, and the drawing loses the margin they sat in), `showValues` prints each bar's points over it
 * in place of its `top` text, `hideAverageLine` leaves the dashed line off and writes the average as plain grey text,
 * and `compact` draws it shorter, for a label of one line under each bar.
 */
export function RunGraph({ runs, average, ariaLabel, averageNote, hideAxisLabels = false, showValues = false, fill = false, hideAverageLine = false, compact = false }: {
  runs: readonly GraphRun[];
  average: number | null;
  ariaLabel: string;
  averageNote: string;
  hideAxisLabels?: boolean;
  showValues?: boolean;
  /** Spread the runs across the whole width (bars up to 56 wide) instead of the usual 52-unit slots from the left. */
  fill?: boolean;
  hideAverageLine?: boolean;
  compact?: boolean;
}) {
  const fitted = layoutRunGraph(runs.map((run) => run.value), average, FIT, compact ? COMPACT : undefined);
  const layout = fill && runs.length > 0 ? spreadAcross(fitted, runs.length) : fitted;
  const showTop = layout.slot >= (showValues ? 24 : 22);
  // Without axis numbers the left margin is empty, so the drawing starts just short of the first bar.
  const originX = hideAxisLabels ? layout.left - 8 : 0;
  const viewWidth = layout.width - originX;
  const labelLimit = Math.min(9, Math.floor(layout.slot / 6));
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div data-no-swipe="">
        <svg
          role="img"
          aria-label={ariaLabel}
          viewBox={`${originX} 0 ${viewWidth} ${layout.height}`}
          width="100%"
          style={{ display: 'block', maxWidth: viewWidth * 1.4 }}
        >
          {layout.scale.ticks.map((tick, index) => (
            <g key={tick}>
              <line x1={layout.left} x2={layout.width - 4} y1={layout.tickYs[index]} y2={layout.tickYs[index]} style={{ stroke: 'rgb(var(--mg-rule-soft))' }} strokeWidth="1" />
              {!hideAxisLabels && <text x={layout.left - 6} y={layout.tickYs[index] + 4} textAnchor="end" fontSize="12" style={{ fill: 'rgb(var(--mg-muted))' }}>{tick}</text>}
            </g>
          ))}
          {layout.averageY != null && !hideAverageLine && (
            <line data-testid="run-average" x1={layout.left} x2={layout.width - 4} y1={layout.averageY} y2={layout.averageY} strokeWidth="2" strokeDasharray="6 4" style={{ stroke: 'rgb(var(--mg-late-time))' }} />
          )}
          {runs.map((run, index) => {
            const bar = layout.bars[index];
            return (
              <g key={run.id}>
                <title>{run.description}</title>
                <rect x={bar.x} y={bar.y} width={bar.width} height={Math.max(bar.height, 2)} rx="5" style={{ fill: 'rgb(var(--mg-heading))' }} />
                {showTop && <text x={bar.centre} y={bar.y - 6} textAnchor="middle" fontSize={showValues ? 15 : 13} fontWeight="700" style={{ fill: 'rgb(var(--mg-ink))', paintOrder: 'stroke', stroke: 'rgb(var(--mg-surface))', strokeWidth: 3 }}>{showValues ? run.valueText ?? run.value : run.top}</text>}
                {labelLimit >= 3 && run.label.slice(0, 2).map((line, row) => (
                  <text key={row} x={bar.centre} y={layout.bottom + 16 + row * 14} textAnchor="middle" fontSize="12" style={{ fill: 'rgb(var(--mg-muted))' }}>{shortLabel(line, labelLimit)}</text>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
      {average != null && (
        <figcaption className={`m-0 flex items-center gap-2 text-[14px] ${hideAverageLine ? 'text-[rgb(var(--mg-muted))]' : 'font-medium text-[rgb(var(--mg-late-time))]'}`}>
          {!hideAverageLine && <svg aria-hidden="true" width="22" height="4" viewBox="0 0 22 4"><line x1="0" x2="22" y1="2" y2="2" strokeWidth="2" strokeDasharray="6 4" style={{ stroke: 'currentColor' }} /></svg>}
          {averageNote}
        </figcaption>
      )}
      <ul className="sr-only">{runs.map((run) => <li key={run.id}>{run.description}</li>)}</ul>
    </figure>
  );
}

/**
 * The same graph with the runs sharing the full `FIT` width: equal slots, each bar centred in its slot and between 3 and
 * `FILL_BAR` wide. Only the horizontal positions change; heights, scale and average stay as laid out.
 */
function spreadAcross(layout: GraphLayout, count: number): GraphLayout {
  const right = layout.width - layout.left - count * layout.slot;
  const slot = (FIT - layout.left - right) / count;
  const width = Math.min(FILL_BAR, Math.max(3, slot * 0.6));
  const bars = layout.bars.map((bar, index) => {
    const x = layout.left + index * slot + (slot - width) / 2;
    return { ...bar, x, width, centre: x + width / 2 };
  });
  return { ...layout, width: FIT, slot, bars };
}
