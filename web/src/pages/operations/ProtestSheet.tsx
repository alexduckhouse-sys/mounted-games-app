import { useT } from '../../i18n/LanguageContext';
import { useState } from 'react';
import { api } from '../../api';
import { SelectField } from '../../components/SelectField';
import { announceProtestsChanged, protestRequestId } from '../../lib/protests';
import type { Heat, Protest, Race } from '../../types';
import { FormSheet, SheetField } from '../clubShop/ui';
import { apiMessage } from './types';
import './operations.css';

interface ProtestSheetProps {
  competitionId: number;
  heat: Heat;
  /** The race on screen. Left out, the protest is about the whole heat. */
  race?: Race | null;
  onClose: () => void;
  onLogged?: (protest: Protest) => void;
}

const WHOLE_HEAT = 'heat';
const NO_TEAM = '';

/**
 * Log a protest or referee query against the race on screen or its whole heat. Staff only: the reason and names
 * stay private, and the public just sees the race marked under review until it's decided.
 */
export function ProtestSheet({ competitionId, heat, race = null, onClose, onLogged }: ProtestSheetProps) {
  const t = useT();
  const [scope, setScope] = useState(race ? String(race.id) : WHOLE_HEAT);
  const [raisedBy, setRaisedBy] = useState(NO_TEAM);
  const [concerns, setConcerns] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  // One id per sheet, so pressing the pill again after a dropped connection can't log it twice.
  const [requestId] = useState(() => protestRequestId());
  const teams = [...heat.entries].sort((a, b) => a.laneIndex - b.laneIndex);

  function toggle(teamId: number) {
    setConcerns((current) => (current.includes(teamId) ? current.filter((id) => id !== teamId) : [...current, teamId]));
  }

  async function save(): Promise<boolean> {
    if (!reason.trim()) {
      setError(t('ops2.ps.needReason'));
      return false;
    }
    setError(null);
    try {
      const response = await api.post<Protest>(`/competitions/${competitionId}/protests`, {
        heatId: heat.id,
        raceId: scope === WHOLE_HEAT ? null : Number(scope),
        raisedByTeamId: raisedBy === NO_TEAM ? null : Number(raisedBy),
        concernsTeamIds: concerns,
        raisedByName: name.trim() || null,
        reason: reason.trim(),
        requestId,
      });
      announceProtestsChanged();
      onLogged?.(response.data);
      return true;
    } catch (saveError) {
      setError(apiMessage(saveError, t('ops2.protests.logError')));
      return false;
    }
  }

  return (
    <FormSheet
      title={t('ops2.protests.log')}
      description={t('ops2.ps.description')}
      saveLabel={t('ops2.ps.save')}
      canSave={reason.trim().length > 0}
      onSave={save}
      onClose={onClose}
      error={error}
    >
      <SheetField label={t('ops2.ps.about')}>
        <SelectField aria-label={t('ops2.ps.about')} value={scope} onChange={(event) => setScope(event.target.value)}>
          {race && <option value={String(race.id)}>{race.name}</option>}
          <option value={WHOLE_HEAT}>{t('ops2.ps.wholeHeat', { heat: heat.label || t('ops2.ps.thisHeat') })}</option>
        </SelectField>
      </SheetField>
      <SheetField label={t('ops2.ps.raisedBy')}>
        <SelectField aria-label={t('ops2.ps.raisedBy')} value={raisedBy} onChange={(event) => setRaisedBy(event.target.value)}>
          <option value={NO_TEAM}>{t('ops2.ps.notTeam')}</option>
          {teams.map((team) => <option key={team.teamId} value={String(team.teamId)}>{team.teamName}</option>)}
        </SelectField>
      </SheetField>
      <SheetField label={t('ops2.ps.whoOptional')} hint={t('ops2.ps.whoHint')}>
        <input type="text" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder={t('ops2.ps.namePlaceholder')} />
      </SheetField>
      <fieldset className="ops-protest-teams">
        <legend>{t('ops2.ps.teamsAbout')}</legend>
        {teams.map((team) => (
          <label key={team.teamId} className="ops-protest-team">
            <span>{team.teamName}</span>
            <input type="checkbox" role="switch" checked={concerns.includes(team.teamId)} onChange={() => toggle(team.teamId)} />
          </label>
        ))}
      </fieldset>
      <SheetField label={t('ops2.ps.whatHappened')}>
        <textarea rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('ops2.ps.reasonPlaceholder')} />
      </SheetField>
    </FormSheet>
  );
}
