import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Megaphone, X } from 'lucide-react';
import type { ChatMessage } from '../types';
import { useStillMotion } from '../lite/useStillMotion';
import { useT } from '../i18n/LanguageContext';

/** How long a new announcement stays at the top of the page. */
export const ANNOUNCEMENT_POP_MS = 7000;

/**
 * A new announcement drops in at the top of whatever page you're on, its megaphone gives a little shake, and it
 * tucks itself away after a few seconds. Tapping it opens the Live tab; the cross just puts it away.
 */
export function AnnouncementPop({ message, to, onDismiss }: { message: ChatMessage | null; to: string; onDismiss: () => void }) {
  const still = useStillMotion();
  const t = useT();
  const id = message?.id ?? null;
  useEffect(() => {
    if (id === null) return;
    const timer = setTimeout(onDismiss, ANNOUNCEMENT_POP_MS);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          key={message.id}
          role="status"
          className="mg-announce-pop"
          initial={still ? false : { opacity: 0, y: -28, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={still ? undefined : { opacity: 0, y: -20, transition: { duration: 0.2, ease: 'easeIn' } }}
          transition={{ type: 'spring', stiffness: 420, damping: 26 }}
        >
          <Link to={to} className="mg-announce-pop-link" onClick={onDismiss}>
            <motion.span
              className="mg-announce-pop-icon"
              aria-hidden="true"
              initial={false}
              animate={still ? undefined : { rotate: [0, -16, 13, -9, 5, 0] }}
              transition={{ duration: 0.7, delay: 0.25 }}
            >
              <Megaphone />
            </motion.span>
            <span className="mg-announce-pop-text">
              <b>{t('teams.announcement.title')}</b>
              <span>{message.body}</span>
            </span>
            <ChevronRight className="mg-announce-pop-go" aria-hidden="true" />
          </Link>
          <button type="button" className="mg-announce-pop-close" aria-label={t('teams.announcement.dismiss')} onClick={onDismiss}>
            <X aria-hidden="true" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
