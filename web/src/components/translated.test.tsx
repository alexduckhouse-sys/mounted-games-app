import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageContext';
import { EntryEmailFields } from './EntryEmailFields';
import { EntryStepper } from './EntryStepper';
import { TermsTickBox } from './TermsTickBox';
import { EntryRosette } from './Rosette';
import { EMAIL_OPT_IN_TEXT } from '../lib/emailOptIn';
import { TERMS_TICK_HELP } from '../lib/termsTick';

describe('the entry components in Welsh and French', () => {
  it('translates the stepper', () => {
    render(<LanguageProvider initial="cy"><EntryStepper labels={['Adran', 'Eich manylion']} current={2} /></LanguageProvider>);
    expect(screen.getByRole('list', { name: 'Camau cofrestru' })).toBeInTheDocument();
    expect(screen.getByLabelText('Wedi gorffen')).toBeInTheDocument();
  });

  it('keeps the legal wording in English and adds a translated reading beside it', () => {
    render(<LanguageProvider initial="fr"><TermsTickBox checked={false} termsText="Hats on." onChange={() => {}} /></LanguageProvider>);
    expect(screen.getByRole('checkbox', { name: 'J’accepte' })).toBeInTheDocument();
    expect(screen.getByText('Lire les conditions de l’événement')).toBeInTheDocument();
    expect(screen.getByText(TERMS_TICK_HELP)).toBeInTheDocument();
    expect(screen.getByText(/Le texte anglais fait foi/)).toBeInTheDocument();
    // The organiser's own words are never translated.
    expect(screen.getByText('Hats on.')).toBeInTheDocument();
  });

  it('shows no second reading in English', () => {
    render(<TermsTickBox checked={false} onChange={() => {}} />);
    expect(screen.queryByText(/Le texte anglais|Y geiriad Saesneg/)).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'I agree' })).toBeInTheDocument();
  });

  it('translates the email box and keeps the opt-in wording in English with a reading', () => {
    render(<LanguageProvider initial="cy"><EntryEmailFields value={{ email: 'sam@example.com', optIn: false }} onChange={() => {}} /></LanguageProvider>);
    expect(screen.getByLabelText('Eich e-bost (dewisol)')).toHaveValue('sam@example.com');
    expect(screen.getByText(EMAIL_OPT_IN_TEXT)).toBeInTheDocument();
    expect(screen.getByText(/Y geiriad Saesneg sy’n berthnasol/)).toBeInTheDocument();
  });

  it('flags a bad email address in French', () => {
    render(<LanguageProvider initial="fr"><EntryEmailFields value={{ email: 'nope', optIn: false }} onChange={() => {}} /></LanguageProvider>);
    expect(screen.getByRole('alert')).toHaveTextContent('Cette adresse e-mail ne semble pas correcte.');
  });

  it('translates the rosette caption and leaves the names alone', () => {
    render(<LanguageProvider initial="fr"><EntryRosette team="Stockport A" section="Under 12" year={2026} /></LanguageProvider>);
    expect(screen.getByText('Vous êtes inscrit')).toBeInTheDocument();
    expect(screen.getByText('Stockport A, Under 12')).toBeInTheDocument();
  });
});
