import { useState } from 'react';
import { HATBAND_COLOURS, hatbandsFor, type CreatorDraft } from '../../../lib/creatorDraft';
import { formatHatband, hatbandColour, hatbandName, parseHatband } from '../../../lib/hatbands';
import { SelectBox, TextBox } from './parts';

const OWN = '__own__';

/** Which hatband goes with which lane, as a plain list (review step and On the day page). */
export function HatbandList({ hatbands }: { hatbands: readonly string[] }) {
  return (
    <ol aria-label="Hatbands by lane" className="m-0 flex list-none flex-wrap gap-2 p-0">
      {hatbands.map((colour, i) => (
        <li key={i} className="rounded-full border border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))] px-3 py-1 text-sm">
          <span className="font-semibold">Lane {i + 1}</span> · <span aria-hidden="true" className="mr-1.5 inline-block h-3 w-3 rounded-full align-middle" style={{ background: hatbandColour(colour), boxShadow: '0 0 0 1px rgb(var(--mg-muted))' }} />{hatbandName(colour)}
        </li>
      ))}
    </ol>
  );
}

/** One row per lane (as many as the biggest heat): a colour from the list, or your own. */
export function HatbandEditor({ draft, change }: { draft: CreatorDraft; change: (patch: Partial<CreatorDraft>) => void }) {
  // Lanes where "Type your own…" was chosen, so the box stays while it is empty.
  const [typing, setTyping] = useState<ReadonlySet<number>>(new Set());
  const current = hatbandsFor(draft);
  const set = (i: number, colour: string) => {
    const next = [...current];
    next[i] = colour;
    change({ laneHatbands: next });
  };
  return (
    <div role="group" aria-label="Hatbands" className="mg-card flex flex-col gap-3 p-4">
      <strong className="text-[17px] text-[rgb(var(--mg-heading))]">Hatbands by lane</strong>
      <p className="text-sm text-[rgb(var(--mg-muted))]">One lane for each team in the biggest heat. Riders wear the hatband for their lane.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {current.map((colour, i) => {
          const preset = HATBAND_COLOURS.includes(colour);
          const { hex } = parseHatband(colour);
          const own = typing.has(i) || !preset;
          return (
            <div key={i} className="flex flex-col gap-2">
              <SelectBox label={`Lane ${i + 1}`} value={own ? OWN : colour}
                onChange={(v) => {
                  if (v === OWN) { setTyping(new Set([...typing, i])); return; }
                  setTyping(new Set([...typing].filter((n) => n !== i)));
                  set(i, v);
                }}>
                {HATBAND_COLOURS.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value={OWN}>Type your own…</option>
              </SelectBox>
              {own && <TextBox label={`Hatband colour for lane ${i + 1}`} value={preset ? '' : hex ? hatbandName(colour) : colour} onChange={(v) => set(i, hex ? formatHatband(v, hex) : v)} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
