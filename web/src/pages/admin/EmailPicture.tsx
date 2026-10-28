import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { ImageIcon } from 'lucide-react';
import { useT } from '../../i18n/LanguageContext';
import { PICTURE_TYPES, type PictureDraft } from './emailDraft';
import { pictureFrom, uploadPicture } from './emailUpload';

interface Props {
  picture: PictureDraft | null;
  onChange: (picture: PictureDraft | null) => void;
  onError: (message: string | null) => void;
  /** The empty zone's heading. */
  title: string;
  /** Names the zone for screen readers. */
  label: string;
  big?: boolean;
}

/** Drop a picture, paste it, or choose one. Shows the picture once it is uploaded. */
export function EmailPicture({ picture, onChange, onError, title, label, big = false }: Props) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  async function take(file: File | null) {
    if (!file) return;
    setBusy(true);
    onError(null);
    try { onChange(await uploadPicture(file)); } catch (caught) { onError((caught as Error).message); } finally { setBusy(false); }
  }
  const choose = () => input.current?.click();
  const dragOver = (event: DragEvent) => { event.preventDefault(); setOver(true); };
  const drop = (event: DragEvent) => { event.preventDefault(); setOver(false); void take(pictureFrom(event.dataTransfer)); };
  const paste = (event: ClipboardEvent) => {
    const file = pictureFrom(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    void take(file);
  };
  const key = (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } };

  return (
    <div className="em-drop-wrap">
      <div
        className={`em-drop ${big ? 'em-drop-big' : ''}`} role="button" tabIndex={0} data-over={over} aria-busy={busy}
        aria-label={picture ? t('admin.email.picture.ariaChange', { label, name: picture.name }) : t('admin.email.picture.ariaEmpty', { label })}
        onClick={choose} onKeyDown={key} onDragOver={dragOver} onDragLeave={() => setOver(false)} onDrop={drop} onPaste={paste}
      >
        {picture ? (
          <>
            <img className="em-thumb" src={picture.url} alt="" />
            <span className="rf-grow"><span className="rf-t1">{picture.name}</span><span className="rf-t2">{t('admin.email.picture.swap')}</span></span>
            <span className="rf-btn">{t('admin.email.picture.change')}</span>
          </>
        ) : (
          <>
            <ImageIcon className="h-6 w-6 em-drop-i" aria-hidden="true" />
            <span className="rf-t1">{busy ? t('admin.email.picture.uploading') : title}</span>
            <span className="rf-t2">{t('admin.email.picture.hint')}</span>
            <span className="rf-btn">{t('admin.email.picture.choose')}</span>
          </>
        )}
      </div>
      <input ref={input} type="file" accept={PICTURE_TYPES.join(',')} hidden aria-label={t('admin.email.picture.fileAria', { label })} onChange={(event) => { const file = event.target.files?.[0] ?? null; event.target.value = ''; void take(file); }} />
    </div>
  );
}
