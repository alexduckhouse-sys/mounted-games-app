import { useT } from '../../i18n/LanguageContext';
import { useState } from 'react';
import { api } from '../../api';
import { SelectField } from '../../components/SelectField';
import { announceProtestsChanged, decisionProblem, protestWhere } from '../../lib/protests';
import { ProtestStatus, type Protest } from '../../types';
import { FormSheet, SheetField } from '../clubShop/ui';
import { apiMessage } from './types';

interface ProtestDecisionSheetProps {
  protest: Protest;
  onClose: () => void;
  onDecided?: (protest: Protest) => void;
}

/**
 * Uphold or dismiss a protest with the decision written down, or record that it was withdrawn. Deciding never
 * changes a score: a result that changes is corrected in the score record, with the decision as the reason.
 */
export function ProtestDecisionSheet({ protest, onClose, onDecided }: ProtestDecisionSheetProps) {
  const t = useT();
  const [outcome, setOutcome] = useState<ProtestStatus>(ProtestStatus.Open);
  const [decision, setDecision] = useState('');
  const [error, setError] = useState<string | null>(null);
  const problem = decisionProblem(outcome, decision);
  const withdrawing = outcome === ProtestStatus.Withdrawn;

  async function save(): Promise<boolean> {
    if (problem) {
      setError(problem);
      return false;
    }
    setError(null);
    const base = `/competitions/${protest.competitionId}/protests/${protest.id}`;
    try {
      const response = withdrawing
        ? await api.post<Protest>(`${base}/withdraw`, { note: decision.trim() || null })
        : await api.post<Protest>(`${base}/decision`, { outcome, decision: decision.trim() });
      announceProtestsChanged();
      onDecided?.(response.data);
      return true;
    } catch (saveError) {
      setError(apiMessage(saveError, t('ops2.pd.saveError')));
      return false;
    }
  }

  return (
    <FormSheet
      title={t('ops2.pd.title')}
      description={`${protestWhere(protest)}: ${protest.reason}`}
      saveLabel={withdrawing ? t('ops2.pd.markWithdrawn') : t('ops2.pd.saveDecision')}
      canSave={problem === null}
      onSave={save}
      onClose={onClose}
      error={error}
    >
      <SheetField label={t('ops2.pd.outcome')}>
        <SelectField aria-label={t('ops2.pd.outcome')} placeholder={t('ops2.pd.choose')} value={outcome === ProtestStatus.Open ? '' : String(outcome)}
          onChange={(event) => setOutcome(Number(event.target.value) as ProtestStatus)}>
          <option value={String(ProtestStatus.Upheld)}>{t('ops2.protest.upheld')}</option>
          <option value={String(ProtestStatus.Dismissed)}>{t('ops2.protest.dismissed')}</option>
          <option value={String(ProtestStatus.Withdrawn)}>{t('ops2.pd.withdrawnBy')}</option>
        </SelectField>
      </SheetField>
      <SheetField
        label={withdrawing ? t('ops2.pd.noteOptional') : t('ops2.pd.decisionReason')}
        hint={outcome === ProtestStatus.Upheld ? t('ops2.pd.upheldHint') : undefined}
      >
        <textarea rows={3} maxLength={1000} value={decision} onChange={(event) => setDecision(event.target.value)}
          placeholder={withdrawing ? t('ops2.pd.withdrawPlaceholder') : t('ops2.pd.decidePlaceholder')} />
      </SheetField>
    </FormSheet>
  );
}
