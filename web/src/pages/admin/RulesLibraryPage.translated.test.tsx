import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { DiagramEditor } from '../../components/DiagramEditor';
import { RulesLibraryPage } from './RulesLibraryPage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canEdit: () => true }) }));
vi.mock('../operations/RulebooksPage', () => ({ RulebooksPanel: () => <p>rulebook panel</p> }));

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ data: [{ id: 1, name: 'Pyramid', summary: 'Stack', rules: '', category: null, diagramJson: '[]', isBuiltIn: false }] });
});

describe('Rules library and diagram editor in French and Welsh', () => {
  it('shows the library in French', async () => {
    render(<MemoryRouter><LanguageProvider initial="fr"><RulesLibraryPage /></LanguageProvider></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bibliothèque des règles' })).toBeInTheDocument();
    expect(await screen.findByRole('searchbox', { name: 'Rechercher des courses' })).toHaveAttribute('placeholder', 'Rechercher parmi 1 courses');
    expect(screen.getByRole('button', { name: 'Nouvelle course' })).toBeInTheDocument();
    expect(screen.queryByText('Rules library')).not.toBeInTheDocument();
  });

  it('shows the diagram editor in Welsh', async () => {
    const user = userEvent.setup();
    render(<LanguageProvider initial="cy"><DiagramEditor value="[]" onChange={() => {}} /></LanguageProvider>);
    expect(screen.getByText('Polion plygu')).toBeInTheDocument();
    expect(screen.getByText('Tapiwch bolyn neu fwlch i osod offer.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rhwng polyn 2 a polyn 3' }));
    expect(screen.getByRole('button', { name: /Côn baner/ })).toBeInTheDocument();
    expect(screen.queryByText('Flag cone')).not.toBeInTheDocument();
  });
});
