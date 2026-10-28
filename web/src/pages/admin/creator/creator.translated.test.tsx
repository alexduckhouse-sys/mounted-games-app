import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { defaultDraft, defaultSection, validateStep } from '../../../lib/creatorDraft';
import { durationText, estimateText } from '../../../lib/creatorPlan';
import { describeHeats } from '../../../lib/formatPlan';
import { ArenasStep } from './ArenasStep';
import { BreakForm } from './BreakForm';
import { HatbandEditor } from './Hatbands';
import { SectionsStep } from './SectionsStep';
import { StepNav } from './StepNav';
import { StructureStep } from './StructureStep';

vi.mock('../../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const draft = () => ({ ...defaultDraft(new Date(2026, 9, 24)), sections: [{ ...defaultSection(), ageGroup: 'Under 12' }] });
const noop = () => undefined;

describe.each([
  {
    lang: 'fr' as const, arenas: 'Combien d’arènes ?', maxLanes: 'Couloirs max.', sectionType: 'Catégorie d’âge', add: 'Ajouter une section',
    structure: 'Structure de', tie: 'Départage', hatbands: 'Brassards', brk: 'Ajouter au programme', steps: 'Étapes', heats: '2 manches de 3',
    problem: 'Donnez un nom à l’arène.', estimate: '5 équipes inscrites', duration: '1 h 40 min',
  },
  {
    lang: 'cy' as const, arenas: 'Faint o arenâu?', maxLanes: 'Nifer mwyaf y lonydd', sectionType: 'Grŵp oedran', add: 'Ychwanegu adran',
    structure: 'Strwythur ar gyfer', tie: 'Torri cyfartal', hatbands: 'Bandiau het', brk: 'Ychwanegu at yr amserlen', steps: 'Camau', heats: '2 rhagras o 3',
    problem: 'Rhowch enw i’r arena.', estimate: '5 tîm wedi’u cofrestru', duration: '1 awr 40 munud',
  },
])('the competition creator in $lang', (c) => {
  const wrap = (ui: React.ReactElement) => render(<LanguageProvider initial={c.lang}><MemoryRouter>{ui}</MemoryRouter></LanguageProvider>);

  it('translates the arenas and sections steps', () => {
    const d = draft();
    wrap(<><ArenasStep draft={d} change={noop} problems={{}} clear={noop} /><SectionsStep draft={d} change={noop} problems={{}} clear={noop} /></>);
    expect(screen.getByText(c.arenas)).toBeInTheDocument();
    expect(screen.getByText(c.maxLanes)).toBeInTheDocument();
    expect(screen.getByText(c.sectionType)).toBeInTheDocument();
    expect(screen.getByText(c.add)).toBeInTheDocument();
    expect(screen.queryByText('How many arenas?')).not.toBeInTheDocument();
    expect(screen.queryByText('Add a section')).not.toBeInTheDocument();
  });

  it('translates the structure step, hatbands, break form and step list', () => {
    const d = draft();
    wrap(<>
      <StructureStep draft={d} change={noop} problems={{}} clear={noop} templates={[]} teamCounts={{}} />
      <HatbandEditor draft={d} change={noop} />
      <BreakForm date="2026-10-24" arenas={['Main arena']} onAdd={noop} />
      <StepNav steps={['about', 'when']} current={0} reached={1} onGo={noop} timetable={null} onTimetable={noop} title="x" />
    </>);
    expect(screen.getByRole('group', { name: new RegExp(`^${c.structure}`) })).toBeInTheDocument();
    expect(screen.getByText(c.tie)).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: c.hatbands }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: new RegExp(c.brk) })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: c.steps })).toBeInTheDocument();
    expect(screen.queryByText('Tie-break')).not.toBeInTheDocument();
  });

  it('translates validation messages and the wording built in lib/', () => {
    wrap(<span />);
    const bad = { ...draft(), arenas: [{ name: '', lanes: '6' }] };
    expect(validateStep(bad, 'arenas')['arena.0.name']).toBe(c.problem);
    expect(estimateText({ count: 5, basis: 'teams' })).toBe(c.estimate);
    expect(durationText(100)).toBe(c.duration);
    expect(describeHeats([3, 3])).toBe(c.heats);
  });
});
