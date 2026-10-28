import { useToast } from '../../components/Toast';
import { useT } from '../../i18n/LanguageContext';
import { useAuth } from '../../auth/AuthContext';
import { RefineHeader, RefinePage } from '../refine/Refine';
import { VolunteerRota } from '../operations/VolunteerRota';
import { useDutiesSavedToast } from '../operations/useDutiesSavedToast';
import { useCompetition } from './context';

/** `/competitions/:id/volunteers`: the rota anyone can read and signed-in volunteers can sign up to. Organisers get the editing tools here too. */
export function VolunteerRotaPage() {
  const t = useT();
  const { competition } = useCompetition();
  const { canOrganise } = useAuth();
  const toast = useToast();
  useDutiesSavedToast(toast);
  return (
    <RefinePage>
      <RefineHeader back={`/competitions/${competition.id}/details`} backLabel={t('site.volunteers.backToEvent')} context={competition.name} title={t('site.volunteers.title')} />
      <VolunteerRota competition={competition} manage={canOrganise(competition)} />
      {toast.node}
    </RefinePage>
  );
}
