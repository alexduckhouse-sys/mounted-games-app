import { useAuth } from '../../auth/AuthContext';
import { useT } from '../../i18n/LanguageContext';
import { RefineHeader, RefinePage } from '../refine/Refine';
import { VolunteerRota } from '../operations/VolunteerRota';
import { useCompetition } from './context';

/** `/competitions/:id/volunteers`: the rota anyone can read and signed-in volunteers can sign up to. Organisers get the editing tools here too. */
export function VolunteerRotaPage() {
  const t = useT();
  const { competition } = useCompetition();
  const { canOrganise } = useAuth();
  return (
    <RefinePage>
      <RefineHeader back={`/competitions/${competition.id}/details`} backLabel={t('site.volunteers.backToEvent')} context={competition.name} title={t('site.volunteers.title')} />
      <VolunteerRota competition={competition} manage={canOrganise(competition)} />
    </RefinePage>
  );
}
