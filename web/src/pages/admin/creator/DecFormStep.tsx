import { DecFormConfigEditor } from '../DecFormConfig';
import { StepIntro } from './parts';

/**
 * What the dec form asks. An existing competition shows the setup editor, which saves on its own. A new one
 * doesn't exist yet, so it explains the starting point: the basics, which can be added to straight after publishing.
 */
export function DecFormStep({ competitionId, canChange }: { competitionId: number | null; canChange: boolean }) {
  return (
    <section aria-labelledby="cw-dec" className="flex flex-col gap-[18px]">
      <StepIntro title="Dec form">What trainers fill in for each team. You can change it at any time; changes apply to forms sent after that.</StepIntro>
      {competitionId != null
        ? <DecFormConfigEditor competitionId={competitionId} readOnly={!canChange} />
        : (
          <p className="text-[15px] text-[rgb(var(--mg-body))]">
            A new competition starts with the basics: the rider’s name and the pony’s name for each rider, and the trainer’s name and phone number for the team.
            Once it’s published, go to Dec form setup on the competition page to add things like weight, a passport number, medical notes or your own questions.
          </p>
        )}
    </section>
  );
}
