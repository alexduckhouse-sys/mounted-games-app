import { Link } from 'react-router-dom';
import { Printer } from 'lucide-react';
import type { CompetitionDetail, Session } from '../../types';
import { ShareTextButtons } from './ShareTextButtons';
import { sessionPrintPath } from './sessionPrint';
import { drawShareText } from './shareText';

/** Organiser tools for one session: print just this session, or send its lanes to a group chat. */
export function SessionSharePrint({ competition, session }: { competition: Pick<CompetitionDetail, 'id' | 'name'>; session: Session }) {
  const hasDraw = session.heats.length > 0;
  const link = `${window.location.origin}/competitions/${competition.id}`;
  return (
    <div className="mt-3 flex flex-col gap-2" aria-label="Print and share this session">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-[rgb(var(--mg-muted))]">Print this session</span>
        <Link className="rf-btn" to={sessionPrintPath(competition.id, 'draw', session.id)}><Printer className="h-4 w-4" aria-hidden="true" />Draw</Link>
        <Link className="rf-btn" to={sessionPrintPath(competition.id, 'score-sheets', session.id)}><Printer className="h-4 w-4" aria-hidden="true" />Score sheets</Link>
        <Link className="rf-btn" to={sessionPrintPath(competition.id, 'results', session.id)}><Printer className="h-4 w-4" aria-hidden="true" />Results</Link>
      </div>
      {hasDraw && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-[rgb(var(--mg-muted))]">Send the lanes</span>
          <ShareTextButtons title="Share draw" name="Draw" text={drawShareText(competition, session, link)} />
        </div>
      )}
    </div>
  );
}
