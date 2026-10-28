import { AUTO_RULES, autoStatus, nextRaceName, type AutoRuleKey, type AutoState } from '../../../lib/streamAuto';
import type { CompetitionDetail } from '../../../types';
import { RefineList, RefineNote, RefineSection } from '../../refine/Refine';

export function AutoTab({ competition, auto, setOn, setRule, prizeGiving }: {
  competition: Pick<CompetitionDetail, 'sessions'>;
  auto: AutoState;
  setOn: (on: boolean) => void;
  setRule: (key: AutoRuleKey, patch: { on?: boolean; n?: number }) => void;
  /** The shared prize-giving switch: it is saved with the overlay, so it holds for everyone watching, not just this device. */
  prizeGiving: { on: boolean; disabled: boolean; set: (on: boolean) => void };
}) {
  return (
    <>
      <RefineList as="div" label="Automations">
        <div className="rf-row">
          <span className="rf-grow"><span className="rf-t1">Run automations</span><span className="rf-t2">{autoStatus(auto, nextRaceName(competition))}</span></span>
          <button type="button" role="switch" aria-checked={auto.on} aria-label="Run automations" className="rf-sw" onClick={() => setOn(!auto.on)}><span aria-hidden="true" /></button>
        </div>
      </RefineList>
      <RefineNote>Runs while a stream controls page is open on this device.</RefineNote>

      <RefineSection title="Rules" />
      <RefineList as="div" label="Rules">
        {AUTO_RULES.map((info) => {
          const rule = auto.rules[info.key];
          return (
            <div key={info.key} className="rf-row sx-rule">
              <span className="rf-grow sx-rule-text"><span className="rf-t1">{info.when}</span><span className="rf-t2">{info.what(rule)}</span></span>
              <button type="button" role="switch" aria-checked={rule.on} aria-label={info.when} className="rf-sw" onClick={() => setRule(info.key, { on: !rule.on })}><span aria-hidden="true" /></button>
              {rule.on && info.choices.length > 0 && (
                <div className="sx-pills sx-rule-choices" role="radiogroup" aria-label={info.choiceLabel}>
                  {info.choices.map((choice) => (
                    <button key={choice.n} type="button" role="radio" aria-checked={rule.n === choice.n} className="sx-pill" onClick={() => setRule(info.key, { n: choice.n })}>{choice.label}</button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </RefineList>

      <RefineSection title="Prize-giving" />
      <RefineList as="div" label="Prize-giving">
        <div className="rf-row sx-rule">
          <span className="rf-grow sx-rule-text"><span className="rf-t1">After each final</span><span className="rf-t2">Places go up on the stream by themselves, last to first</span></span>
          <button type="button" role="switch" aria-checked={prizeGiving.on} aria-label="Prize-giving after each final" disabled={prizeGiving.disabled} className="rf-sw" onClick={() => prizeGiving.set(!prizeGiving.on)}><span aria-hidden="true" /></button>
        </div>
      </RefineList>
      <RefineNote>This one plays for everyone watching, even with no controls page open. The Prize-giving page on a session’s menu runs it by hand.</RefineNote>
    </>
  );
}
