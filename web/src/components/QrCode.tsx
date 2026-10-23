import { useMemo } from 'react';
import { QR_QUIET_ZONE, qrShape } from '../lib/qr';

/**
 * A QR code drawn as inline SVG. It is always black on white with a white margin, whatever the theme,
 * because scanners need that contrast. The size follows the box it sits in: give it a width.
 */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const shape = useMemo(() => qrShape(value), [value]);
  if (!shape) return null;
  const total = shape.size + QR_QUIET_ZONE * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-QR_QUIET_ZONE} ${-QR_QUIET_ZONE} ${total} ${total}`}
      shapeRendering="crispEdges"
      className={className}
      style={{ display: 'block', aspectRatio: '1 / 1', background: '#fff' }}
    >
      <rect x={-QR_QUIET_ZONE} y={-QR_QUIET_ZONE} width={total} height={total} fill="#fff" />
      <path d={shape.path} fill="#000" />
    </svg>
  );
}
