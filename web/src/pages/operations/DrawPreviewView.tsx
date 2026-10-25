import { Fragment } from 'react';
import { RefineDisclosure, RefineList, RefineNote, RefineSection, RefineStatus } from '../refine/Refine';
import type { DrawPreview } from './types';
import { plural } from './readiness';
import { SelectField } from '../../components/SelectField';
import { NumberField } from '../../components/NumberField';

interface SectionOption { id: number; displayName: string }

/** Section, draw number and the Preview button. Inline before a preview exists, then inside the draw settings sheet. */
export function DrawSettingsForm({ sections, sectionId, seed, previewing, onSection, onSeed, onPreview }: {
  sections: SectionOption[];
  sectionId: number | null;
  seed: string;
  previewing: boolean;
  onSection: (id: number) => void;
  onSeed: (value: string) => void;
  onPreview: () => void;
}) {
  return (
    <div className="ops-form">
      <label className="rf-fld">Section
        <SelectField value={sectionId ?? ''} onChange={(event) => onSection(Number(event.target.value))}>
          {sections.map((section) => <option key={section.id} value={section.id}>{section.displayName}</option>)}
        </SelectField>
      </label>
      <label className="rf-fld">Draw number
        <NumberField allowNegative  step="1" value={seed} onChange={(event) => onSeed(event.target.value)} />
      </label>
      <RefineNote>Change the number for a different draw.</RefineNote>
      <button type="button" className="rf-btn rf-btn-primary rf-wide" onClick={onPreview} disabled={previewing || sectionId == null}>
        {previewing ? 'Preparing…' : 'Preview draw'}
      </button>
    </div>
  );
}

interface FairnessCheck { label: string; ok: boolean; detail: string }

/** Passed and failed checks come only from what the API reports: team coverage, repeated pairings and its own warnings. */
function fairnessChecks(preview: DrawPreview): { failing: FairnessCheck[]; passing: FairnessCheck[]; figures: string } {
  const { fairness } = preview;
  const checks: FairnessCheck[] = [
    { label: 'Every team once per round', ok: fairness.everyTeamAppearsOncePerSession, detail: 'This preview doesn’t cover every team once per session. Don’t apply it.' },
    { label: 'No repeated pairings', ok: fairness.repeatedOpponentPairs === 0, detail: `${plural(fairness.repeatedOpponentPairs, 'pair')} of teams meet more than once. The most any two teams meet is ${fairness.maximumOpponentMeetings} times.` },
  ];
  return {
    failing: [...checks.filter((check) => !check.ok), ...fairness.warnings.map((warning) => ({ label: 'Note', ok: false, detail: warning }))],
    passing: checks.filter((check) => check.ok),
    figures: `Heat size spread ${fairness.heatSizeSpread} · Most opponent meetings ${fairness.maximumOpponentMeetings} · Lane-use spread ${fairness.maximumLaneUseSpread}`,
  };
}

export function FairnessRow({ preview }: { preview: DrawPreview }) {
  const { failing, passing, figures } = fairnessChecks(preview);
  return (
    <RefineDisclosure
      defaultOpen={failing.length > 0}
      title="Fairness"
      sub={<>{failing.length > 0 ? <RefineStatus tone="warn">{failing.length} to check</RefineStatus> : <RefineStatus tone="ok">All clear</RefineStatus>}{passing.length > 0 && <> · {passing.length} passed</>}</>}
    >
      <div className="ops-fair">
        {failing.map((check, index) => <p key={`${check.label}-${index}`}><RefineStatus tone="warn">{check.label}.</RefineStatus> {check.detail}</p>)}
        {passing.length > 0 && <p className="ops-quiet">Passed: {passing.map((check) => check.label).join(', ')}.</p>}
        <p className="ops-quiet">{figures}</p>
      </div>
    </RefineDisclosure>
  );
}

function laneSpread(preview: DrawPreview): Array<{ teamId: number; name: string; lanes: Array<number | null> }> {
  const teams = new Map<number, { teamId: number; name: string; lanes: Array<number | null> }>();
  preview.sessions.forEach((session, index) => {
    for (const heat of session.heats) {
      for (const team of heat.teams) {
        const entry = teams.get(team.teamId) ?? { teamId: team.teamId, name: team.teamName, lanes: preview.sessions.map(() => null) };
        entry.lanes[index] = team.laneIndex;
        teams.set(team.teamId, entry);
      }
    }
  });
  return [...teams.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function DrawResult({ preview, round, onRound, onNewSeed, busy }: {
  preview: DrawPreview;
  round: number;
  onRound: (index: number) => void;
  onNewSeed: () => void;
  busy: boolean;
}) {
  const active = Math.min(round, preview.sessions.length - 1);
  const session = preview.sessions[active];
  const spread = laneSpread(preview);
  return (
    <>
      <RefineList as="div">
        <div className="rf-row">
          <span className="rf-grow"><span className="rf-t2">Seed</span><span className="rf-num ops-seed">{preview.seed}</span></span>
          <button type="button" className="rf-btn" onClick={onNewSeed} disabled={busy}>New seed</button>
        </div>
        <FairnessRow key={`${preview.fingerprint}-${preview.seed}`} preview={preview} />
      </RefineList>

      {preview.sessions.length > 1 && (
        <div className="mg-seg ops-seg" role="group" aria-label="Round">
          {preview.sessions.map((item, index) => (
            <button key={item.sessionId} type="button" aria-pressed={index === active} onClick={() => onRound(index)}>Round {index + 1}</button>
          ))}
        </div>
      )}

      {session && (
        <>
          <p className="ops-session">{session.name}</p>
          {session.heats.map((heat) => (
            <Fragment key={heat.heatId}>
              <RefineSection title={heat.label || `Heat ${heat.orderIndex}`} />
              <RefineList as="ol" label={heat.label || `Heat ${heat.orderIndex}`}>
                {[...heat.teams].sort((a, b) => a.laneIndex - b.laneIndex).map((team) => (
                  <li key={team.teamId} className="rf-row ops-lane"><span className="rf-num ops-lane-no">{team.laneIndex}</span><span className="rf-grow">{team.teamName}</span></li>
                ))}
              </RefineList>
            </Fragment>
          ))}
        </>
      )}

      <div className="ops-gap">
        <RefineList as="div">
          <RefineDisclosure title="Lane spread by team">
            <ul className="ops-spread">
              {spread.map((team) => (
                <li key={team.teamId} className="rf-row ops-lane"><span className="rf-grow">{team.name}</span><span className="rf-t2">{team.lanes.map((lane, index) => `R${index + 1} lane ${lane ?? '–'}`).join(' · ')}</span></li>
              ))}
            </ul>
          </RefineDisclosure>
        </RefineList>
      </div>
    </>
  );
}
