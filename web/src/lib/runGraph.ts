/** A round number to draw the top of a graph at, and the gridlines up to it. */
export interface GraphScale { max: number; ticks: number[] }

const STEPS = [1, 2, 3, 4, 5, 10, 15, 20, 25, 50, 100, 200, 500, 1000];

/**
 * A scale for bars worth up to `highest`: the top is the next multiple of a tidy step (1, 2, 3, 4, 5, 10...) that
 * fits, with at most four gaps between gridlines, always starting at 0. Nothing scored still gets a 0 to 1 scale.
 */
export function graphScale(highest: number): GraphScale {
  const top = Number.isFinite(highest) && highest > 0 ? highest : 1;
  const step = STEPS.find((candidate) => Math.ceil(top / candidate) <= 4) ?? STEPS[STEPS.length - 1];
  const max = Math.max(step, Math.ceil(top / step) * step);
  const ticks: number[] = [];
  for (let value = 0; value <= max; value += step) ticks.push(value);
  return { max, ticks };
}

export interface GraphBar { x: number; y: number; width: number; height: number; centre: number }

export interface GraphLayout {
  width: number;
  height: number;
  /** Left edge of the plot, where the axis numbers sit to its left. */
  left: number;
  /** Top and bottom of the plot (y of the `max` and 0 lines). */
  top: number;
  bottom: number;
  scale: GraphScale;
  bars: GraphBar[];
  /** y of the dashed average line, or null with no average. */
  averageY: number | null;
  /** y of each gridline, in the order of `scale.ticks`. */
  tickYs: number[];
  /** Width given to each run, narrower than the usual slot when the bars were fitted into a set width. */
  slot: number;
}

export const SLOT = 52;
const BAR = 38;
const LEFT = 30;
const RIGHT = 8;
const TOP = 22;
const PLOT = 150;
const FOOT = 40;

/**
 * Where everything goes in a bar graph of one value per run, in a drawing `LEFT + runs * SLOT + RIGHT` wide: a bar a
 * run, the scale up the left, and the dashed average line across. The top margin leaves room for the label over the
 * tallest bar and the foot for two short lines under each. With `fit`, a graph that would be wider than that many units
 * gets narrower slots and bars instead, so it always fits (a phone never has to scroll it sideways). `size` makes the
 * drawing shorter: the height of the plot and of the foot under it (both default to the usual graph's).
 */
export function layoutRunGraph(values: readonly number[], average: number | null, fit?: number, size?: { plot?: number; foot?: number }): GraphLayout {
  const plot = size?.plot ?? PLOT;
  const slot = fit != null && values.length > 0 ? Math.min(SLOT, (fit - LEFT - RIGHT) / values.length) : SLOT;
  const barWidth = slot >= SLOT ? BAR : Math.max(3, slot * (BAR / SLOT));
  const scale = graphScale(Math.max(0, ...values, average ?? 0));
  const bottom = TOP + plot;
  const yOf = (value: number) => bottom - (Math.max(0, value) / scale.max) * plot;
  const bars = values.map((value, index) => {
    const x = LEFT + index * slot + (slot - barWidth) / 2;
    const y = yOf(value);
    return { x, y, width: barWidth, height: bottom - y, centre: x + barWidth / 2 };
  });
  return {
    width: LEFT + values.length * slot + RIGHT,
    height: bottom + (size?.foot ?? FOOT),
    left: LEFT,
    top: TOP,
    bottom,
    scale,
    bars,
    averageY: average == null ? null : yOf(average),
    tickYs: scale.ticks.map(yOf),
    slot,
  };
}

/** A label cut to fit under a bar, with an ellipsis when it was cut. */
export function shortLabel(text: string, limit = 9): string {
  const clean = text.trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1).trimEnd()}…`;
}
