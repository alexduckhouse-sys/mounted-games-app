import { Component, useEffect, useState, useContext, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Megaphone, VolumeX } from 'lucide-react';
import { BibSwatch as BaseBibSwatch } from '../BibSwatch';
import { LiveDataCardOverlay, OverlayChips, ProducerBanner, ScoreCardOverlay, activeArenaHeat, readLiveOverlayCard, redactTeamDisplayName, useDueCard } from './OverlayExtras';
import { SponsorOverlay } from './SponsorOverlay';
import { useOverlay } from '../../hooks/useOverlay';
import { CompetitionContext } from '../../pages/competition/context';
import { lookStyle } from '../../lib/overlays';
import { readLiveOptions } from '../../lib/streamOverlayTiles';
import type { ChatMessage, Heat, LiveStream } from '../../types';
import { ENTER, LEAVE, ROW_STAGGER_S, SPRING, WIPE_HIDDEN_LEFT, WIPE_SHOWN } from '../../lib/motion';
import { useStillMotion } from '../../lite/useStillMotion';

/** A broadcast bib swatch accepting colour/color and optional size, rendering nothing when no bib color exists. */
export function BibSwatch({
  colour,
  color,
  size,
  label,
  className = '',
}: {
  colour?: string | null;
  color?: string | null;
  size?: number;
  label?: string;
  className?: string;
}) {
  const resolved = colour ?? color;
  if (!resolved) return null;
  return (
    <span style={size ? { fontSize: `${size}px` } : undefined} className="inline-flex items-center">
      <BaseBibSwatch colour={resolved} label={label} className={className} />
    </span>
  );
}

class OverlayErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    // Isolate malformed overlay payloads so the live video player underneath keeps playing.
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

function OverlayLayerInner({ children }: { children: ReactNode }) {
  const { look } = useOverlay();
  return <div className={`mg-font mg-ov-${look.size} pointer-events-none absolute inset-0 text-white`} style={lookStyle(look)}>{children}</div>;
}

