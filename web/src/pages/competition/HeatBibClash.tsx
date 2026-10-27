import { useState } from 'react';
import { Notice } from '../../components/Notice';
import { detectHeatBibClashes } from '../../lib/bib';
import { suggestFreeBibColour } from '../../lib/heatBibOverride';
import type { Heat } from '../../types';

/**
 * A calm note for staff when two teams in a heat wear the same bib colour, with a one-tap swap, and a way back
 * for any team already on a heat-only colour. The entry's bibColour already includes the override.
 */
export function HeatBibClash({ heat, onSet }: { heat: Heat; onSet: (teamId: number, colour: string | null) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const clashes = detectHeatBibClashes(heat.entries);
  const overridden = heat.entries.filter((e) => e.bibColourOverride?.trim());
  if (clashes.length === 0 && overridden.length === 0) return null;

  async function run(teamId: number, colour: string | null) {
    setBusy(true);
    try { await onSet(teamId, colour); } finally { setBusy(false); }
  }

  const suggestion = suggestFreeBibColour(heat.entries);
  return (
    <div className="space-y-2">
      {clashes.map((clash) => {
        const target = clash.entries[clash.entries.length - 1] as Heat['entries'][number];
        const names = (clash.entries as Heat['entries']).map((e) => e.teamName).join(' and ');
        return (
          <Notice
            key={clash.colourKey}
            actionLabel={suggestion ? `Use ${suggestion} bibs for ${target.teamName}` : undefined}
            actionDisabled={busy}
            onAction={() => { if (suggestion) void run(target.teamId, suggestion); }}
          >
            {names} both have {clash.colourLabel.toLowerCase()} bibs in this heat.{suggestion ? '' : ' No spare colour is free.'}
          </Notice>
        );
      })}
      {overridden.map((e) => (
        <Notice key={e.teamId} tone="info" actionLabel="Use usual bibs" actionDisabled={busy} onAction={() => void run(e.teamId, null)}>
          {e.teamName} wears {(e.bibColourOverride ?? '').toLowerCase()} bibs in this heat only.
        </Notice>
      ))}
    </div>
  );
}
