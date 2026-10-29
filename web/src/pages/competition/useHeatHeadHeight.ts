import { useLayoutEffect, useState, type RefObject } from 'react';

const MIN_HEIGHT = 82;
const ANGLE = (55 * Math.PI) / 180;
const LINE_HEIGHT = 12.5;

/** Header height for a race name `width` px long set at 55°: 3px below it (grid line and gap) and about 2.5px above. */
export function heatHeadHeightFor(width: number): number {
  return Math.max(MIN_HEIGHT, Math.ceil(3 + width * Math.sin(ANGLE) + LINE_HEIGHT * Math.cos(ANGLE) + 2.5));
}

/** Measures the widest `.heat-name` in the header so it grows to fit the longest race name instead of cutting it off. */
export function useHeatHeadHeight(headRef: RefObject<HTMLElement | null>, labelsKey: string): number {
  const [height, setHeight] = useState(MIN_HEIGHT);
  useLayoutEffect(() => {
    let live = true;
    const measure = () => {
      if (!live) return;
      let widest = 0;
      // offsetWidth ignores the rotation, so it is the name's own length.
      headRef.current?.querySelectorAll<HTMLElement>('.heat-name').forEach((name) => { widest = Math.max(widest, name.offsetWidth); });
      setHeight(heatHeadHeightFor(widest));
    };
    measure();
    // Barlow may arrive after the first paint and is wider than the fallback font.
    void document.fonts?.ready.then(measure);
    return () => { live = false; };
  }, [headRef, labelsKey]);
  return height;
}