/** New score cards or producer banners can be supplied as additional overlay items. */
export function OverlayLayer({ children }: { children: ReactNode }) {
  return (
    <OverlayErrorBoundary>
      <OverlayLayerInner>{children}</OverlayLayerInner>
    </OverlayErrorBoundary>
  );
}
export function StreamNotice({ message, receivedAt, duration = 8000 }: { message: ChatMessage; receivedAt: number; duration?: number }) {
  const still = useStillMotion();
  const [visible, setVisible] = useState(() => Date.now() - receivedAt < duration);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), Math.max(0, duration - (Date.now() - receivedAt)));
    return () => clearTimeout(timer);
  }, [receivedAt, duration]);
  return <AnimatePresence>
    {visible && <motion.div
      role="status"
      className="mg-stream-glass flex max-w-md gap-2 p-3 text-sm"
      initial={still ? false : { opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={still ? undefined : { opacity: 0, y: -8, transition: LEAVE }}
      transition={SPRING}
    >
      {message.type === 2 && <Megaphone aria-hidden="true" className="h-5 w-5 shrink-0" />}
      <p><strong>{message.type === 2 ? 'Announcement' : message.authorName}</strong> · {message.body}</p>
    </motion.div>}
  </AnimatePresence>;
}
interface HeatLaneLike {
  id?: number | string;
  lane?: number;
  laneNumber?: number;
  laneIndex?: number;
  teamId?: number;
  teamName?: string;
  riderName?: string;
  useInitialOnly?: boolean;
  bibColour?: string | null;
  bibColor?: string | null;
}

interface HeatLike {
  id?: number;
  label?: string | null;
  lanes?: HeatLaneLike[];
  entries?: HeatLaneLike[];
  [key: string]: unknown;
}

export function StreamOverlays({ stream, label, reconnecting, muted, onSound, announcement, hideCaption = false, currentHeat: heatProp, children }: {
  stream: LiveStream; label: string | null; reconnecting: boolean; muted: boolean; onSound: () => void;
  announcement?: { message: ChatMessage; receivedAt: number }; hideCaption?: boolean;
  currentHeat?: Heat | HeatLike | null; children?: ReactNode;
}) {
  const still = useStillMotion();
  const compCtx = useContext(CompetitionContext);
  const competition = compCtx?.competition;
  const { overlay, look, scoreCards } = useOverlay();
  const liveOptions = readLiveOptions(overlay);
  const dueCard = useDueCard(scoreCards, stream.arenaName, overlay.scoreCardDelaySeconds * 1000, overlay.scoreCardSeconds * 1000);
  const liveCardMode = readLiveOverlayCard(overlay).mode;
  const overlayPopupActive =
    liveCardMode !== 'none' ||
    Boolean(dueCard && overlay.scoreCardMode !== 2 && look.elements.scoreCard.show);

  // Off hides the now-racing strip; Auto and On show it, naming the heat when one is running.
  // Also hide the bottom bar automatically when a centred overlay popup card is active.
  const showStrip = !hideCaption && !overlayPopupActive && overlay.stripMode !== 2 && look.elements.strip.show;
  const stripEdge = look.elements.strip.place === 'top' ? 'top-0 pt-12' : 'bottom-0';

  const activeHeat = heatProp !== undefined
    ? heatProp
    : competition
      ? activeArenaHeat(competition, stream.arenaName, 'current')?.heat ?? null
      : null;

  const laneNum = (lane: HeatLaneLike, fallback: number) => Number(lane.laneNumber ?? lane.laneIndex ?? lane.lane ?? fallback);
  const heatObj = activeHeat as HeatLike | null;
  const rawLanes: HeatLaneLike[] = heatObj?.lanes ?? heatObj?.entries ?? [];
  const nowRacingLanes = Array.isArray(rawLanes) && rawLanes.length > 0
    ? [...rawLanes]
        .sort((a, b) => laneNum(a, 0) - laneNum(b, 0))
        .slice(0, 6)
        .map((lane, idx) => {
          const laneNumber = laneNum(lane, idx + 1);
          const team = competition?.teams?.find(
            (t) => (lane.teamId != null && t.id === lane.teamId) ||
                   (lane.teamName && t.displayName === lane.teamName),
          );
          const bibColor = team?.bibColour ?? (team as { bibColor?: string | null } | undefined)?.bibColor ?? lane.bibColour ?? lane.bibColor;
          const rawDisplay = lane.teamName || lane.riderName || '';
          const displayName = redactTeamDisplayName(rawDisplay, team, competition, lane.useInitialOnly);
          return {
            key: lane.id ?? `${laneNumber}-${idx}`,
            laneNumber,
            team,
            bibColor,
            displayName,
          };
        })
    : [];

  return <OverlayLayer>
    <OverlayChips stream={stream} look={look} live={<span className="mg-badge mg-badge-live">LIVE</span>} />
    <AnimatePresence>
      {showStrip && (
        <motion.div
          key="now-racing-strip"
          aria-label="Now racing"
          initial={still ? false : { clipPath: WIPE_HIDDEN_LEFT }}
          animate={{ clipPath: WIPE_SHOWN }}
          exit={still ? undefined : { clipPath: WIPE_HIDDEN_LEFT, transition: LEAVE }}
          transition={ENTER}
          className={`mg-ov-strip absolute left-0 right-0 ${stripEdge} flex flex-col gap-1 px-3 py-2 text-xs sm:text-sm`}
        >
          <div className="flex items-center gap-2">
            <motion.div
              key={label ?? ''}
              className="min-w-0 flex-1 truncate"
              initial={still ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...ENTER, delay: 0.1 }}
            >
              <span className="block text-[10px] uppercase tracking-wider text-[rgb(var(--mg-header-sub))]">
                {stream.caption ? 'Now' : label ? 'Now racing' : 'Live from'}
              </span>
              {label ?? `${stream.arenaName} · ${stream.angleName}`}
            </motion.div>
            {stream.hasAudio && !stream.audioMuted && stream.status !== 1 && muted && (
              <button
                className="mg-stream-glass pointer-events-auto flex min-h-11 shrink-0 items-center gap-1 px-2"
                onClick={onSound}
              >
                <VolumeX aria-hidden="true" className="h-4 w-4" />Tap for sound
              </button>
            )}
          </div>
          {nowRacingLanes.length > 0 && (
            <div
              // A new heat brings its lanes in afresh, one after another from lane 1.
              key={label ?? ''}
              data-testid="now-racing-lanes"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs"
            >
              {nowRacingLanes.map((lane, idx) => (
                <motion.div
                  key={lane.key}
                  className="inline-flex items-center gap-1 font-medium"
                  initial={still ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SPRING, delay: 0.2 + idx * ROW_STAGGER_S * 1.5 }}
                >
                  <span className="font-semibold opacity-90">L{lane.laneNumber}</span>
                  <BibSwatch color={lane.bibColor} size={10} />
                  <span className="truncate">{lane.displayName}</span>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
    <ProducerBanner stream={stream} overlay={overlay} look={look} />
    <ScoreCardOverlay stream={stream} overlay={overlay} look={look} cards={scoreCards} teams={competition?.teams} />
    <LiveDataCardOverlay arenaName={stream.arenaName} overlay={overlay} />
    <div data-sponsor-size={liveOptions.sponsorSize} className={liveOptions.sponsorSize === 'full' ? 'mg-ov-sponsor-full' : 'mg-ov-sponsor-corner'}>
      <SponsorOverlay arenaName={stream.arenaName} track={stream.id !== 0} />
    </div>
    {announcement && <div className="absolute left-3 right-3 top-14 flex justify-center"><StreamNotice key={`${announcement.message.id}-${announcement.receivedAt}`} {...announcement} /></div>}
    <AnimatePresence>
      {reconnecting && stream.status !== 1 && <motion.div key="reconnecting" role="status" {...fadeCover(still)} className="absolute inset-0 flex flex-col items-center justify-center bg-[rgb(var(--mg-header-deep)/0.7)]"><h3 className="text-2xl font-bold">Reconnecting…</h3><p className="text-sm">The signal dropped. Trying again.</p></motion.div>}
      {stream.status === 1 && <motion.div key="back-soon" role="status" {...fadeCover(still)} className="absolute inset-0 flex flex-col items-center justify-center bg-[rgb(var(--mg-header-deep))]"><span className="mg-logo mb-3">MG</span><h3 className="text-3xl font-bold">Back soon</h3><p>The camera is being moved.</p><p className="mt-3 text-xs">{stream.arenaName} · {stream.angleName}</p></motion.div>}
    </AnimatePresence>
    {children}
  </OverlayLayer>;
}

/** Full-picture covers (reconnecting, camera moving) fade over the video rather than cutting. */
function fadeCover(still: boolean) {
  return {
    initial: still ? false as const : { opacity: 0 },
    animate: { opacity: 1 },
    exit: still ? undefined : { opacity: 0, transition: LEAVE },
    transition: { duration: 0.3 },
  };
}
