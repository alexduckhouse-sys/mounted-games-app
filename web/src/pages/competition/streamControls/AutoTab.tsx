import { AUTO_RULES, nextRaceName, type AutoRuleKey, type AutoState } from '../../../lib/streamAuto';
import type { CompetitionDetail } from '../../../types';
import { useT } from '../../../i18n/LanguageContext';
import { RefineList, RefineNote, RefineSection } from '../../refine/Refine';
import { autoChoiceText, autoRuleText, autoStatusText } from './streamText';

export function AutoTab({ competition, auto, setOn, setRule }: {
  competition: Pick<CompetitionDetail, 'sessions'>;
  auto: AutoState;
  setOn: (on: boolean) => void;
  setRule: (key: AutoRuleKey, patch: { on?: boolean; n?: number }) => void;
}) {
  const t = useT();
  return (
    <>
      <RefineList as="div" label={t('desk.stream.auto.automations')}>
        <div className="rf-row">
          <span className="rf-grow"><span className="rf-t1">{t('desk.stream.auto.run')}</span><span className="rf-t2">{autoStatusText(t, auto, nextRaceName(competition))}</span></span>
          <button type="button" role="switch" aria-checked={auto.on} aria-label={t('desk.stream.auto.run')} className="rf-sw" onClick={() => setOn(!auto.on)}><span aria-hidden="true" /></button>
        </div>
      </RefineList>
      <RefineNote>{t('desk.stream.auto.note')}</RefineNote>

      <RefineSection title={t('desk.stream.auto.rules')} />
      <RefineList as="div" label={t('desk.stream.auto.rules')}>
        {AUTO_RULES.map((info) => {
          const rule = auto.rules[info.key];
          const words = autoRuleText(t, info.key, rule);
          return (
            <div key={info.key} className="rf-row sx-rule">
              <span className="rf-grow sx-rule-text"><span className="rf-t1">{words.when}</span><span className="rf-t2">{words.what}</span></span>
              <button type="button" role="switch" aria-checked={rule.on} aria-label={words.when} className="rf-sw" onClick={() => setRule(info.key, { on: !rule.on })}><span aria-hidden="true" /></button>
              {rule.on && info.choices.length > 0 && (
                <div className="sx-pills sx-rule-choices" role="radiogroup" aria-label={words.choiceLabel}>
                  {info.choices.map((choice) => (
                    <button key={choice.n} type="button" role="radio" aria-checked={rule.n === choice.n} className="sx-pill" onClick={() => setRule(info.key, { n: choice.n })}>{autoChoiceText(t, info.key, choice.n)}</button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </RefineList>
    </>
  );
}
