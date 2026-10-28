import { useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useT } from '../../i18n/LanguageContext';
import { Notice } from '../../components/Notice';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { DemoPaymentNotice } from '../../components/DemoPaymentNotice';
import { EntryStepper } from '../../components/EntryStepper';
import { usePageWidth } from '../../components/pageWidthState';
import { EntryRosette } from '../../components/Rosette';
import { entryPhaseOnly } from '../../lib/competitionPhase';
import { entryOptions, feeText, parseEntryKind, sectionFull, type EntryKind } from '../../lib/entryOptions';
import { paymentLinkCtaLabel } from '../../lib/paymentLink';
import { placesLeftText } from '../../lib/placesLeft';
import { displaySectionName } from '../../lib/section';
import { useCompetition } from './context';
import { EntryForm, type EntrySent } from './EntryForm';
import { BankDetailsCard } from './BankDetailsCard';
import { useEntrySettings } from './entrySettings';
import '../../components/sitePages.css';
import '../../components/eventPages.css';

/**
 * Entering a competition, in up to three steps that share one stepper so it can animate from step to step:
 * what you are entering (`/enter`), your details (`/enter/:sectionId`) and, when there is a fee, paying
 * (`/enter/:sectionId/pay`). Guest riders, the waiting list and free age groups have nothing to pay, so they stop
 * after the details. It is also the public home of a competition while entries are the only thing to do.
 */
