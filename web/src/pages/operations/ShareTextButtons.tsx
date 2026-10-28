import { useToast } from '../../components/Toast';
import { useT } from '../../i18n/LanguageContext';
import { copyText, shareWithSheet, whatsAppShareHref } from './shareText';

/**
 * Three ways to send a piece of text on: the phone's share sheet (where there is one), copy, and a WhatsApp link.
 * Nothing leaves the device until the person picks where it goes.
 */
export function ShareTextButtons({ title, text, name }: { title: string; text: string; name: string }) {
  const toast = useToast();
  const t = useT();
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function copy() {
    toast.show((await copyText(text)) ? t('site.share.copied', { name }) : t('site.share.copyFailed'));
  }

  return (
    <span className="flex flex-wrap items-center gap-2" role="group" aria-label={title}>
      {toast.node}
      {canShare && <button type="button" className="rf-btn" onClick={() => void shareWithSheet(title, text)}>{title}</button>}
      <button type="button" className="rf-btn" onClick={() => void copy()}>{t('site.share.copy', { name: name.toLowerCase() })}</button>
      <a className="rf-btn" href={whatsAppShareHref(text)} target="_blank" rel="noopener noreferrer">{t('site.share.whatsapp')}</a>
    </span>
  );
}
