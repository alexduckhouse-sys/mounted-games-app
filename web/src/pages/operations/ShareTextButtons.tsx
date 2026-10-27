import { useToast } from '../../components/Toast';
import { copyText, shareWithSheet, whatsAppShareHref } from './shareText';

/**
 * Three ways to send a piece of text on: the phone's share sheet (where there is one), copy, and a WhatsApp link.
 * Nothing leaves the device until the person picks where it goes.
 */
export function ShareTextButtons({ title, text, name }: { title: string; text: string; name: string }) {
  const toast = useToast();
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function copy() {
    toast.show((await copyText(text)) ? `${name} copied` : 'Couldn’t copy. Select the text and copy it by hand.');
  }

  return (
    <span className="flex flex-wrap items-center gap-2" role="group" aria-label={title}>
      {toast.node}
      {canShare && <button type="button" className="rf-btn" onClick={() => void shareWithSheet(title, text)}>{title}</button>}
      <button type="button" className="rf-btn" onClick={() => void copy()}>Copy {name.toLowerCase()}</button>
      <a className="rf-btn" href={whatsAppShareHref(text)} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>
    </span>
  );
}