export function EntryPage() {
  const t = useT();
  usePageWidth('narrow');
  const { competition, reload } = useCompetition();
  const { user, canOrganise } = useAuth();
  const location = useLocation();
  const [search] = useSearchParams();
  const rest = (useParams()['*'] ?? '').split('/').filter(Boolean);
  const [sectionPart, stepPart] = rest;
  const section = sectionPart ? competition.sections.find((s) => s.id === Number(sectionPart)) ?? null : null;
  const kind: EntryKind = parseEntryKind(search.get('type')) ?? (search.get('waitlist') === '1' ? 'waitlist' : 'standard');
  const [sent, setSent] = useState<EntrySent | null>(null);
  const entrySettings = useEntrySettings(competition);
  const mayOrganise = canOrganise(competition);
  const closed = entrySettings.closed && !mayOrganise;
  // Where Back goes from the first step: where you came from, or the competition's front page.
  const [cameFrom] = useState(() => (location.state as { from?: string } | null)?.from);
  const home = Array.isArray(competition.sessions) && entryPhaseOnly(competition, mayOrganise)
    ? `/competitions/${competition.id}`
    : `/competitions/${competition.id}/details`;
  const firstBack = cameFrom?.startsWith('/competitions/') ? cameFrom : home;
  const atHome = !location.pathname.includes('/enter');
  const base = `/competitions/${competition.id}/enter`;
  const query = kind === 'standard' ? '' : `?type=${kind}`;

  const option = section ? entryOptions(section, sectionFull(section)).find((o) => o.kind === kind) : undefined;
  const pays = (option?.priceMinor ?? 1) > 0;
  const labels = pays ? [t('entries.step.section'), t('entries.step.details'), t('entries.step.pay')] : [t('entries.step.section'), t('entries.step.details')];
  const current = sent ? labels.length + 1 : !section ? 1 : stepPart === 'pay' ? 3 : 2;

  const backTo = sent || !section ? (atHome && !sent ? undefined : sent ? home : firstBack)
    : stepPart === 'pay' ? `${base}/${section.id}${query}` : base;
  usePageHeader({
    title: t('entries.page.title'),
    subtitle: section && !sent ? `${competition.name} · ${displaySectionName(section.displayName)}` : competition.name,
    plain: true,
    backTo,
    backLabel: t('common.back'),
  });

  function chooseHref(sectionId: number, chosen: EntryKind) {
    return `${base}/${sectionId}${chosen === 'standard' ? '' : `?type=${chosen}`}`;
  }

  let body;
  if (sent && section) {
    body = (
      <div className="ev-card flex flex-col gap-2.5 p-5">
        <h2 className="ev-title">{t('entries.page.submitted')}</h2>
        <p className="ev-body">{sent.text}</p>
        {sent.hasFee && <DemoPaymentNotice what="entry" />}
        {sent.bank && <BankDetailsCard details={sent.bank} />}
        {sent.bank && sent.paymentLinkUrl && (
          <div className="flex flex-col gap-1">
            <p className="sp-note !m-0">Or pay online instead of by bank transfer. It opens the organiser’s payment page in a new tab.</p>
            <a href={sent.paymentLinkUrl} target="_blank" rel="noopener noreferrer" className="sp-pill self-start">{paymentLinkCtaLabel()}</a>
          </div>
        )}
        {sent.enteredAs && (
          <EntryRosette team={sent.enteredAs} section={displaySectionName(section.displayName)} year={new Date(competition.startDate).getFullYear()} />
        )}
        <div className="sp-acts mt-1.5"><Link to={home} className="sp-pill">{t('entries.page.backToDetails')}</Link></div>
      </div>
    );
  } else if (section && !user) {
    body = (
      <div className="sp-card flex flex-col gap-3 p-4">
        <p className="ev-body">{t('entries.page.signInPrompt')}</p>
        <Link to="/login" state={{ from: `${location.pathname}${location.search}` }} className="ev-bar !mt-0">{t('entries.page.signInToEnter')}</Link>
      </div>
    );
  } else if (section) {
    body = <EntryForm key={`${section.id}:${kind}`} competition={competition} section={section} kind={kind} step={stepPart === 'pay' ? 'pay' : 'details'} onSent={setSent} onConflict={reload} />;
  } else if (sectionPart) {
    body = <Notice actionLabel={t('entries.page.chooseAgeGroup')} actionTo={base}>{t('entries.page.sectionNotFound')}</Notice>;
  } else {
    body = (
      <>
        <h2 className="ev-step-title">{t('entries.page.whatEntering')}</h2>
        {closed && <Notice tone="info" className="mb-3">{t('entries.page.closed')}</Notice>}
        {competition.sections.length === 0 && <p className="sp-note">{t('entries.page.noAgeGroups')}</p>}
        {competition.sections.map((s) => (
          <section key={s.id} aria-label={s.displayName}>
            <h3 className="sp-sec">{displaySectionName(s.displayName)}</h3>
            {!closed && placesLeftText(s) && <p className="sp-note !mt-0 !mb-1.5">{placesLeftText(s)}</p>}
            <div className="sp-card">
              {closed ? (
                <div className="sp-row"><span className="sp-grow"><span className="sp-t1 !text-[var(--mg-muted)]">{t('entries.page.entriesClosed')}</span></span></div>
              ) : entryOptions(s, sectionFull(s)).map((o) => (
                <Link
                  key={o.kind}
                  className="sp-row"
                  to={user ? chooseHref(s.id, o.kind) : '/login'}
                  state={user ? { from: cameFrom } : { from: chooseHref(s.id, o.kind) }}
                  onClick={() => setSent(null)}
                >
                  <span className="sp-grow"><span className="sp-t1">{o.label}</span>{o.sub && <span className="sp-t2">{o.sub}</span>}</span>
                  <span className="ev-price">{feeText(o.priceMinor)}</span>
                  <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
                </Link>
              ))}
            </div>
          </section>
        ))}
        {atHome && <p className="sp-note">{t('entries.page.afterDraw')}</p>}
      </>
    );
  }

  return (
    <div className="rf-page mx-auto flex w-full max-w-xl flex-col pb-4 pt-3">
      <h1 className="sr-only">{t('entries.page.srTitle', { competition: competition.name })}</h1>
      <EntryStepper labels={labels} current={current} />
      {body}
    </div>
  );
}
