import type { CSSProperties, ReactNode } from 'react';

/** Grey placeholder shapes in the layout of the page that is loading, so it doesn't jump when the data arrives. */
function Bar({ w, h = 14, className = '', style }: { w: string | number; h?: number; className?: string; style?: CSSProperties }) {
  return <span className={`mg-skel ${className}`} style={{ width: w, height: h, ...style }} />;
}

function Placeholder({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className={className}>{children}</div>
    </div>
  );
}

// Varied widths read as text rather than a grid of identical blocks.
const NAME_WIDTHS = ['62%', '48%', '70%', '55%', '66%', '44%'];

export function TimetableSkeleton() {
  return (
    <Placeholder label="Loading timetable…" className="timetable-board">
      <div className="tt-head mg-band">
        <div className="flex min-h-10 items-center gap-3">
          <Bar w="45%" h={28} />
          <span className="flex-1" />
          <Bar w={72} h={14} />
        </div>
        <div className="flex gap-2"><Bar w={96} h={40} /><Bar w={96} h={40} /></div>
      </div>
      <div className="tt-body">
        {[4, 3].map((rows, group) => (
          <section key={group} className="tt-group">
            <div className="mg-section-head"><Bar w="55%" h={18} /></div>
            <div className="mg-card mg-list">
              {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="tt-row">
                  <Bar w={52} h={24} />
                  <span className="flex flex-col gap-1.5"><Bar w={NAME_WIDTHS[(i + group) % NAME_WIDTHS.length]} h={16} /><Bar w="35%" h={12} /></span>
                  <Bar w={64} h={24} style={{ borderRadius: 999 }} />
                  <span />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Placeholder>
  );
}

/** Rows only: the age-group chips and toggle above it are already on screen. */
export function ToplistRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Placeholder label="Loading results…" className="mg-card mg-list">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-14 items-center gap-3 px-3.5">
          <Bar w={22} h={22} />
          <Bar w={NAME_WIDTHS[i % NAME_WIDTHS.length]} h={16} />
          <span className="flex-1" />
          <Bar w={30} h={22} />
        </div>
      ))}
    </Placeholder>
  );
}

export function ToplistSkeleton() {
  return (
    <Placeholder label="Loading toplist…" className="flex flex-col gap-3 pt-4">
      <Bar w="40%" h={28} />
      <div className="flex gap-2"><Bar w={84} h={40} /><Bar w={84} h={40} /><Bar w={84} h={40} /></div>
      <ToplistRowsSkeleton />
    </Placeholder>
  );
}

export function CompetitionListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Placeholder label="Loading competitions…" className="mg-card mg-list">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="mg-row">
          <span className="flex w-11 shrink-0 flex-col items-center gap-1"><Bar w={26} h={22} /><Bar w={30} h={10} /></span>
          <span className="flex flex-1 flex-col gap-1.5"><Bar w={NAME_WIDTHS[i % NAME_WIDTHS.length]} h={16} /><Bar w="40%" h={12} /></span>
        </div>
      ))}
    </Placeholder>
  );
}

/** Generic fallback while a page's code downloads. */
export function PageSkeleton() {
  return (
    <Placeholder label="Opening page…" className="mx-auto flex w-full max-w-xl flex-col gap-3 py-6">
      <Bar w="50%" h={28} />
      <Bar w="80%" h={14} />
      <div className="mg-card mg-list mt-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="mg-row"><span className="flex flex-1 flex-col gap-1.5"><Bar w={NAME_WIDTHS[i]} h={16} /><Bar w="35%" h={12} /></span></div>
        ))}
      </div>
    </Placeholder>
  );
}
