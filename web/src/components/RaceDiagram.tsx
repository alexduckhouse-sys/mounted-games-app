import type { DiagramElement } from '../types';

interface Props {
  diagramJson?: string | null;
  height?: number;
  className?: string;
}

function parse(json?: string | null): DiagramElement[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter((e) => e && typeof e === 'object' && typeof e.t === 'string') as DiagramElement[];
  } catch {
    return [];
  }
}

/**
 * Renders an arena lane as SVG, with a start line on the left, finish line on the right,
 * an optional dashed midline, and elements (poles, cones, items, tables) positioned by % along the lane.
 */
export function RaceDiagram({ diagramJson, height = 140, className }: Props) {
  const elements = parse(diagramJson);
  const hasMidline = elements.some((e) => e.t === 'midline');

  // Canvas: 800 wide, padded; lane runs from x=80 to x=720, vertically centred.
  const laneLeft = 80;
  const laneRight = 720;
  const laneTop = 60;
  const laneBottom = 180;
  const centreY = (laneTop + laneBottom) / 2;
  const laneWidth = laneRight - laneLeft;

  function px(pct: number) {
    return laneLeft + (Math.max(0, Math.min(100, pct)) / 100) * laneWidth;
  }

  return (
    <svg
      viewBox="0 0 800 240"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Arena setup diagram"
      className={className}
      style={{ height: `${height}px`, width: '100%', display: 'block' }}
    >
      {/* arena ground tint */}
      <rect x="0" y="0" width="800" height="240" fill="#fef3c7" />
      <rect x={laneLeft - 10} y={laneTop - 10} width={laneWidth + 20} height={laneBottom - laneTop + 20}
            fill="#fde68a" rx="6" />

      {/* lane outline */}
      <line x1={laneLeft} y1={laneTop} x2={laneRight} y2={laneTop} stroke="#92400e" strokeWidth="1.5" />
      <line x1={laneLeft} y1={laneBottom} x2={laneRight} y2={laneBottom} stroke="#92400e" strokeWidth="1.5" />

      {/* start line (green) */}
      <line x1={laneLeft} y1={laneTop - 8} x2={laneLeft} y2={laneBottom + 8} stroke="#16a34a" strokeWidth="4" />
      <text x={laneLeft} y={laneTop - 18} textAnchor="middle" fontSize="14" fontWeight="700" fill="#15803d">START</text>

      {/* finish line (red, checkered hint) */}
      <line x1={laneRight} y1={laneTop - 8} x2={laneRight} y2={laneBottom + 8} stroke="#dc2626" strokeWidth="4" />
      <text x={laneRight} y={laneTop - 18} textAnchor="middle" fontSize="14" fontWeight="700" fill="#b91c1c">FINISH</text>

      {/* mid line */}
      {hasMidline && (
        <>
          <line x1={px(50)} y1={laneTop - 4} x2={px(50)} y2={laneBottom + 4}
                stroke="#475569" strokeWidth="1.5" strokeDasharray="6 6" />
          <text x={px(50)} y={laneBottom + 22} textAnchor="middle" fontSize="11" fill="#475569">midline</text>
        </>
      )}

      {/* elements */}
      {elements.map((el, i) => {
        if (el.t === 'midline') return null;
        const x = px(el.x);
        const y = centreY;
        switch (el.t) {
          case 'pole':
            return (
              <g key={i}>
                <circle cx={x} cy={y} r="9" fill="#dc2626" stroke="#7f1d1d" strokeWidth="1.5" />
                <line x1={x} y1={y - 18} x2={x} y2={y - 26} stroke="#7f1d1d" strokeWidth="2" />
                {el.label && <text x={x} y={y + 28} textAnchor="middle" fontSize="11" fontWeight="700" fill="#7f1d1d">{el.label}</text>}
              </g>
            );
          case 'cone':
            return (
              <g key={i}>
                <polygon points={`${x - 10},${y + 10} ${x + 10},${y + 10} ${x},${y - 12}`} fill="#f97316" stroke="#7c2d12" strokeWidth="1.5" />
                <line x1={x - 12} y1={y - 4} x2={x + 12} y2={y - 4} stroke="#fff" strokeWidth="2" />
                {el.label && <text x={x} y={y + 28} textAnchor="middle" fontSize="11" fontWeight="700" fill="#7c2d12">{el.label}</text>}
              </g>
            );
          case 'item':
            return (
              <g key={i}>
                <rect x={x - 7} y={y - 7} width="14" height="14" fill="#a855f7" stroke="#581c87" strokeWidth="1.5" rx="2" />
                {el.label && <text x={x} y={y + 28} textAnchor="middle" fontSize="11" fontWeight="700" fill="#581c87">{el.label}</text>}
              </g>
            );
          case 'table':
            return (
              <g key={i}>
                <rect x={x - 14} y={y - 6} width="28" height="14" fill="#92400e" rx="2" />
                <line x1={x - 12} y1={y + 8} x2={x - 12} y2={y + 16} stroke="#92400e" strokeWidth="2.5" />
                <line x1={x + 12} y1={y + 8} x2={x + 12} y2={y + 16} stroke="#92400e" strokeWidth="2.5" />
                {el.label && <text x={x} y={y + 28} textAnchor="middle" fontSize="11" fontWeight="700" fill="#92400e">{el.label}</text>}
              </g>
            );
          default:
            return null;
        }
      })}

      {/* direction arrow */}
      <g>
        <line x1={laneLeft + 30} y1={laneBottom + 28} x2={laneRight - 30} y2={laneBottom + 28}
              stroke="#1e293b" strokeWidth="1" markerEnd="url(#arrowhead)" />
        <text x={(laneLeft + laneRight) / 2} y={laneBottom + 24} textAnchor="middle" fontSize="10" fill="#1e293b">direction of run</text>
      </g>
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#1e293b" />
        </marker>
      </defs>
    </svg>
  );
}
