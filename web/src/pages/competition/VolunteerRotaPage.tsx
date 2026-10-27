import { useAuth } from '../../auth/AuthContext';
import { RefineHeader, RefinePage } from '../refine/Refine';
import { VolunteerRota } from '../operations/VolunteerRota';
import { useCompetition } from './context';

/** `/competitions/:id/volunteers`: the rota anyone can read and signed-in volunteers can sign up to. Organisers get the editing tools here too. */
export function VolunteerRotaPage() {
  const { competition } = useCompetition();
  const { canOrganise } = useAuth();
  return (
    <RefinePage>
      <RefineHeader back={`/competitions/${competition.id}/details`} backLabel="Back to the event" context={competition.name} title="Volunteer shifts" />
      <VolunteerRota competition={competition} manage={canOrganise(competition)} />
    </RefinePage>
  );
}
