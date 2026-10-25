import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, ExternalLink, Mic, Monitor, Printer, QrCode as QrCodeIcon, Smartphone, Users, X } from 'lucide-react';
import { CopiedTick } from './CopiedTick';
import { QrCode } from './QrCode';
import { ScorerLinksCard } from '../pages/competition/ScorerLinksCard';

export interface QrAccessModalProps {
  open: boolean;
  onClose: () => void;
  competitionId: number;
  competitionName: string;
  sectionId?: number | null;
  canWrite?: boolean;
}

type QrTab = 'scorer' | 'screens';

export function QrAccessModal({
  open,
  onClose,
  competitionId,
  competitionName,
  sectionId = null,
  canWrite = false,
}: QrAccessModalProps) {
  const [tab, setTab] = useState<QrTab>('scorer');
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  if (!open) return null;
  const activeTab = canWrite ? tab : 'screens';

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const sectionSuffix = sectionId != null ? `?section=${sectionId}` : '';

  const screenCards = [
    {
      id: 'commentary',
      title: 'PA Commentator Desk',
      subtitle: 'Live lane draw, rider & pony declarations, talking points, heat table and standings.',
      icon: Mic,
      path: `/competitions/${competitionId}/commentary${sectionSuffix}`,
      url: `${origin}/competitions/${competitionId}/commentary${sectionSuffix}`,
    },
    {
      id: 'tv',
      title: 'TV Kiosk Display',
      subtitle: 'Auto-rotating big-screen scoreboard for the clubhouse, collecting ring or secretary tent.',
      icon: Monitor,
      path: `/competitions/${competitionId}/tv${sectionSuffix}`,
      url: `${origin}/competitions/${competitionId}/tv${sectionSuffix}`,
    },
    {
      id: 'produce',
      title: '2nd Phone Stream Controller',
      subtitle: 'Control arena cameras, overlays, lower-thirds, sponsor breaks and instant replays.',
      icon: Smartphone,
      path: `/competitions/${competitionId}/produce`,
      url: `${origin}/competitions/${competitionId}/produce`,
    },
    {
      id: 'public',
      title: 'Public Event & Standings',
      subtitle: 'Spectator timetable, live heat scores, section toplists and arena stream.',
      icon: Users,
      path: `/competitions/${competitionId}`,
      url: `${origin}/competitions/${competitionId}`,
    },
  ];

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      window.setTimeout(() => {
        setCopiedUrl((current) => (current === url ? null : current));
      }, 2500);
    } catch {
      // Clipboard API unavailable in some non-HTTPS contexts
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="QR Code Access Hub"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="mg-card flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden bg-[rgb(var(--mg-surface))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-ground))] px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-2.5">
            <QrCodeIcon className="h-5 w-5 shrink-0 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
            <div>
              <h2 className="mg-display m-0 text-lg font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">
                QR Code Access Hub · {competitionName}
              </h2>
              <p className="m-0 text-xs text-[rgb(var(--mg-muted))]">
                Share links to scoring, commentary, cameras and public results.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close QR access modal"
            className="mg-btn mg-btn-secondary !min-h-9 !px-2.5"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Category Tabs */}
        <div className="border-b border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-surface))] px-4 py-2.5 sm:px-5">
          <div className="mg-seg w-full sm:w-auto" role="tablist" aria-label="QR code categories">
            {canWrite && (<button
              type="button"
              role="tab"
              aria-selected={activeTab === 'scorer'}
              aria-pressed={activeTab === 'scorer'}
              onClick={() => setTab('scorer')}
            >
              Volunteer &amp; Scorer QR Links (No login needed)
            </button>)}
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'screens'}
              aria-pressed={activeTab === 'screens'}
              onClick={() => setTab('screens')}
            >
              Screens, PA &amp; Spectator QR Codes
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {activeTab === 'scorer' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div className="rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] p-3 text-xs">
                  <span className="block font-bold text-[rgb(var(--mg-heading))]">1. Scorer (enter race results)</span>
                  <span className="mt-1 block text-[rgb(var(--mg-muted))]">
                    Volunteers can score heats from the ring without an account.
                  </span>
                </div>
                <div className="rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] p-3 text-xs">
                  <span className="block font-bold text-[rgb(var(--mg-heading))]">2. Scorer + stream controller</span>
                  <span className="mt-1 block text-[rgb(var(--mg-muted))]">
                    Score races plus remotely control arena camera zoom, overlays and instant replays.
                  </span>
                </div>
                <div className="rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] p-3 text-xs">
                  <span className="block font-bold text-[rgb(var(--mg-heading))]">3. Tripod / 2nd camera</span>
                  <span className="mt-1 block text-[rgb(var(--mg-muted))]">
                    Broadcast arena video with screen dimming for a phone on a tripod.
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
                  const isCopied = copiedUrl === card.url;
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
                          label={`QR code for ${card.title}`}
                          className="h-24 w-24 shrink-0 rounded border border-[rgb(var(--mg-rule-soft))]"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 border-t border-[rgb(var(--mg-rule-soft))] pt-2.5">
                        <button
                          type="button"
                          onClick={() => void copyLink(card.url)}
                          className="mg-btn mg-btn-secondary !min-h-9 !px-3 text-xs font-semibold"
                        >
                          {isCopied ? (
                            <>
                              <CopiedTick /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy link
                            </>
                          )}
                        </button>
                        <Link
                          to={card.path}
                          onClick={onClose}
                          className="mg-btn mg-btn-secondary !min-h-9 !px-3 text-xs font-semibold"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open page
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-ground))] p-4">
                <div>
                  <h3 className="m-0 text-sm font-bold text-[rgb(var(--mg-ink))]">Need paper QR posters for the venue?</h3>
                  <p className="mt-0.5 mb-0 text-xs text-[rgb(var(--mg-muted))]">
                    Print ready-made A4 posters for the secretary tent, collecting ring and clubhouse wall.
                  </p>
                </div>
                <Link
                  to={`/event-tools/${competitionId}/print/posters`}
                  onClick={onClose}
                  className="mg-btn mg-btn-primary !min-h-10 !px-3.5 text-xs font-bold"
                >
                  <Printer className="h-4 w-4" aria-hidden="true" /> Print QR Posters Sheet
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
