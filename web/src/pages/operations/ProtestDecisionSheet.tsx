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
      setError(apiMessage(saveError, 'Couldn’t save the decision. Check your signal and try again.'));
      return false;
    }
  }

  return (
    <FormSheet
      title="Decide the protest"
      description={`${protestWhere(protest)}: ${protest.reason}`}
      saveLabel={withdrawing ? 'Mark withdrawn' : 'Save decision'}
      canSave={problem === null}
      onSave={save}
      onClose={onClose}
      error={error}
    >
      <SheetField label="Outcome">
        <SelectField aria-label="Outcome" placeholder="Choose" value={outcome === ProtestStatus.Open ? '' : String(outcome)}
          onChange={(event) => setOutcome(Number(event.target.value) as ProtestStatus)}>
          <option value={String(ProtestStatus.Upheld)}>Upheld</option>
          <option value={String(ProtestStatus.Dismissed)}>Dismissed</option>
          <option value={String(ProtestStatus.Withdrawn)}>Withdrawn by whoever raised it</option>
        </SelectField>
      </SheetField>
      <SheetField
        label={withdrawing ? 'Note (optional)' : 'Decision and reason'}
        hint={outcome === ProtestStatus.Upheld ? 'If a result changes, correct it in the score record and give this decision as the reason.' : undefined}
      >
        <textarea rows={3} maxLength={1000} value={decision} onChange={(event) => setDecision(event.target.value)}
          placeholder={withdrawing ? 'e.g. The trainer withdrew it after seeing the video.' : 'e.g. Referee saw the crossing. Team 3 eliminated from this race.'} />
      </SheetField>
    </FormSheet>
  );
}
