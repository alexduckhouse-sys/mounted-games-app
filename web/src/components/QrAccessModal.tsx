import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, ExternalLink, Mic, Monitor, Printer, Smartphone, Users } from 'lucide-react';
import { QrCode } from './QrCode';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { ScorerLinksCard } from '../pages/competition/ScorerLinksCard';
import { useT } from '../i18n/LanguageContext';

export interface QrAccessModalProps {
  open: boolean;
  onClose: () => void;
  competitionId: number;
  competitionName: string;
  sectionId?: number | null;
  canWrite?: boolean;
}

type QrTab = 'scorer' | 'screens';

/** Share with QR codes: a kit sheet with the public screens and, for organisers, the scorer links. */
export function QrAccessModal(props: QrAccessModalProps) {
  return props.open ? <QrAccessSheet {...props} /> : null;
}

function QrAccessSheet({
  onClose,
  competitionId,
  sectionId = null,
  canWrite = false,
}: QrAccessModalProps) {
  const [tab, setTab] = useState<QrTab>('scorer');
  const toast = useToast();
  const t = useT();
  const activeTab = canWrite ? tab : 'screens';

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const sectionSuffix = sectionId != null ? `?section=${sectionId}` : '';

  const screenCards = [
    {
      id: 'commentary',
      title: t('screen.qr.commentaryTitle'),
      subtitle: t('screen.qr.commentarySub'),
      icon: Mic,
      path: `/competitions/${competitionId}/commentary${sectionSuffix}`,
      url: `${origin}/competitions/${competitionId}/commentary${sectionSuffix}`,
    },
    {
      id: 'tv',
      title: t('screen.qr.tvTitle'),
      subtitle: t('screen.qr.tvSub'),
      icon: Monitor,
      path: `/competitions/${competitionId}/tv${sectionSuffix}`,
      url: `${origin}/competitions/${competitionId}/tv${sectionSuffix}`,
    },
    {
      id: 'produce',
      title: t('screen.qr.produceTitle'),
      subtitle: t('screen.qr.produceSub'),
      icon: Smartphone,
      path: `/competitions/${competitionId}/produce`,
      url: `${origin}/competitions/${competitionId}/produce`,
    },
    {
      id: 'public',
      title: t('screen.qr.publicTitle'),
      subtitle: t('screen.qr.publicSub'),
      icon: Users,
      path: `/competitions/${competitionId}`,
      url: `${origin}/competitions/${competitionId}`,
    },
  ];

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.show(t('screen.qr.copied'));
    } catch {
      // Clipboard API unavailable in some non-HTTPS contexts
    }
  }

  return (
    <Sheet
      title={t('screen.qr.title')}
      description={t('screen.qr.description')}
      onClose={onClose}
      className="!max-w-3xl"
    >
      {({ close }) => (
      <>
        {/* Category Tabs */}
        <div>
          <div className="mg-seg w-full sm:w-auto" role="tablist" aria-label={t('screen.qr.tablist')}>
            {canWrite && (<button
              type="button"
              role="tab"
              aria-selected={activeTab === 'scorer'}
              aria-pressed={activeTab === 'scorer'}
              onClick={() => setTab('scorer')}
            >
              {t('screen.qr.tabScorer')}
            </button>)}
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'screens'}
              aria-pressed={activeTab === 'screens'}
              onClick={() => setTab('screens')}
            >
              {t('screen.qr.tabScreens')}
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div>
          {activeTab === 'scorer' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div className="rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] p-3 text-xs">
                  <span className="block font-bold text-[rgb(var(--mg-heading))]">{t('screen.qr.scorer1Title')}</span>
                  <span className="mt-1 block text-[rgb(var(--mg-muted))]">
                    {t('screen.qr.scorer1Body')}
                  </span>
                </div>
                <div className="rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] p-3 text-xs">
                  <span className="block font-bold text-[rgb(var(--mg-heading))]">{t('screen.qr.scorer2Title')}</span>
                  <span className="mt-1 block text-[rgb(var(--mg-muted))]">
                    {t('screen.qr.scorer2Body')}
                  </span>
                </div>
                <div className="rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] p-3 text-xs">
                  <span className="block font-bold text-[rgb(var(--mg-heading))]">{t('screen.qr.scorer3Title')}</span>
                  <span className="mt-1 block text-[rgb(var(--mg-muted))]">
                    {t('screen.qr.scorer3Body')}
                  </span>
                </div>
              </div>

              <ScorerLinksCard competitionId={competitionId} canWrite={canWrite} />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {screenCards.map((card) => {
                  const Icon = card.icon;
                  return (
                    <div
                      key={card.id}
                      className="flex flex-col justify-between gap-3 rounded-xl border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-ground))] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <Icon className="h-4 w-4 shrink-0 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
                            <h3 className="m-0 text-sm font-bold text-[rgb(var(--mg-ink))]">{card.title}</h3>
                          </div>
                          <p className="mt-1 mb-0 text-xs text-[rgb(var(--mg-muted))]">{card.subtitle}</p>
                        </div>
                        <QrCode
                          value={card.url}
                          label={t('screen.qr.qrFor', { title: card.title })}
                          className="h-24 w-24 shrink-0 rounded border border-[rgb(var(--mg-rule-soft))]"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 border-t border-[rgb(var(--mg-rule-soft))] pt-2.5">
                        <button
                          type="button"
                          onClick={() => void copyLink(card.url)}
                          className="mg-btn mg-btn-secondary !min-h-9 !px-3 text-xs font-semibold"
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {t('screen.qr.copyLink')}
                        </button>
                        <Link
                          to={card.path}
                          onClick={onClose}
                          className="mg-btn mg-btn-secondary !min-h-9 !px-3 text-xs font-semibold"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> {t('screen.qr.openPage')}
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-ground))] p-4">
                <div>
                  <h3 className="m-0 text-sm font-bold text-[rgb(var(--mg-ink))]">{t('screen.qr.postersTitle')}</h3>
                  <p className="mt-0.5 mb-0 text-xs text-[rgb(var(--mg-muted))]">
                    {t('screen.qr.postersBody')}
                  </p>
                </div>
                <Link
                  to={`/event-tools/${competitionId}/print/posters`}
                  onClick={onClose}
                  className="mg-btn mg-btn-primary !min-h-10 !px-3.5 text-xs font-bold"
                >
                  <Printer className="h-4 w-4" aria-hidden="true" /> {t('screen.qr.postersBtn')}
                </Link>
              </div>
            </div>
          )}
        </div>

        <div className="kit-acts"><button type="button" className="kit-pill kit-pill-fill" aria-label={t('screen.qr.closeAria')} onClick={() => close()}>{t('screen.qr.close')}</button></div>
        {toast.node}
      </>
      )}
    </Sheet>
  );
}
