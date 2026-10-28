import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n/LanguageContext';
import { useAuth } from '../../auth/AuthContext';
import { RefineHeader, RefinePage } from '../refine/Refine';
import { VolunteerRota } from '../operations/VolunteerRota';
import { useCompetition } from './context';

/** `/competitions/:id/volunteers`: the rota anyone can read and signed-in volunteers can sign up to. Organisers get the editing tools here too. */
export function VolunteerRotaPage() {
  const { competition } = useCompetition();
  const { canOrganise } = useAuth();
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const saved = (location.state as { dutiesSaved?: boolean } | null)?.dutiesSaved === true;
  // The heat duties wizard sends people back here after saving; say so once, then clear the flag so a refresh doesn't repeat it.
  useEffect(() => {
    if (!saved) return;
    toast.show(t('duties.saved'));
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);
  return (
    <RefinePage>
      <RefineHeader back={`/competitions/${competition.id}/details`} backLabel="Back to the event" context={competition.name} title="Volunteer shifts" />
      <VolunteerRota competition={competition} manage={canOrganise(competition)} />
      {toast.node}
    </RefinePage>
  );
}
