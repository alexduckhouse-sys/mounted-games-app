import { DecFormConfigEditor } from '../DecFormConfig';
import { StepHeading } from './controls';

/**
 * What the dec form asks. An existing competition shows the setup editor, which saves on its own. A new one
 * doesn't exist yet, so it explains the starting point: the basics, which can be added to straight after publishing.
 */
export function DecFormStep({ competitionId, canChange }: { competitionId: number | null; canChange: boolean }) {
  return (
    <section aria-label="Dec form" className="flex flex-col">
      <StepHeading>Dec form</StepHeading>
      {competitionId != null
        ? <div className="mt-3"><DecFormConfigEditor competitionId={competitionId} readOnly={!canChange} /></div>
        : (
          <div className="cw-card mt-3">
            <div className="cw-panel">
              <p className="cw-t1" style={{ fontWeight: 500 }}>
                A new competition starts with the basics: the rider’s name and the pony’s name for each rider, and the trainer’s name and phone number for the team.
              </p>
              <p className="cw-t2">
                Once it’s created, go to Dec form setup on the competition page to add things like weight, a passport number, medical notes or your own questions,
                and flags for forms that need a look. What trainers fill in can change at any time; changes apply to forms sent after that.
              </p>
            </div>
          </div>
        )}
    </section>
  );
}
